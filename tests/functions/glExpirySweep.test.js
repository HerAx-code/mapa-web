/**
 * glExpirySweep — pure-handler unit tests.
 *
 * The only automatic expiry since Phase 2 PR 2.3 (the Dashboard's browser
 * sweep was removed). It shares expireLetterTx with the agency's "Mark
 * expired". These tests pin the transaction semantics:
 *   - Per-app transaction (one expiry doesn't roll back another)
 *   - Re-read inside the transaction (avoid double-release if a
 *     coordinator clicked "Mark Expired" between query and tx)
 *   - Budget release goes to the correct agency
 *   - Apps without agencyId still get flipped to expired
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

vi.mock('firebase-admin', () => ({
  default: { firestore: () => ({}) },
  firestore: () => ({}),
}))
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (opts, fn) => fn }))

let handleGLExpirySweep
beforeAll(() => {
  ;({ handleGLExpirySweep } = require('../../functions/src/glExpirySweep'))
})

const serverTimestamp = () => 'MOCK_TS'
const increment = (n) => ({ __op: 'increment', value: n })

/**
 * makeDb(apps, opts):
 *   apps:    array of application docs to return from the .where().get()
 *   opts:    optional per-app fresh-read overrides for transaction:
 *            { id: { fresh: { exists, data() } } } to simulate raced flips
 */
function makeDb(apps, opts = {}) {
  const updates = []
  const docs = apps.map((a, i) => {
    const id = a.id ?? `app-${i}`
    return {
      id,
      ref:  { _path: `applications/${id}`, _id: id },
      data: () => a,
    }
  })
  return {
    _updates: updates,
    collection: () => ({
      where: () => ({
        where: () => ({
          get: async () => ({ docs, size: docs.length }),
        }),
      }),
    }),
    doc: (path) => ({ _path: path, _id: path.split('/').pop() }),
    runTransaction: async (fn) => {
      const txOps = []
      const tx = {
        get: async (ref) => {
          const id = ref._id
          // Agencies exist unless listed in opts.missingAgencies (2026-11-16).
          if (String(ref._path).startsWith('agencies/')) return { exists: !(opts.missingAgencies ?? []).includes(id), data: () => ({}) }
          if (opts[id] && opts[id].fresh) return opts[id].fresh
          // Default: app still exists with the same data
          const doc = docs.find(d => d.id === id)
          return { exists: !!doc, data: () => doc?.data() }
        },
        update: (ref, data) => txOps.push({ ref, data }),
      }
      try {
        const result = await fn(tx)
        // commit
        updates.push(...txOps)
        return result
      } catch (err) {
        // Re-throw so handleGLExpirySweep increments failed count
        throw err
      }
    },
  }
}

const cutoffMs = new Date('2026-06-28T00:00:00Z').getTime() - 30 * 86400000
const cutoff = { _ts: cutoffMs }

