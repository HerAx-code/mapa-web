/**
 * onDocumentCountChanged — pure-handler tests. Maintains
 * users/{patientId}.documentCount (+1 create, -1 delete) so the documents.create
 * rule can cap a patient's upload count (abuse hardening #5). Updates (e.g. a
 * replace, same doc id) don't change the count.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

vi.mock('firebase-admin', () => ({ default: { firestore: () => ({}) }, firestore: () => ({}) }))
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (o, fn) => fn }))

let handleDocumentCountChanged
beforeAll(() => { handleDocumentCountChanged = require('../../functions/src/onDocumentCountChanged').handleDocumentCountChanged })

// FieldValue.increment(n) → a sentinel the mock set() applies to the field.
const FieldValue = { increment: (n) => ({ __inc: n }) }
function makeDb(initial = {}) {
  const users = JSON.parse(JSON.stringify(initial))
  const calls = { set: [] }
  return {
    users, calls,
    collection() {
      return {
        doc: (id) => ({
          set: async (d) => {
            calls.set.push({ id, d })
            const u = { ...(users[id] || {}) }
            for (const k of Object.keys(d)) {
              if (d[k] && typeof d[k].__inc === 'number') u[k] = (u[k] || 0) + d[k].__inc
              else u[k] = d[k]
            }
            users[id] = u
          },
        }),
      }
    },
  }
}

describe('handleDocumentCountChanged', () => {
  it('increments on a new document (create)', async () => {
    const db = makeDb({ p1: { documentCount: 3 } })
    const r = await handleDocumentCountChanged({ db, before: null, after: { patientId: 'p1' }, FieldValue })
    expect(r.delta).toBe(1)
    expect(db.users.p1.documentCount).toBe(4)
  })

  it('starts from zero when the counter is absent', async () => {
    const db = makeDb({ p1: {} })
    await handleDocumentCountChanged({ db, before: null, after: { patientId: 'p1' }, FieldValue })
    expect(db.users.p1.documentCount).toBe(1)
  })

  it('decrements on a delete', async () => {
    const db = makeDb({ p1: { documentCount: 3 } })
    const r = await handleDocumentCountChanged({ db, before: { patientId: 'p1' }, after: null, FieldValue })
    expect(r.delta).toBe(-1)
    expect(db.users.p1.documentCount).toBe(2)
  })

  it('does NOT change the count on an update (e.g. a re-upload/replace)', async () => {
    const db = makeDb({ p1: { documentCount: 3 } })
    const r = await handleDocumentCountChanged({ db, before: { patientId: 'p1', status: 'rejected' }, after: { patientId: 'p1', status: 'pending' }, FieldValue })
    expect(r.skipped).toBe('no-count-change')
    expect(db.calls.set).toEqual([])
  })

  it('skips a document with no patientId', async () => {
    const db = makeDb({})
    const r = await handleDocumentCountChanged({ db, before: null, after: { status: 'pending' }, FieldValue })
    expect(r.skipped).toBe('no-patient')
    expect(db.calls.set).toEqual([])
  })
})
