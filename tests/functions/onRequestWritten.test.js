/**
 * onRequestWritten — pure-handler tests. Server-side staff notifications for the
 * request-lifecycle events a patient used to fire client-side (abuse hardening
 * #1): new request → admins, patient withdrawal → admins. Everything else skips.
 *
 * Also tests syncActiveRequest — the one-active-request guard mirror (abuse
 * hardening #3): keeps users/{patientId}.activeRequestId in step with the
 * request's active/terminal state so the requests.create rule can enforce
 * "one active request per patient".
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

vi.mock('firebase-admin', () => ({ default: { firestore: () => ({}) }, firestore: () => ({}) }))
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (o, fn) => fn }))

let handleRequestWritten, syncActiveRequest
beforeAll(() => {
  const mod = require('../../functions/src/onRequestWritten')
  handleRequestWritten = mod.handleRequestWritten
  syncActiveRequest    = mod.syncActiveRequest
})
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

// ── one-active-request guard (abuse hardening #3) ──────────────────────────
// Mock db exposing users.doc(id).get()/set()/update(). FieldValue.delete() is a
// sentinel the mock update() honours by removing the key.
const FieldValue = { delete: () => ({ __delete: true }) }
function makeUserDb(initial = {}) {
  const users = JSON.parse(JSON.stringify(initial))
  const calls = { set: [], update: [], get: [] }
  const db = {
    users, calls,
    collection(name) {
      if (name === 'users') return {
        where: () => ({ get: async () => ({ empty: true, size: 0, docs: [] }) }),
        doc: (id) => ({
          get: async () => { calls.get.push(id); return { exists: id in users, data: () => users[id] } },
          set: async (d) => { calls.set.push({ id, d }); users[id] = { ...(users[id] || {}), ...d } },
          update: async (d) => {
            calls.update.push({ id, d })
            const u = { ...(users[id] || {}) }
            for (const k of Object.keys(d)) { if (d[k] && d[k].__delete) delete u[k]; else u[k] = d[k] }
            users[id] = u
          },
        }),
      }
      if (name === 'notifications') return { doc: () => ({ collection: () => ({ add: async () => {} }) }) }
      return {}
    },
  }
  return db
}

describe('syncActiveRequest — one-active-request guard', () => {
  it('sets activeRequestId on a new (active) request', async () => {
    const db = makeUserDb({ p1: {} })
    const r = await syncActiveRequest({ db, before: null, after: { patientId: 'p1', status: 'submitted' }, requestId: 'req-1', FieldValue })
    expect(r.active).toBe('set')
    expect(db.users.p1.activeRequestId).toBe('req-1')
  })

  it('backfills the pointer for a pre-existing active request whose pointer was never set', async () => {
    const db = makeUserDb({ p1: {} }) // active request, but user has no pointer
    const r = await syncActiveRequest({ db, before: { patientId: 'p1', status: 'assessment' }, after: { patientId: 'p1', status: 'endorsed' }, requestId: 'req-1', FieldValue })
    expect(r.active).toBe('set')
    expect(db.users.p1.activeRequestId).toBe('req-1')
  })

  it('does NOT rewrite an already-correct pointer (no churn on status advance)', async () => {
    const db = makeUserDb({ p1: { activeRequestId: 'req-1' } })
    const r = await syncActiveRequest({ db, before: { patientId: 'p1', status: 'submitted' }, after: { patientId: 'p1', status: 'under_review' }, requestId: 'req-1', FieldValue })
    expect(r.active).toBe('already-set')
    expect(db.calls.set).toEqual([])
    expect(db.calls.update).toEqual([])
  })

  it('clears the pointer when the request goes terminal (fully_funded)', async () => {
    const db = makeUserDb({ p1: { activeRequestId: 'req-1' } })
    const r = await syncActiveRequest({ db, before: { patientId: 'p1', status: 'partially_funded' }, after: { patientId: 'p1', status: 'fully_funded' }, requestId: 'req-1', FieldValue })
    expect(r.active).toBe('cleared')
    expect(db.users.p1.activeRequestId).toBeUndefined()
  })

  it('clears the pointer on a patient withdrawal (active → closed)', async () => {
    const db = makeUserDb({ p1: { activeRequestId: 'req-1' } })
    const r = await syncActiveRequest({ db, before: { patientId: 'p1', status: 'submitted' }, after: { patientId: 'p1', status: 'closed', closeReason: 'Withdrawn by applicant.' }, requestId: 'req-1', FieldValue })
    expect(r.active).toBe('cleared')
    expect(db.users.p1.activeRequestId).toBeUndefined()
  })

  it('does NOT clobber a pointer that names a DIFFERENT request', async () => {
    const db = makeUserDb({ p1: { activeRequestId: 'req-OTHER' } })
    const r = await syncActiveRequest({ db, before: { patientId: 'p1', status: 'submitted' }, after: { patientId: 'p1', status: 'rejected' }, requestId: 'req-1', FieldValue })
    expect(r.active).toBe('clear-skipped')
    expect(db.users.p1.activeRequestId).toBe('req-OTHER')
  })

  it('skips when the request carries no patientId', async () => {
    const db = makeUserDb({})
    const r = await syncActiveRequest({ db, before: null, after: { status: 'submitted' }, requestId: 'req-1', FieldValue })
    expect(r.skipped).toBe('no-patient')
    expect(db.calls.get).toEqual([])
  })

  it('handleRequestWritten runs BOTH concerns (notify + active sync)', async () => {
    const db = makeUserDb({ p1: {} })
    const after = { patientId: 'p1', patientName: 'Juan', assistanceType: 'Chemo', totalBill: 1000, requestId: 'CRMC-1', status: 'submitted' }
    const r = await handleRequestWritten({ db, before: null, after, requestId: 'req-1', serverTimestamp, FieldValue })
    expect(r.event).toBe('created')       // notify ran
    expect(r.activeSync.active).toBe('set') // guard ran
    expect(db.users.p1.activeRequestId).toBe('req-1')
  })
})
