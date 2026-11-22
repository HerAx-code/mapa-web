/**
 * caseActions — endorseRequest and closeRequest on the server (Phase 2 PR 2.2).
 * Gaps M8 (gate only in the browser), M14 (endorsing a closed case), M15
 * (second-person rule by uid), I6 (slots only counted in the browser).
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

let handleEndorseRequest, handleCloseRequest
beforeAll(() => { ;({ handleEndorseRequest, handleCloseRequest } = require('../../functions/src/caseActions')) })

const H = 'hosp-a', OTHER = 'hosp-b'
const NOW = Date.UTC(2026, 10, 22, 4, 0)           // 2026-11-22, 12:00 Manila
const TODAY = '2026-11-22'
const ts = (ms) => ({ toMillis: () => ms })
const serverTimestamp = () => 'TS'
const arrayUnion = (...v) => ({ union: v })

const sheet = (x = {}) => ({
  householdSize: 3, monthlyIncome: 5000, diagnosis: 'CKD', recommendation: 'Assist',
  meansTestCategory: 'indigent_c3', meansTestOverrideReason: 'Assessed by the social worker',
  completedBy: 'Ana SW', completedByUid: 'sw1', ...x,
})
const base = (x = {}) => ({
  'users/sw1': { role: 'staff_admin', tenantId: H, name: 'Ana SW' },
  'users/sw2': { role: 'staff_admin', tenantId: H, name: 'Ben SW' },
  'users/swB': { role: 'staff_admin', tenantId: OTHER, name: 'Other' },
  'users/co': { role: 'agency', agencyId: 'dswd' },
  'users/pat': { role: 'patient', tenantId: H, tenantIds: [H] },
  [`hospitals/${H}`]: { gatewayName: 'Medical Social Service' },
  'requests/r1': {
    requestId: 'REQ-1', status: 'under_review', amountNeeded: 10000, totalBill: 10000,
    patientId: 'pat', patientName: 'Pat', tenantId: H, intakeSheet: sheet(),
    attachedDocuments: [{ documentId: 'd1', name: 'Billing statement', status: 'pending' }],
  },
  'documents/d1': { status: 'verified', patientId: 'pat' },
  'agencies/dswd': { name: 'DSWD', enabled: true, partnerHospitalIds: [H], slots: { total: 5, remaining: 2 }, lastResetDate: TODAY },
  'agencies/pcso': { name: 'PCSO', enabled: true, partnerHospitalIds: [H], hospitalSlots: { [H]: { total: 3, remaining: 1, lastResetDate: TODAY } } },
  'agencies/far': { name: 'Far', enabled: true, partnerHospitalIds: [OTHER], slots: { total: 5, remaining: 5 } },
  ...x,
})
const endorse = (db, callerUid, agencyIds, extra = {}) =>
  handleEndorseRequest({ callerUid, data: { requestId: 'r1', agencyIds, ...extra }, db, now: () => NOW, serverTimestamp, arrayUnion })
const codeOf = async (p) => { try { await p; return null } catch (e) { return e.code } }
const slicesOf = (db) => [...db.store.entries()].filter(([k]) => k.startsWith('applications/')).map(([, v]) => v)

describe('endorseRequest', () => {
  it('endorses: slices, slots from the right share, request status, patient and documents stamped', async () => {
    const db = memDb(base())
    const r = await endorse(db, 'sw2', ['dswd', 'pcso'], { notes: 'Urgent' })
    expect(r.sliceIds).toHaveLength(2)
    expect(slicesOf(db).map((s) => s.agencyId).sort()).toEqual(['dswd', 'pcso'])
    expect(slicesOf(db)[0]).toMatchObject({ status: 'endorsed', amountRequested: 10000, tenantId: H, endorsedById: 'sw2', gatewayNotes: 'Urgent' })
    expect(db.store.get('agencies/dswd')['slots.remaining']).toBe(1)                  // agency-wide count
    expect(db.store.get('agencies/pcso')[`hospitalSlots.${H}.remaining`]).toBe(0)       // this hospital's share
    expect(db.store.get('requests/r1')).toMatchObject({ status: 'endorsed', amountCommitted: 0, openLetters: 0 })
    expect(db.store.get('users/pat').agencyIds).toEqual({ union: ['dswd', 'pcso'] })
    expect(db.store.get('documents/d1').agencyIds).toEqual({ union: ['dswd', 'pcso'] })
    const audit = [...db.store.entries()].find(([k]) => k.startsWith('auditLog/'))[1]
    expect(audit).toMatchObject({ action: 'request_endorsed', actorId: 'sw2', requestId: 'r1', tenantId: H })
  })

  it('refuses a case closed meanwhile (M14) and another hospital', async () => {
    const db = memDb(base({ 'requests/r1': { ...base()['requests/r1'], status: 'closed' } }))
    expect(await codeOf(endorse(db, 'sw2', ['dswd']))).toBe('failed-precondition')
    expect(await codeOf(endorse(memDb(base()), 'swB', ['dswd']))).toBe('permission-denied')
    expect(await codeOf(endorse(memDb(base()), 'co', ['dswd']))).toBe('permission-denied')
  })

  it('re-runs the gate on the server: unverified documents block (M8)', async () => {
    const db = memDb(base({ 'documents/d1': { status: 'pending' } }))
    expect(await codeOf(endorse(db, 'sw2', ['dswd']))).toBe('failed-precondition')
    expect(slicesOf(db)).toHaveLength(0)
  })

  it('second-person rule by uid: whoever completed the assessment cannot endorse above the threshold (M15)', async () => {
    const data = base({ 'hospitalSettings/hosp-a': { secondPersonAboveAmount: 5000 } })
    expect(await codeOf(endorse(memDb(data), 'sw1', ['dswd']))).toBe('failed-precondition')
    expect(await codeOf(endorse(memDb(data), 'sw2', ['dswd']))).toBeNull()
  })

  it('a required verification call blocks until recorded', async () => {
    const data = base({ 'hospitalSettings/hosp-a': { interviewAboveAmount: 5000 } })
    expect(await codeOf(endorse(memDb(data), 'sw2', ['dswd']))).toBe('failed-precondition')
    const withCall = base({
      'hospitalSettings/hosp-a': { interviewAboveAmount: 5000 },
      'requests/r1': { ...base()['requests/r1'], intakeSheet: sheet({ verificationCall: { at: 'x', byUid: 'sw1' } }) },
    })
    expect(await codeOf(endorse(memDb(withCall), 'sw2', ['dswd']))).toBeNull()
  })

  it('slots are enforced on the server (I6): none left today → refused, nothing written', async () => {
    const db = memDb(base({ 'agencies/dswd': { name: 'DSWD', partnerHospitalIds: [H], slots: { total: 5, remaining: 0 }, lastResetDate: TODAY } }))
    expect(await codeOf(endorse(db, 'sw2', ['dswd']))).toBe('resource-exhausted')
    expect(slicesOf(db)).toHaveLength(0)
  })

  it('a count from an earlier day has refilled', async () => {
    const db = memDb(base({ 'agencies/dswd': { name: 'DSWD', partnerHospitalIds: [H], slots: { total: 5, remaining: 0 }, lastResetDate: '2026-11-21' } }))
    expect(await codeOf(endorse(db, 'sw2', ['dswd']))).toBeNull()
    expect(db.store.get('agencies/dswd')).toMatchObject({ 'slots.remaining': 4, lastResetDate: TODAY })
  })

  it('refuses a non-partner, a disabled agency, and an agency already endorsed', async () => {
    expect(await codeOf(endorse(memDb(base()), 'sw2', ['far']))).toBe('failed-precondition')
    expect(await codeOf(endorse(memDb(base({ 'agencies/dswd': { ...base()['agencies/dswd'], enabled: false } })), 'sw2', ['dswd']))).toBe('failed-precondition')
    const db = memDb(base({ 'applications/s0': { requestId: 'r1', agencyId: 'dswd', status: 'rejected' } }))
    expect(await codeOf(endorse(db, 'sw2', ['dswd']))).toBe('failed-precondition')
  })
})

describe('closeRequest', () => {
  const close = (db, callerUid, outcome, reason) =>
    handleCloseRequest({ callerUid, data: { requestId: 'r1', outcome, reason }, db, now: () => NOW, serverTimestamp })

  it('closes open slices and gives back a slot taken today', async () => {
    const db = memDb(base({
      'requests/r1': { ...base()['requests/r1'], status: 'endorsed' },
      'applications/s1': { requestId: 'r1', agencyId: 'dswd', status: 'reviewing', endorsedAt: ts(NOW - 3600e3) },
      'applications/s2': { requestId: 'r1', agencyId: 'pcso', status: 'endorsed', endorsedAt: ts(NOW - 3 * 86400e3) },
    }))
    await close(db, 'sw2', 'closed', 'Patient discharged')
    expect(db.store.get('requests/r1')).toMatchObject({ status: 'closed', closeReason: 'Patient discharged' })
    expect(db.store.get('applications/s1').status).toBe('closed')
    expect(db.store.get('applications/s2').status).toBe('closed')
    expect(db.store.get('agencies/dswd')['slots.remaining']).toBe(3)            // today's slot back
    expect(Object.keys(db.store.get('agencies/pcso'))).not.toContain(`hospitalSlots.${H}.remaining`) // older day: nothing back
  })

  it('refuses "rejected" once money is committed, and a second close', async () => {
    const committed = base({
      'requests/r1': { ...base()['requests/r1'], status: 'partially_funded' },
      'applications/s1': { requestId: 'r1', agencyId: 'dswd', status: 'approved', glStatus: 'issued', amountApproved: 4000 },
    })
    expect(await codeOf(close(memDb(committed), 'sw2', 'rejected'))).toBe('failed-precondition')
    expect(await codeOf(close(memDb(committed), 'sw2', 'closed'))).toBeNull()
    const closed = base({ 'requests/r1': { ...base()['requests/r1'], status: 'closed' } })
    expect(await codeOf(close(memDb(closed), 'sw2', 'closed'))).toBe('failed-precondition')
  })

  it("refuses another hospital's staff", async () => {
    expect(await codeOf(close(memDb(base()), 'swB', 'closed'))).toBe('permission-denied')
  })
})
