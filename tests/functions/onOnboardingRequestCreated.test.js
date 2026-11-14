import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

// A hospital's public onboarding request pings every network operator.
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: (_o, fn) => fn }))
vi.mock('firebase-functions', () => ({ logger: { error: vi.fn(), info: vi.fn() } }))
vi.mock('firebase-admin', () => ({ default: { firestore: () => ({}) }, firestore: () => ({}) }))

let handle
beforeAll(() => { handle = require('../../functions/src/onOnboardingRequestCreated').handleOnboardingRequestCreated })

function makeDb(operators = [{ id: 'op1' }, { id: 'op2' }]) {
  const writes = []
  const queries = []
  const snap = { empty: operators.length === 0, size: operators.length, docs: operators }
  return {
    writes, queries,
    collection(name) {
      if (name === 'users') return { where: (...w) => { queries.push(w); return { get: async () => snap } } }
      if (name === 'notifications') return { doc: (id) => ({ collection: () => ({ add: async (d) => { writes.push({ id, d }) } }) }) }
      return {}
    },
  }
}
const serverTimestamp = () => 'TS'

describe('handleOnboardingRequestCreated', () => {
  it('notifies every platform admin, system-generated', async () => {
    const db = makeDb()
    const r = await handle({ db, request: { status: 'new', hospitalName: 'Davao Regional', region: 'Region XI', email: 'x@y.z' }, serverTimestamp })
    expect(r).toEqual({ notified: 2 })
    expect(db.queries).toEqual([['role', '==', 'platform_admin']])
    expect(db.writes.map((w) => w.id)).toEqual(['op1', 'op2'])
    expect(db.writes[0].d).toMatchObject({ type: 'onboarding_request', fromUid: null, read: false })
    expect(db.writes[0].d.body).toContain('Davao Regional (Region XI)')
  })

  it("keeps the sender's contact details out of the notification", async () => {
    const db = makeDb()
    await handle({ db, request: { status: 'new', hospitalName: 'H', contactName: 'Dr. Ana', email: 'ana@h.org' }, serverTimestamp })
    expect(JSON.stringify(db.writes)).not.toContain('ana@h.org')
    expect(JSON.stringify(db.writes)).not.toContain('Dr. Ana')
  })

  it('does nothing without operators, or for a non-new doc', async () => {
    expect(await handle({ db: makeDb([]), request: { status: 'new', hospitalName: 'H' }, serverTimestamp })).toEqual({ skipped: 'no-operators' })
    expect(await handle({ db: makeDb(), request: { status: 'contacted' }, serverTimestamp })).toEqual({ skipped: 'not-new' })
  })
})
