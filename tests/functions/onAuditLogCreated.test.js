import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// Multi-hospital Phase 9 — agency audit entries get the CASE's hospital.
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: (_opts, fn) => fn }))
vi.mock('firebase-functions', () => ({ logger: { error: vi.fn(), info: vi.fn() } }))
vi.mock('firebase-admin', () => ({ default: { firestore: () => ({}) }, firestore: () => ({}) }))

let handleAuditLogCreated
beforeAll(() => {
  ;({ handleAuditLogCreated } = require('../../functions/src/onAuditLogCreated'))
})

function makeDb(docs) {
  return { doc: (path) => ({ get: async () => ({ exists: path in docs, data: () => docs[path] }) }) }
}
const makeRef = () => { const ref = { updates: [], update: async (d) => { ref.updates.push(d) } }; return ref }

describe('handleAuditLogCreated', () => {
  it("stamps an agency entry with its request's hospital", async () => {
    const ref = makeRef()
    const r = await handleAuditLogCreated({
      db: makeDb({ 'requests/r1': { tenantId: 'bgh' } }),
      entry: { actorRole: 'agency', action: 'gl_redeemed', requestId: 'r1' }, ref,
    })
    expect(r).toEqual({ stamped: 'bgh' })
    expect(ref.updates).toEqual([{ tenantId: 'bgh' }])
  })

  it('an untagged (pre-backfill) request means hospital #1', async () => {
    const ref = makeRef()
    await handleAuditLogCreated({ db: makeDb({ 'requests/r1': {} }), entry: { requestId: 'r1' }, ref })
    expect(ref.updates).toEqual([{ tenantId: 'hospital-1' }])
  })

  it('falls back to the slice for an application entry with no requestId', async () => {
    const ref = makeRef()
    await handleAuditLogCreated({
      db: makeDb({ 'applications/a1': { tenantId: 'bgh' } }),
      entry: { targetType: 'application', targetId: 'a1' }, ref,
    })
    expect(ref.updates).toEqual([{ tenantId: 'bgh' }])
  })

  it('never re-tags an entry that already has a hospital', async () => {
    const ref = makeRef()
    const r = await handleAuditLogCreated({ db: makeDb({}), entry: { tenantId: 'hospital-1', requestId: 'r1' }, ref })
    expect(r.skipped).toBe('already-tagged')
    expect(ref.updates).toEqual([])
  })

  it('leaves network actions (no case) untagged', async () => {
    const ref = makeRef()
    const r = await handleAuditLogCreated({ db: makeDb({}), entry: { action: 'agency_updated', targetType: 'agency', targetId: 'dswd' }, ref })
    expect(r.skipped).toBe('no-case')
    expect(ref.updates).toEqual([])
  })

  it('a deleted request leaves the entry untagged', async () => {
    const ref = makeRef()
    const r = await handleAuditLogCreated({ db: makeDb({}), entry: { requestId: 'gone' }, ref })
    expect(r.skipped).toBe('no-case')
  })
})
