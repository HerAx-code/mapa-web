/**
 * onRequestWritten — pure-handler tests. Server-side staff notifications for the
 * request-lifecycle events a patient used to fire client-side (abuse hardening
 * #1): new request → admins, patient withdrawal → admins. Everything else skips.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

vi.mock('firebase-admin', () => ({ default: { firestore: () => ({}) }, firestore: () => ({}) }))
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (o, fn) => fn }))

let handleRequestWritten
beforeAll(() => { handleRequestWritten = require('../../functions/src/onRequestWritten').handleRequestWritten })
const serverTimestamp = () => 'TS'

// Mock db: users.where(...).get() → two admins; notifications/{id}/items.add() captured.
function makeDb(admins = [{ id: 'a1' }, { id: 'a2' }]) {
  const writes = []
  const usersSnap = { empty: admins.length === 0, size: admins.length, docs: admins }
  const chain = { where: () => chain, get: async () => usersSnap }
  return {
    writes,
    collection(name) {
      if (name === 'users') return chain
      if (name === 'notifications') return { doc: (id) => ({ collection: () => ({ add: async (d) => { writes.push({ id, d }) } }) }) }
      return {}
    },
  }
}

describe('handleRequestWritten', () => {
  it('notifies all admins on a new request (create)', async () => {
    const db = makeDb()
    const after = { patientName: 'Juan', assistanceType: 'Chemotherapy', totalBill: 120000, requestId: 'CRMC-2026-1' }
    const r = await handleRequestWritten({ db, before: null, after, requestId: 'x', serverTimestamp })
    expect(r.event).toBe('created')
    expect(r.notified).toBe(2)
    expect(db.writes.map(w => w.id)).toEqual(['a1', 'a2'])
    expect(db.writes[0].d.type).toBe('app_submitted')
    expect(db.writes[0].d.fromUid).toBeNull() // system-generated
    expect(db.writes[0].d.body).toContain('CRMC-2026-1')
  })

  it('notifies admins on a patient withdrawal (closeReason names it)', async () => {
    const db = makeDb()
    const before = { status: 'submitted' }
    const after  = { status: 'closed', closeReason: 'Withdrawn by applicant.', patientName: 'Juan', assistanceType: 'Medicines', requestId: 'CRMC-2026-2' }
    const r = await handleRequestWritten({ db, before, after, requestId: 'x', serverTimestamp })
    expect(r.event).toBe('withdrawn')
    expect(db.writes[0].d.type).toBe('app_withdrawn')
  })

  it('does NOT fire on an admin/agency close (no withdrawal reason)', async () => {
    const db = makeDb()
    const r = await handleRequestWritten({ db, before: { status: 'endorsed' }, after: { status: 'closed', closeReason: 'Closed by CRMC.' }, requestId: 'x', serverTimestamp })
    expect(r.skipped).toBe('no-notify-event')
    expect(db.writes).toEqual([])
  })

  it('skips ordinary updates (e.g. status advance)', async () => {
    const db = makeDb()
    const r = await handleRequestWritten({ db, before: { status: 'submitted' }, after: { status: 'under_review' }, requestId: 'x', serverTimestamp })
    expect(r.skipped).toBe('no-notify-event')
    expect(db.writes).toEqual([])
  })
})
