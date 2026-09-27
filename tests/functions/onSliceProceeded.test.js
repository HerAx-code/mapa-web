/**
 * onSliceProceeded — pure-handler tests. Notifies an agency's coordinators when
 * the patient accepts the endorsement (slice endorsed → reviewing). Moved
 * server-side in abuse hardening #1. Only that transition fires.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

vi.mock('firebase-admin', () => ({ default: { firestore: () => ({}) }, firestore: () => ({}) }))
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (o, fn) => fn }))

let handleSliceProceeded
beforeAll(() => { handleSliceProceeded = require('../../functions/src/onSliceProceeded').handleSliceProceeded })
const serverTimestamp = () => 'TS'

function makeDb(coords = [{ id: 'c1' }, { id: 'c2' }]) {
  const writes = []
  const snap = { empty: coords.length === 0, size: coords.length, docs: coords }
  const chain = { where: () => chain, get: async () => snap }
  return {
    writes,
    collection(name) {
      if (name === 'users') return chain
      if (name === 'notifications') return { doc: (id) => ({ collection: () => ({ add: async (d) => { writes.push({ id, d }) } }) }) }
      return {}
    },
  }
}

describe('handleSliceProceeded', () => {
  it('notifies agency coordinators on endorsed → reviewing', async () => {
    const db = makeDb()
    const r = await handleSliceProceeded({ db, before: { status: 'endorsed' }, after: { status: 'reviewing', agencyId: 'doh', patientName: 'Juan' }, serverTimestamp })
    expect(r.notified).toBe(2)
    expect(db.writes.map(w => w.id)).toEqual(['c1', 'c2'])
    expect(db.writes[0].d.fromUid).toBeNull()
  })

  it('skips non-proceed transitions', async () => {
    const db = makeDb()
    expect((await handleSliceProceeded({ db, before: { status: 'reviewing' }, after: { status: 'approved', agencyId: 'doh' }, serverTimestamp })).skipped).toBe('not-a-proceed')
    expect(db.writes).toEqual([])
  })

  it('skips when the slice has no agencyId', async () => {
    const db = makeDb()
    const r = await handleSliceProceeded({ db, before: { status: 'endorsed' }, after: { status: 'reviewing' }, serverTimestamp })
    expect(r.skipped).toBe('no-agency')
  })
})
