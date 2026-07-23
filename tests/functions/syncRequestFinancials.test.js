/**
 * syncRequestFinancials — pure-handler unit tests.
 *
 * The trigger recomputes a request's derived funding fields from its
 * child slices. These tests pin the behaviour that matters:
 *   - the derived sum is authoritative (an inflated client figure loses)
 *   - CRMC lifecycle authority is respected (closed/rejected/assessment
 *     requests keep their status; only the factual number syncs)
 *   - expired-GL slices stop counting as committed
 *   - no-op writes are skipped
 *   - missing request / missing requestId degrade quietly
 *
 * Parity note: the funding maths is duplicated from src/utils/requests.js
 * because the web and functions bundles are built separately. The last
 * describe block asserts the two implementations agree on a shared set of
 * fixtures, so a change to one that isn't mirrored fails here.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

vi.mock('firebase-admin', () => ({
  default: { firestore: () => ({}) },
  firestore: () => ({}),
}))
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (opts, fn) => fn }))

let handleSyncRequestFinancials, fnDeriveRequestFinancials
beforeAll(() => {
  const mod = require('../../functions/src/syncRequestFinancials')
  handleSyncRequestFinancials = mod.handleSyncRequestFinancials
  fnDeriveRequestFinancials   = mod.deriveRequestFinancials
})

const serverTimestamp = () => 'MOCK_TS'

/**
 * makeDb(request, slices): minimal Firestore double.
 *   requests/{id}.get()                      -> the request doc
 *   applications.where('requestId').get()    -> the slice list
 * Captures the update payload for assertions.
 */
function makeDb(request, slices) {
  const updates = []
  return {
    updates,
    collection(name) {
      if (name === 'requests') {
        return {
          doc: () => ({
            get: async () => ({
              exists: request !== null,
              data: () => request,
            }),
            update: async (payload) => { updates.push(payload) },
          }),
        }
      }
      if (name === 'applications') {
        return {
          where: () => ({
            get: async () => ({ docs: slices.map(s => ({ data: () => s })) }),
          }),
        }
      }
      throw new Error(`unexpected collection ${name}`)
    },
  }
}

const run = (request, slices) => {
  const db = makeDb(request, slices)
  return handleSyncRequestFinancials({ db, requestId: 'req-1', serverTimestamp })
    .then(result => ({ result, updates: db.updates }))
}

describe('syncRequestFinancials — derived figure is authoritative', () => {
  it('corrects an inflated amountCommitted written by a client', async () => {
    const { result, updates } = await run(
      { amountNeeded: 25000, amountCommitted: 999999, status: 'partially_funded' },
      [{ status: 'approved', amountApproved: 10000 }],
    )
    expect(updates).toHaveLength(1)
    expect(updates[0].amountCommitted).toBe(10000)
    expect(result.updated.amountCommitted).toBe(10000)
  })

  it('sums multiple approved slices', async () => {
    const { updates } = await run(
      { amountNeeded: 25000, amountCommitted: 0, status: 'endorsed' },
      [
        { status: 'approved',    amountApproved: 10000 },
        { status: 'certificate', amountApproved: 5000  },
      ],
    )
    expect(updates[0].amountCommitted).toBe(15000)
    expect(updates[0].status).toBe('partially_funded')
  })

  it('marks fully_funded once committed reaches the need', async () => {
    const { updates } = await run(
      { amountNeeded: 25000, amountCommitted: 0, status: 'partially_funded' },
      [{ status: 'approved', amountApproved: 25000 }],
    )
    expect(updates[0].status).toBe('fully_funded')
  })

  it('does NOT count an expired-GL certificate slice as committed', async () => {
    // performExpireGL already released that budget back to the agency.
    // An expired certificate slice is in neither COMMITTED_SLICE_STATUSES
    // (isCommittedSlice rejects it) nor OUTSTANDING_SLICE_STATUSES, so
    // both totals fall to 0 and the request derives back to 'submitted'.
    // That is the existing web behaviour too -- the parity block below
    // pins the two implementations together on this exact fixture.
    const { updates } = await run(
      { amountNeeded: 25000, amountCommitted: 5000, status: 'partially_funded' },
      [{ status: 'certificate', glStatus: 'expired', amountApproved: 5000 }],
    )
    expect(updates[0].amountCommitted).toBe(0)
    expect(updates[0].status).toBe('submitted')
  })

  it('falls back to endorsed while slices are still outstanding', async () => {
    const { updates } = await run(
      { amountNeeded: 25000, amountCommitted: 5000, status: 'partially_funded' },
      [{ status: 'reviewing', amountRequested: 12500 }],
    )
    expect(updates[0].amountCommitted).toBe(0)
    expect(updates[0].status).toBe('endorsed')
  })
})

