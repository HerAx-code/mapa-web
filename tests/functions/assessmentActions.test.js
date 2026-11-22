/**
 * amendAssessment — Phase 3 PR 3.2 (P3-B / D6, gap M7): after endorsement the
 * assessment changes only through a reasoned amendment that tells the
 * agencies, voids the certificate if the class changed and marks approved
 * slices. Nothing is reversed automatically.
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

let handleAmendAssessment
beforeAll(() => { ;({ handleAmendAssessment } = require('../../functions/src/assessmentActions')) })

const H = 'hosp-a'
const deps = { now: () => Date.UTC(2026, 10, 22), serverTimestamp: () => 'TS', fromMillis: (ms) => ({ ms }) }
const sheet = (x = {}) => ({
  householdSize: 4, monthlyIncome: 6000, diagnosis: 'CKD', recommendation: 'Assist with dialysis',
  meansTestCategory: 'indigent_c3', meansTestOverrideReason: '', completedBy: 'Ana SW', completedByUid: 'sw1', ...x,
})
const base = (x = {}) => ({
  'users/sw1': { role: 'staff_admin', tenantId: H, name: 'Ana SW' },
  'users/swB': { role: 'staff_admin', tenantId: 'hosp-b', name: 'Other' },
  'users/co': { role: 'agency', agencyId: 'dswd' },
  'requests/r1': {
    requestId: 'REQ-1', patientId: 'pat', patientName: 'Pat', tenantId: H, status: 'partially_funded',
    agencyIds: ['dswd'], intakeSheet: sheet(), eligibilityCert: { id: 'c1', controlNo: 'MAPA-COE-2026-00001', status: 'signed' },
  },
  'eligibilityCertificates/c1': { status: 'signed' },
  'applications/s1': { requestId: 'r1', agencyId: 'dswd', status: 'approved', glStatus: 'issued' },
  'applications/s2': { requestId: 'r1', agencyId: 'pcso', status: 'reviewing' },
  ...x,
})
const amend = (db, callerUid, data) => handleAmendAssessment({ callerUid, data: { requestId: 'r1', ...data }, db, ...deps })
const codeOf = async (p) => { try { await p; return null } catch (e) { return e.code } }
const REASON = 'Payslip seen at the follow-up'

describe('amendAssessment', () => {
  it('records the amendment; a class change voids the certificate and marks approved slices; agencies told', async () => {
    const db = memDb(base())
    const r = await amend(db, 'sw1', {
      changes: { monthlyIncome: 30000, meansTestCategory: 'incapacitated_c2', meansTestOverrideReason: 'Income higher than first reported' },
      reason: REASON,
    })
    expect(r).toMatchObject({ classChanged: true, certVoided: true })
    const s = db.store.get('requests/r1').intakeSheet
    expect(s).toMatchObject({ monthlyIncome: 30000, meansTestCategory: 'incapacitated_c2' })
    expect(s.amendments).toHaveLength(1)
    expect(s.amendments[0]).toMatchObject({ byUid: 'sw1', reason: REASON, classChanged: true, before: { monthlyIncome: 6000 }, after: { monthlyIncome: 30000 } })
    expect(db.store.get('requests/r1').eligibilityCert.status).toBe('voided')
    expect(db.store.get('eligibilityCertificates/c1').status).toBe('voided')
    expect(db.store.get('applications/s1').assessmentChange).toMatchObject({ classFrom: 'indigent_c3', classTo: 'incapacitated_c2' })
    expect(db.store.get('applications/s2').assessmentChange).toBeUndefined()      // not approved
    const notes = [...db.store.entries()].filter(([k]) => k.startsWith('notifications/co/items/')).map(([, v]) => v)
    expect(notes[0].body).toContain('You already approved this case')
    const audit = [...db.store.entries()].find(([k]) => k.startsWith('auditLog/'))[1]
    expect(audit).toMatchObject({ action: 'assessment_amended', requestId: 'r1', tenantId: H })
  })

  it('a change that keeps the class leaves the certificate alone', async () => {
    const db = memDb(base())
    expect(await amend(db, 'sw1', { changes: { recommendation: 'Assist with dialysis and medicines' }, reason: REASON })).toMatchObject({ classChanged: false, certVoided: false })
    expect(db.store.get('eligibilityCertificates/c1').status).toBe('signed')
  })

  it('refuses before endorsement, another hospital, a short reason, unknown fields, no change, an incomplete result', async () => {
    const notEndorsed = base({ 'requests/r1': { ...base()['requests/r1'], agencyIds: [] } })
    expect(await codeOf(amend(memDb(notEndorsed), 'sw1', { changes: { recommendation: 'x' }, reason: REASON }))).toBe('failed-precondition')
    expect(await codeOf(amend(memDb(base()), 'swB', { changes: { recommendation: 'x' }, reason: REASON }))).toBe('permission-denied')
    expect(await codeOf(amend(memDb(base()), 'co', { changes: { recommendation: 'x' }, reason: REASON }))).toBe('permission-denied')
    expect(await codeOf(amend(memDb(base()), 'sw1', { changes: { recommendation: 'x' }, reason: 'short' }))).toBe('invalid-argument')
    expect(await codeOf(amend(memDb(base()), 'sw1', { changes: { completedBy: 'Me' }, reason: REASON }))).toBe('invalid-argument')
    expect(await codeOf(amend(memDb(base()), 'sw1', { changes: { householdSize: 4 }, reason: REASON }))).toBe('invalid-argument')
    expect(await codeOf(amend(memDb(base()), 'sw1', { changes: { monthlyIncome: null }, reason: REASON }))).toBe('failed-precondition')
  })
})
