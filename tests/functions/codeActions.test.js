/**
 * Access codes on the server — Phase 3 PR 3.4 (P3-F, gaps I1, M10, R4).
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

let handleIssueAccessCode, handleClaimAccessCode, codeProof
beforeAll(() => {
  ;({ handleIssueAccessCode, handleClaimAccessCode } = require('../../functions/src/codeActions'))
  ;({ codeProof } = require('../../functions/src/codeIssue'))
})

const H = 'hosp-a'
// A fixed "now" inside 2026 (noon Manila), so ids land in AAA-2026-NNNNN.
const NOW = Date.UTC(2026, 5, 1, 4, 0, 0)
const deps = { now: () => NOW, serverTimestamp: () => 'TS' }
const codeOf = async (p) => { try { await p; return null } catch (e) { return e.code } }

const ISSUE_FORM = {
  lastName: 'Reyes', firstName: 'Ana', middleName: '', suffix: '', birthdate: '1992-02-02',
  contact: '', visitDate: '2026-06-01', caseNumber: '', idType: 'PhilSys National ID', idLast4: '',
}

const issueBase = (x = {}) => ({
  'users/sw1': { role: 'staff_admin', tenantId: H, name: 'Ana SW' },
  'hospitals/hosp-a': { accessCodePrefix: 'AAA', enabled: true },
  'accessCodeCounters/AAA__2026': { next: 1 },
  ...x,
})
const issue = (db, data, uid = 'sw1') => handleIssueAccessCode({ callerUid: uid, data, db, ...deps })

describe('issueAccessCode (M10)', () => {
  it("issues under the hospital's own prefix from the counter, writing the bound record + audit", async () => {
    const db = memDb(issueBase())
    const r = await issue(db, { ...ISSUE_FORM })
    expect(r.id).toBe('AAA-2026-00001')
    expect(db.store.get('accessCodeCounters/AAA__2026').next).toBe(2)
    expect(db.store.get('hospitalIds/AAA-2026-00001')).toMatchObject({ tenantId: H, status: 'available', patId: null, bound: true })
    expect(db.store.get('hospitalIds/AAA-2026-00001/privateInfo/issued').proof).toBe(codeProof('Reyes', '1992-02-02'))
    const audit = [...db.store.entries()].find(([k]) => k.startsWith('auditLog/'))[1]
    expect(audit).toMatchObject({ action: 'hospitalid_issued', targetId: 'AAA-2026-00001', tenantId: H })
  })

  it('two desks issuing in turn never pick the same number', async () => {
    const db = memDb(issueBase())
    const a = await issue(db, { ...ISSUE_FORM })
    const b = await issue(db, { ...ISSUE_FORM, firstName: 'Ben', lastName: 'Santos' })
    expect([a.id, b.id]).toEqual(['AAA-2026-00001', 'AAA-2026-00002'])
    expect(db.store.get('accessCodeCounters/AAA__2026').next).toBe(3)
  })

  it('never reissues a deleted number (the counter only moves forward)', async () => {
    const db = memDb(issueBase())
    await issue(db, { ...ISSUE_FORM })
    db.store.delete('hospitalIds/AAA-2026-00001') // staff delete the first code
    const b = await issue(db, { ...ISSUE_FORM, firstName: 'Ben', lastName: 'Santos' })
    expect(b.id).toBe('AAA-2026-00002')
  })

  it('warns (does not block) when the patient already holds an open code; confirm issues anyway', async () => {
    const db = memDb(issueBase({
      'hospitalIds/AAA-2026-00001': { tenantId: H, status: 'used', patId: 'ana', bound: true },
      'hospitalIds/AAA-2026-00001/privateInfo/issued': { proof: codeProof('Reyes', '1992-02-02') },
      'accessCodeCounters/AAA__2026': { next: 2 },
    }))
    const warn = await issue(db, { ...ISSUE_FORM })
    expect(warn).toMatchObject({ needsConfirm: true, openCode: 'AAA-2026-00001' })
    expect([...db.store.keys()].some((k) => k === 'hospitalIds/AAA-2026-00002')).toBe(false) // nothing issued yet
    const done = await issue(db, { ...ISSUE_FORM, confirm: true })
    expect(done.id).toBe('AAA-2026-00002')
  })

  it('refuses when the counter has not been seeded, rather than risk a collision', async () => {
    const db = memDb(issueBase({ 'accessCodeCounters/AAA__2026': undefined }))
    db.store.delete('accessCodeCounters/AAA__2026')
    expect(await codeOf(issue(db, { ...ISSUE_FORM }))).toBe('failed-precondition')
  })

  it('issues a course code within ~3 months and refuses a longer one', async () => {
    const db = memDb(issueBase())
    const ok = await issue(db, { ...ISSUE_FORM, course: true, courseUntil: '2026-07-01' }) // 30 days
    expect(ok).toMatchObject({ id: 'AAA-2026-00001', courseUntil: '2026-07-01' })
    expect(db.store.get('hospitalIds/AAA-2026-00001').courseUntil).toBeDefined()
    expect(await codeOf(issue(memDb(issueBase()), { ...ISSUE_FORM, course: true, courseUntil: '2026-10-01' }))).toBe('invalid-argument') // ~122 days
  })

  it('refuses a paused hospital and a non-gateway caller', async () => {
    const closed = memDb(issueBase({ 'hospitals/hosp-a': { accessCodePrefix: 'AAA', enabled: false } }))
    expect(await codeOf(issue(closed, { ...ISSUE_FORM }))).toBe('failed-precondition')
    const db = memDb(issueBase({ 'users/pat': { role: 'patient', tenantId: H } }))
    expect(await codeOf(issue(db, { ...ISSUE_FORM }, 'pat'))).toBe('permission-denied')
  })
})

// ── claimAccessCode ──────────────────────────────────────────────────────────

const claimBase = (x = {}) => ({
  'users/juan': { role: 'patient', lastName: 'Cruz', birthdate: '1990-01-01', name: 'Juan Cruz' },
  'users/ana': { role: 'patient', lastName: 'Reyes', birthdate: '1992-02-02', name: 'Ana Reyes' },
  'hospitals/hosp-a': { enabled: true },
  'hospitalIds/AAA-2026-00001': { tenantId: H, status: 'available', bound: true },
  'hospitalIds/AAA-2026-00001/privateInfo/issued': {
    proof: codeProof('Reyes', '1992-02-02'), name: 'Ana Reyes', nameParts: { lastName: 'Reyes' }, birthdate: '1992-02-02',
  },
  ...x,
})
const claim = (db, uid, data) => handleClaimAccessCode({ callerUid: uid, data, db, ...deps })

describe('claimAccessCode (I1, R4)', () => {
  it("lets the patient the code was issued to claim it, moving their current hospital", async () => {
    const db = memDb(claimBase())
    const fields = await claim(db, 'ana', { code: 'AAA-2026-00001', lastName: 'Reyes', birthdate: '1992-02-02' })
    expect(fields).toMatchObject({ tenantId: H, hospitalId: 'AAA-2026-00001' })
    expect(fields.tenantIds).toContain(H)
    expect(db.store.get('hospitalIds/AAA-2026-00001')).toMatchObject({ status: 'used', patId: 'ana' })
    expect(db.store.get('users/ana')).toMatchObject({ tenantId: H, hospitalId: 'AAA-2026-00001' })
    expect(db.store.get('hospitalIds/AAA-2026-00001/privateInfo/details').proof).toBe(codeProof('Reyes', '1992-02-02'))
  })

  it("refuses Juan claiming Ana's code — the check is against the ACCOUNT's own profile, not the typed values (I1)", async () => {
    const db = memDb(claimBase())
    // Juan types Ana's details, but his account says Cruz/1990 — denied.
    expect(await codeOf(claim(db, 'juan', { code: 'AAA-2026-00001', lastName: 'Reyes', birthdate: '1992-02-02' }))).toBe('permission-denied')
    expect(db.store.get('hospitalIds/AAA-2026-00001').status).toBe('available') // untouched
  })

  it('a fresh account (no profile name yet) adopts the code’s recorded identity', async () => {
    const db = memDb(claimBase({ 'users/new': { role: 'patient' } }))
    const fields = await claim(db, 'new', { code: 'AAA-2026-00001', lastName: 'Reyes', birthdate: '1992-02-02' })
    expect(fields).toMatchObject({ name: 'Ana Reyes', lastName: 'Reyes', birthdate: '1992-02-02', tenantId: H })
    expect(db.store.get('users/new')).toMatchObject({ name: 'Ana Reyes', lastName: 'Reyes' })
  })

  it('lets the owner re-use a code they hold that has not backed a request', async () => {
    const db = memDb(claimBase({ 'hospitalIds/AAA-2026-00001': { tenantId: H, status: 'used', patId: 'ana', bound: true } }))
    const fields = await claim(db, 'ana', { code: 'AAA-2026-00001', lastName: 'Reyes', birthdate: '1992-02-02' })
    expect(fields.hospitalId).toBe('AAA-2026-00001')
  })

  it('refuses a code already used by someone else, a paused hospital, and an unauthenticated caller', async () => {
    const used = memDb(claimBase({ 'hospitalIds/AAA-2026-00001': { tenantId: H, status: 'used', patId: 'someone', bound: true } }))
    expect(await codeOf(claim(used, 'ana', { code: 'AAA-2026-00001', lastName: 'Reyes', birthdate: '1992-02-02' }))).toBe('failed-precondition')
    const closed = memDb(claimBase({ 'hospitals/hosp-a': { enabled: false } }))
    expect(await codeOf(claim(closed, 'ana', { code: 'AAA-2026-00001', lastName: 'Reyes', birthdate: '1992-02-02' }))).toBe('failed-precondition')
    expect(await codeOf(claim(memDb(claimBase()), null, { code: 'AAA-2026-00001', lastName: 'Reyes', birthdate: '1992-02-02' }))).toBe('unauthenticated')
  })

  it('compares the last name on letters only (case, spaces and accents ignored)', async () => {
    // Code issued to "Dela Cruz"; the account says "delacruz" — same person.
    const db = memDb(claimBase({
      'users/dc': { role: 'patient', lastName: 'delacruz', birthdate: '1990-05-01', name: 'Juan delacruz' },
      'hospitalIds/AAA-2026-00001/privateInfo/issued': { proof: codeProof('Dela Cruz', '1990-05-01'), name: 'Juan Dela Cruz', nameParts: { lastName: 'Dela Cruz' }, birthdate: '1990-05-01' },
    }))
    const fields = await claim(db, 'dc', { code: 'AAA-2026-00001', lastName: 'delacruz', birthdate: '1990-05-01' })
    expect(fields.hospitalId).toBe('AAA-2026-00001')
  })

  it('a blank (pre-bound) code is claimable before the cutoff, refused after it', async () => {
    const blank = () => claimBase({ 'hospitalIds/AAA-2026-00001': { tenantId: H, status: 'available' } }) // no bound flag
    const before = { now: () => Date.UTC(2026, 10, 1), serverTimestamp: () => 'TS' } // Nov 2026 < 2026-12-15
    const after = { now: () => Date.UTC(2026, 11, 20), serverTimestamp: () => 'TS' }  // Dec 20 2026 > cutoff
    const okFields = await handleClaimAccessCode({ callerUid: 'ana', data: { code: 'AAA-2026-00001' }, db: memDb(blank()), ...before })
    expect(okFields.hospitalId).toBe('AAA-2026-00001')
    const codeAfter = await codeOf(handleClaimAccessCode({ callerUid: 'ana', data: { code: 'AAA-2026-00001' }, db: memDb(blank()), ...after }))
    expect(codeAfter).toBe('failed-precondition')
  })
})