describe('syncRequestFinancials — CRMC lifecycle authority', () => {
  it.each(['closed', 'rejected', 'under_review', 'assessment'])(
    'never rewrites status %s, but still syncs the number',
    async (status) => {
      const { updates } = await run(
        { amountNeeded: 25000, amountCommitted: 999, status },
        [{ status: 'approved', amountApproved: 10000 }],
      )
      expect(updates[0].amountCommitted).toBe(10000)
      expect(updates[0].status).toBeUndefined()
    },
  )

  it('does rewrite status when the request sits in a derived state', async () => {
    const { updates } = await run(
      { amountNeeded: 25000, amountCommitted: 0, status: 'endorsed' },
      [{ status: 'approved', amountApproved: 25000 }],
    )
    expect(updates[0].status).toBe('fully_funded')
  })
})

describe('syncRequestFinancials — quiet degradation', () => {
  it('skips a slice with no requestId (pre-redesign legacy)', async () => {
    const db = makeDb({ amountNeeded: 1 }, [])
    const result = await handleSyncRequestFinancials({ db, requestId: null, serverTimestamp })
    expect(result.skipped).toBe('no-request-id')
    expect(db.updates).toHaveLength(0)
  })

  it('skips when the parent request no longer exists', async () => {
    const { result, updates } = await run(null, [{ status: 'approved', amountApproved: 1 }])
    expect(result.skipped).toBe('request-missing')
    expect(updates).toHaveLength(0)
  })

  it('skips the write entirely when already in sync', async () => {
    const { result, updates } = await run(
      { amountNeeded: 25000, amountCommitted: 10000, status: 'partially_funded' },
      [{ status: 'approved', amountApproved: 10000 }],
    )
    expect(result.skipped).toBe('in-sync')
    expect(updates).toHaveLength(0)
  })

  it('treats a missing amountCommitted as 0 rather than writing NaN', async () => {
    const { result } = await run(
      { amountNeeded: 25000, status: 'submitted' },
      [],
    )
    expect(result.skipped).toBe('in-sync')
  })
})

// ── Parity with the web bundle ──────────────────────────────────────────
// The funding maths exists twice on purpose (separate build targets).
// These fixtures must produce identical output from both copies.
describe('parity with src/utils/requests.js', () => {
  const FIXTURES = [
    { need: 25000, slices: [] },
    { need: 25000, slices: [{ status: 'approved', amountApproved: 10000 }] },
    { need: 25000, slices: [{ status: 'approved', amountApproved: 25000 }] },
    { need: 25000, slices: [{ status: 'certificate', amountApproved: 5000 }] },
    { need: 25000, slices: [{ status: 'certificate', glStatus: 'expired', amountApproved: 5000 }] },
    { need: 25000, slices: [{ status: 'reviewing', amountRequested: 12500 }] },
    { need: 25000, slices: [{ status: 'endorsed', amountRequested: 12500 }] },
    { need: 0,     slices: [{ status: 'approved', amountApproved: 100 }] },
    { need: 25000, slices: [
      { status: 'approved', amountApproved: 10000 },
      { status: 'reviewing', amountRequested: 15000 },
    ] },
  ]

  it('produces identical results for every fixture', async () => {
    const web = await import('../../src/utils/requests.js')
    for (const { need, slices } of FIXTURES) {
      expect(fnDeriveRequestFinancials(slices, need))
        .toEqual(web.deriveRequestFinancials(slices, need))
    }
  })
})