describe('handleGLExpirySweep', () => {
  it('expires every application that the query returned', async () => {
    const db = makeDb([
      { id: 'a-1', glStatus: 'issued', approvedAmount: 5000, agencyId: 'mal' },
      { id: 'a-2', glStatus: 'issued', approvedAmount: 3000, agencyId: 'pcso' },
    ])
    const result = await handleGLExpirySweep({ db, cutoff, cutoffMs, serverTimestamp, increment })
    expect(result.candidates).toBe(2)
    expect(result.expired).toBe(2)
    expect(result.releasedTotal).toBe(8000)
  })

  it('writes the expired-state fields on each app', async () => {
    const db = makeDb([
      { id: 'a-1', glStatus: 'issued', approvedAmount: 5000, agencyId: 'mal' },
    ])
    await handleGLExpirySweep({ db, cutoff, cutoffMs, serverTimestamp, increment })
    // First update is the app's expiry; second is the budget release
    const appUpdate = db._updates.find(u => u.ref._path.startsWith('applications/'))
    expect(appUpdate.data).toEqual({
      glStatus:    'expired',
      glExpiredAt: 'MOCK_TS',
      glExpiredBy: 'system_sweep',
      updatedAt:   'MOCK_TS',
    })
  })

  it('releases committed budget back to the owning agency', async () => {
    const db = makeDb([
      { id: 'a-1', glStatus: 'issued', approvedAmount: 5000, agencyId: 'mal' },
    ])
    await handleGLExpirySweep({ db, cutoff, cutoffMs, serverTimestamp, increment })
    const agencyUpdate = db._updates.find(u => u.ref._path === 'agencies/mal')
    expect(agencyUpdate).toBeTruthy()
    expect(agencyUpdate.data['budget.committed']).toEqual({ __op: 'increment', value: -5000 })
  })

  it('REGRESSION GUARD: skips raced flips (status changed between query and tx)', async () => {
    // Coordinator clicked "Mark Expired" between the query and the
    // transaction. The fresh read inside the tx should see glStatus !=
    // 'issued' and skip the update -- otherwise budget release doubles.
    const db = makeDb(
      [{ id: 'raced', glStatus: 'issued', approvedAmount: 5000, agencyId: 'mal' }],
      { raced: { fresh: { exists: true, data: () => ({ glStatus: 'expired' }) } } },
    )
    const result = await handleGLExpirySweep({ db, cutoff, cutoffMs, serverTimestamp, increment })
    expect(result.expired).toBe(1)  // outer counter increments
    expect(result.skippedRaced).toBe(1)
    expect(result.releasedTotal).toBe(0)  // but no budget released
    expect(db._updates).toHaveLength(0)   // and no writes
  })

  it('REGRESSION GUARD: skips raced deletion (doc gone between query and tx)', async () => {
    const db = makeDb(
      [{ id: 'gone', glStatus: 'issued', approvedAmount: 5000, agencyId: 'mal' }],
      { gone: { fresh: { exists: false, data: () => null } } },
    )
    const result = await handleGLExpirySweep({ db, cutoff, cutoffMs, serverTimestamp, increment })
    expect(result.skippedRaced).toBe(1)
    expect(db._updates).toHaveLength(0)
  })

  it('counts skippedNoAgency when an app has no agencyId', async () => {
    const db = makeDb([
      { id: 'orphan', glStatus: 'issued', approvedAmount: 5000, agencyId: null },
    ])
    const result = await handleGLExpirySweep({ db, cutoff, cutoffMs, serverTimestamp, increment })
    expect(result.expired).toBe(1)        // app still gets flipped to expired
    expect(result.skippedNoAgency).toBe(1) // but no budget release attempted
  })

  it('counts skippedNoAgency separately from skippedRaced', async () => {
    const db = makeDb([
      { id: 'orphan', glStatus: 'issued', approvedAmount: 5000, agencyId: null },
      { id: 'normal', glStatus: 'issued', approvedAmount: 3000, agencyId: 'mal' },
    ])
    const result = await handleGLExpirySweep({ db, cutoff, cutoffMs, serverTimestamp, increment })
    expect(result.expired).toBe(2)
    expect(result.skippedNoAgency).toBe(1)
    expect(result.skippedRaced).toBe(0)
    expect(result.releasedTotal).toBe(3000)
  })

  it('returns an ISO cutoff string in the result for log context', async () => {
    const db = makeDb([])
    const result = await handleGLExpirySweep({ db, cutoff, cutoffMs, serverTimestamp, increment })
    expect(result.cutoffISO).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})

// 2026-11-16: each GL stores glExpiresAt (10 days); older GLs keep 30 days.
// With nowMs the sweep expires only candidates past their own validity.
describe('per-letter validity (nowMs)', () => {
  const DAY = 86400000
  const ts = (ms) => ({ toMillis: () => ms })
  const now = Date.UTC(2026, 11, 1)
  it('expires a new GL past glExpiresAt and a legacy GL past 30 days, not the rest', async () => {
    const db = makeDb([
      { id: 'newDue',    glStatus: 'issued', agencyId: 'a', approvedAmount: 100, approvedAt: ts(now - 12 * DAY), glExpiresAt: ts(now - DAY) },
      { id: 'newValid',  glStatus: 'issued', agencyId: 'a', approvedAmount: 100, approvedAt: ts(now - 11 * DAY), glExpiresAt: ts(now + DAY) },
      { id: 'legacyOld', glStatus: 'issued', agencyId: 'a', approvedAmount: 100, approvedAt: ts(now - 40 * DAY) },
      { id: 'legacyNew', glStatus: 'issued', agencyId: 'a', approvedAmount: 100, approvedAt: ts(now - 15 * DAY) },
    ])
    const r = await handleGLExpirySweep({ db, cutoff: 'C', serverTimestamp, increment, nowMs: now })
    expect(r.expired).toBe(2)
    expect(r.skippedNotDue).toBe(2)
    expect(r.releasedTotal).toBe(200)
  })
})

describe('deleted agencies (2026-11-16)', () => {
  it('expires a letter whose agency no longer exists, without touching a budget', async () => {
    const db = makeDb([{ id: 'orphan', glStatus: 'issued', agencyId: 'ambag', approvedAmount: 1000 }], { missingAgencies: ['ambag'] })
    const r = await handleGLExpirySweep({ db, cutoff: 'C', serverTimestamp, increment })
    expect(r.expired).toBe(1)
    expect(r.failed).toBe(0)
    expect(r.releasedTotal).toBe(0)
    expect(r.skippedNoAgency).toBe(1)
  })
})
