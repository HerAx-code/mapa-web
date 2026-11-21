/**
 * accountAdmin — eraseAccount, disableAccount, resetStaffMfa (Phase 1, T2).
 * Replaces deleteAuthUser, which let any Hospital Admin delete any sign-in
 * (gap I4). Every rule here is checked against both profiles on the server.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { memDb } from './helpers/memDb.js'

const require = createRequire(import.meta.url)
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (o, fn) => fn,
  HttpsError: class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code } },
}))

let handleEraseAccount, handleDisableAccount, handleResetStaffMfa
beforeAll(() => {
  ;({ handleEraseAccount, handleDisableAccount, handleResetStaffMfa } = require('../../functions/src/accountAdmin'))
})

const H = 'hosp-a', OTHER = 'hosp-b'

function fakeAuth() {
  const calls = { deleted: [], updated: [], revoked: [] }
  return {
    calls,
    deleteUser: async (uid) => { calls.deleted.push(uid) },
    updateUser: async (uid, props) => { calls.updated.push({ uid, props }) },
    revokeRefreshTokens: async (uid) => { calls.revoked.push(uid) },
  }
}

const base = () => ({
  'users/ha': { role: 'super_admin', tenantId: H, name: 'Hospital Admin A', active: true },
  'users/ha2': { role: 'super_admin', tenantId: H, name: 'Second Admin', active: true },
  'users/sw': { role: 'staff_admin', tenantId: H, name: 'Social Worker' },
  'users/haB': { role: 'super_admin', tenantId: OTHER, name: 'Admin B' },
  'users/swB': { role: 'staff_admin', tenantId: OTHER },
  'users/co': { role: 'agency', agencyId: 'dswd', name: 'Coordinator' },
  'users/aa': { role: 'agency_admin', agencyId: 'dswd', name: 'Agency Admin', active: true },
  'users/pl': { role: 'platform_admin', name: 'Super Admin' },
  'users/pat': { role: 'patient', name: 'Juan Cruz', email: 'j@x.ph', contact: '09171234567', address: 'Brgy 1, Cotabato', barangay: 'Brgy 1', city: 'Cotabato', province: 'Maguindanao', birthdate: '1980-01-01', sex: 'male', tenantId: H, tenantIds: [H] },
})

const codeOf = async (p) => { try { await p; return null } catch (e) { return e.code } }

describe('eraseAccount — who may erase whom', () => {
  it('only a Hospital Admin', async () => {
    for (const caller of ['sw', 'co', 'aa', 'pl', 'pat']) {
      const db = memDb(base())
      expect(await codeOf(handleEraseAccount({ callerUid: caller, data: { uid: 'swB' }, db, auth: fakeAuth() }))).toBe('permission-denied')
    }
  })
  it("refuses another hospital's staff, the Super Admin, agency users and self", async () => {
    for (const uid of ['swB', 'pl', 'co', 'ha']) {
      const db = memDb(base())
      expect(await codeOf(handleEraseAccount({ callerUid: 'ha', data: { uid }, db, auth: fakeAuth() }))).not.toBeNull()
    }
  })
  it('deletes own-hospital staff: profile and sign-in, with a server audit entry', async () => {
    const db = memDb(base()); const auth = fakeAuth()
    const r = await handleEraseAccount({ callerUid: 'ha', data: { uid: 'sw' }, db, auth })
    expect(r.mode).toBe('staff_deleted')
    expect(db.store.has('users/sw')).toBe(false)
    expect(auth.calls.deleted).toEqual(['sw'])
    const audit = [...db.store.entries()].find(([k]) => k.startsWith('auditLog/'))[1]
    expect(audit).toMatchObject({ action: 'account_deleted', actorId: 'ha', targetId: 'sw', tenantId: H })
  })
  it('may delete another Hospital Admin (the caller remains, so the hospital is never left without one)', async () => {
    const db = memDb(base()); const auth = fakeAuth()
    expect(await codeOf(handleEraseAccount({ callerUid: 'ha', data: { uid: 'ha2' }, db, auth }))).toBeNull()
    expect(auth.calls.deleted).toEqual(['ha2'])
    // An inactive Hospital Admin can't act at all.
    const db2 = memDb({ ...base(), 'users/ha': { ...base()['users/ha'], active: false } })
    expect(await codeOf(handleEraseAccount({ callerUid: 'ha', data: { uid: 'sw' }, db: db2, auth: fakeAuth() }))).toBe('permission-denied')
  })
  it('refuses a target with no profile (its hospital cannot be checked)', async () => {
    const db = memDb(base())
    expect(await codeOf(handleEraseAccount({ callerUid: 'ha', data: { uid: 'ghost' }, db, auth: fakeAuth() }))).toBe('not-found')
  })
})

describe('eraseAccount — patients (D7)', () => {
  const neverEndorsed = () => ({
    ...base(),
    'requests/r1': { patientId: 'pat', tenantId: H, agencyIds: [], amountCommitted: 0 },
    'documents/d1': { patientId: 'pat', name: 'Billing statement' },
    'documentContents/d1': { patientId: 'pat', content: 'data:' },
    'documents/d2': { patientId: 'pat', name: 'Live selfie', storagePath: 'documents/pat/d2/x.jpg' },
    'documentContents/d2': { patientId: 'pat', content: 'data:' },
    'billKeys/hosp-a__B1': { requestId: 'r1', tenantId: H },
    'conversations/c1': { participants: ['sw', 'pat'] },
    'conversations/c1/messages/m1': { from: 'sw', text: 'hi' },
    'notifications/pat/items/n1': { title: 't' },
    'identityIndexByUser/pat': { keys: { phone: 'h1' } },
    'identityIndex/h1': { uids: ['pat', 'other'] },
    'identityFlags/hosp-a__pat': { uid: 'pat', tenantId: H },
    'hospitalIds/AAA-2026-00001': { status: 'used', patId: 'pat', tenantId: H, requestId: 'r1', bound: true },
    'hospitalIds/AAA-2026-00001/privateInfo/issued': { name: 'Juan Cruz' },
    'hospitalIds/AAA-2026-00001/privateInfo/details': { usedBy: 'Juan Cruz' },
    'auditLog/x1': { patientId: 'pat', targetName: 'Juan Cruz', action: 'doc_verified' },
  })

  it('never endorsed → everything erased, the code kept but unbound, audit names removed', async () => {
    const db = memDb(neverEndorsed()); const auth = fakeAuth(); const deletedFiles = []
    const bucket = { file: (p) => ({ delete: async () => { deletedFiles.push(p) } }) }
    const r = await handleEraseAccount({ callerUid: 'ha', data: { uid: 'pat' }, db, auth, bucket })
    expect(r.mode).toBe('erased')
    for (const k of ['users/pat', 'requests/r1', 'documents/d1', 'documentContents/d1', 'documents/d2', 'billKeys/hosp-a__B1',
      'conversations/c1', 'conversations/c1/messages/m1', 'notifications/pat/items/n1', 'identityIndexByUser/pat', 'identityFlags/hosp-a__pat',
      'hospitalIds/AAA-2026-00001/privateInfo/issued', 'hospitalIds/AAA-2026-00001/privateInfo/details']) {
      expect(db.store.has(k), k).toBe(false)
    }
    expect(deletedFiles).toEqual(['documents/pat/d2/x.jpg'])
    expect(db.store.get('hospitalIds/AAA-2026-00001')).toMatchObject({ status: 'used', patId: null, erased: true })
    expect(db.store.get('auditLog/x1').targetName).toBe('Erased patient')
    expect(auth.calls.deleted).toEqual(['pat'])
  })

  it('endorsed → restricted: sign-in, contact details and selfies go; the case stays', async () => {
    const data = neverEndorsed()
    data['requests/r1'] = { patientId: 'pat', tenantId: H, agencyIds: ['dswd'], amountCommitted: 5000 }
    data['applications/s1'] = { patientId: 'pat', requestId: 'r1' }
    const db = memDb(data); const auth = fakeAuth()
    const r = await handleEraseAccount({ callerUid: 'ha', data: { uid: 'pat' }, db, auth })
    expect(r.mode).toBe('restricted')
    const u = db.store.get('users/pat')
    for (const k of ['email', 'contact', 'address', 'barangay']) expect(u[k], k).toBeUndefined()
    expect(u).toMatchObject({ name: 'Juan Cruz', birthdate: '1980-01-01', sex: 'male', city: 'Cotabato', province: 'Maguindanao', active: false, deletion: true, erasedByUid: 'ha' })
    for (const k of ['requests/r1', 'applications/s1', 'documents/d1', 'documentContents/d1', 'conversations/c1/messages/m1', 'identityIndexByUser/pat']) {
      expect(db.store.has(k), k).toBe(true)
    }
    expect(db.store.has('documentContents/d2')).toBe(false)           // selfie content purged
    expect(db.store.get('documents/d2').selfieContentPurgedReason).toBe('account_restricted')
    expect(db.store.has('notifications/pat/items/n1')).toBe(false)
    expect(auth.calls.deleted).toEqual(['pat'])
  })

  it('a Certificate of Eligibility alone keeps the case', async () => {
    const db = memDb({ ...neverEndorsed(), 'eligibilityCertificates/r1__X': { patientId: 'pat', requestId: 'r1' } })
    expect((await handleEraseAccount({ callerUid: 'ha', data: { uid: 'pat' }, db, auth: fakeAuth() })).mode).toBe('restricted')
  })

  it('refuses a patient who also filed at another hospital, and one who never filed here', async () => {
    const db = memDb({ ...base(), 'users/pat': { ...base()['users/pat'], tenantIds: [H, OTHER] } })
    expect(await codeOf(handleEraseAccount({ callerUid: 'ha', data: { uid: 'pat' }, db, auth: fakeAuth() }))).toBe('failed-precondition')
    expect(await codeOf(handleEraseAccount({ callerUid: 'haB', data: { uid: 'pat' }, db: memDb(base()), auth: fakeAuth() }))).toBe('permission-denied')
  })

  it('a re-run after a partial failure finishes the job', async () => {
    const data = neverEndorsed(); delete data['requests/r1']; delete data['documents/d1']   // as if half done
    const db = memDb(data); const auth = { ...fakeAuth(), deleteUser: async () => { const e = new Error('gone'); e.code = 'auth/user-not-found'; throw e } }
    const r = await handleEraseAccount({ callerUid: 'ha', data: { uid: 'pat' }, db, auth, bucket: { file: () => ({ delete: async () => {} }) } })
    expect(r.mode).toBe('erased')
    expect(db.store.has('users/pat')).toBe(false)
  })
})

describe('disableAccount (P1-B)', () => {
  const run = (callerUid, uid, enable = false, data = base()) => {
    const db = memDb(data); const auth = fakeAuth()
    return { db, auth, p: handleDisableAccount({ callerUid, data: { uid, enable }, db, auth }) }
  }
  it('Agency Admin → own team; Super Admin → hospital and agency staff; Hospital Admin → own staff', async () => {
    expect(await codeOf(run('aa', 'co').p)).toBeNull()
    expect(await codeOf(run('pl', 'co').p)).toBeNull()
    expect(await codeOf(run('pl', 'sw').p)).toBeNull()
    expect(await codeOf(run('ha', 'sw').p)).toBeNull()
  })
  it('refuses everything else', async () => {
    for (const [c, t] of [['co', 'aa'], ['aa', 'sw'], ['ha', 'swB'], ['ha', 'co'], ['ha', 'pat'], ['pl', 'pat'], ['ha', 'pl'], ['aa', 'aa']]) {
      expect(await codeOf(run(c, t).p), `${c}→${t}`).toBe('permission-denied')
    }
  })
  it('blocks the sign-in and signs the person out; enabling restores it', async () => {
    const a = run('aa', 'co'); await a.p
    expect(a.auth.calls.updated).toEqual([{ uid: 'co', props: { disabled: true } }])
    expect(a.auth.calls.revoked).toEqual(['co'])
    expect(a.db.store.get('users/co').active).toBe(false)
    const b = run('aa', 'co', true); await b.p
    expect(b.auth.calls.updated).toEqual([{ uid: 'co', props: { disabled: false } }])
    expect(b.db.store.get('users/co').active).toBe(true)
  })
  it("won't disable the last active Agency Admin or Hospital Admin", async () => {
    expect(await codeOf(run('pl', 'aa').p)).toBe('failed-precondition')
    const data = base(); delete data['users/ha2']
    expect(await codeOf(run('pl', 'ha', false, data).p)).toBe('failed-precondition')
  })
})

describe('resetStaffMfa (P1-C)', () => {
  const run = (callerUid, uid) => {
    const db = memDb(base()); const auth = fakeAuth()
    return { db, auth, p: handleResetStaffMfa({ callerUid, data: { uid }, db, auth }) }
  }
  it('Hospital Admin → own staff; Super Admin → Hospital Admins and agency staff', async () => {
    const a = run('ha', 'sw'); await a.p
    expect(a.auth.calls.updated).toEqual([{ uid: 'sw', props: { multiFactor: { enrolledFactors: null } } }])
    expect(a.auth.calls.revoked).toEqual(['sw'])
    expect(await codeOf(run('pl', 'haB').p)).toBeNull()
    expect(await codeOf(run('pl', 'co').p)).toBeNull()
  })
  it('refuses everything else', async () => {
    for (const [c, t] of [['ha', 'swB'], ['ha', 'co'], ['sw', 'ha'], ['aa', 'co'], ['pl', 'sw'], ['ha', 'pat'], ['ha', 'ha']]) {
      expect(await codeOf(run(c, t).p), `${c}→${t}`).toBe('permission-denied')
    }
  })
})
