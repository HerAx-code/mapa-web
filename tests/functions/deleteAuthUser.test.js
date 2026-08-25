/**
 * deleteAuthUser — pure-handler unit tests.
 *
 * Pins the authorization + safety contract of the Auth-deletion callable
 * used by the patient right-to-erasure flow:
 *   - unauthenticated / missing target / self-delete are rejected
 *   - only a super_admin caller is allowed
 *   - a successful delete calls auth.deleteUser with the target uid
 *   - an already-absent account is treated as success (idempotent)
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

vi.mock('firebase-admin', () => ({
  default: { firestore: () => ({}), auth: () => ({}) },
  firestore: () => ({}),
  auth: () => ({}),
}))
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
// onCall returns the handler unchanged; HttpsError carries a `.code`.
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (opts, fn) => fn,
  HttpsError: class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code }
  },
}))

let handleDeleteAuthUser
beforeAll(() => {
  ;({ handleDeleteAuthUser } = require('../../functions/src/deleteAuthUser'))
})

// makeDeps(role): a Firestore double whose users/{uid}.get() returns the
// given caller role, and an auth double recording deleteUser calls.
function makeDeps(callerRole, { deleteThrows = null } = {}) {
  const deleted = []
  const db = {
    collection: () => ({
      doc: () => ({
        get: async () => ({
          exists: callerRole !== null,
          data: () => ({ role: callerRole }),
        }),
      }),
    }),
  }
  const auth = {
    deleteUser: async (uid) => {
      if (deleteThrows) { const e = new Error('x'); e.code = deleteThrows; throw e }
      deleted.push(uid)
    },
  }
  return { db, auth, deleted }
}

const call = (args, deps) =>
  handleDeleteAuthUser({ callerUid: 'admin-1', targetUid: 'patient-1', db: deps.db, auth: deps.auth, ...args })

async function code(promise) {
  try { await promise; return null } catch (e) { return e.code }
}

describe('deleteAuthUser — authorization', () => {
  it('rejects an unauthenticated caller', async () => {
    const d = makeDeps('super_admin')
    expect(await code(call({ callerUid: undefined }, d))).toBe('unauthenticated')
  })

  it('rejects a missing target uid', async () => {
    const d = makeDeps('super_admin')
    expect(await code(call({ targetUid: '' }, d))).toBe('invalid-argument')
  })

  it('rejects deleting your own account', async () => {
    const d = makeDeps('super_admin')
    expect(await code(call({ targetUid: 'admin-1' }, d))).toBe('invalid-argument')
  })

  it('rejects a staff_admin caller (not super_admin)', async () => {
    const d = makeDeps('staff_admin')
    expect(await code(call({}, d))).toBe('permission-denied')
  })

  it('rejects an agency caller', async () => {
    const d = makeDeps('agency')
    expect(await code(call({}, d))).toBe('permission-denied')
  })

  it('rejects a caller with no profile', async () => {
    const d = makeDeps(null)
    expect(await code(call({}, d))).toBe('permission-denied')
  })
})

describe('deleteAuthUser — deletion', () => {
  it('deletes the target uid for a super_admin', async () => {
    const d = makeDeps('super_admin')
    const res = await call({}, d)
    expect(res).toEqual({ deleted: true })
    expect(d.deleted).toEqual(['patient-1'])
  })

  it('treats an already-absent account as success (idempotent)', async () => {
    const d = makeDeps('super_admin', { deleteThrows: 'auth/user-not-found' })
    const res = await call({}, d)
    expect(res).toEqual({ deleted: false, reason: 'not-found' })
  })

  it('wraps an unexpected auth error as internal', async () => {
    const d = makeDeps('super_admin', { deleteThrows: 'auth/internal-error' })
    expect(await code(call({}, d))).toBe('internal')
  })
})
