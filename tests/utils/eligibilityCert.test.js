import { describe, it, expect } from 'vitest'
import {
  coeNumber, certDocId, coeReadiness, buildCoeSnapshot, coeMissing, buildEligibilityCertificateHTML,
} from '../../src/utils/eligibilityCert.js'

const sheet = {
  householdSize: 4, monthlyIncome: 8000, diagnosis: 'Pneumonia', recommendation: 'Endorse', completedBy: 'Ana Reyes',
  completedAt: new Date('2026-11-16T02:00:00Z'), meansTestCategory: 'indigent_c3', dateOfAdmission: '2026-11-10',
  hospitalCaseNumber: 'C-123', is4Ps: true, circumstances: ['elderly', 'other'], circumstancesOther: 'Typhoon victim',
  classificationValidMonths: 12,
  classificationBasis: { povertyLine: 2577, year: 2023, region: 'BARMM', citationShort: 'PSA 2023 FY Official Poverty Statistics, BARMM' },
}
const request = { id: 'r1', requestId: 'REQ-2026-1', totalBill: 20000, patientName: 'Juan Dela Cruz', intakeSheet: sheet }
const patient = { name: 'Juan Dela Cruz', birthdate: '1960-03-01', sex: 'male', address: 'Cotabato City' }
const org = { facilityName: 'Cotabato Regional and Medical Center', address: 'Cotabato City', gatewayName: 'Medical Social Service' }
const now = new Date('2026-11-16T03:00:00Z')

describe('coeNumber', () => {
  it('uses the hospital prefix and a yearly 5-digit sequence', () => {
    expect(coeNumber('crmc', 2026, 1)).toBe('CRMC-COE-2026-00001')
    expect(certDocId('r1', 'CRMC-COE-2026-00001')).toBe('r1__CRMC-COE-2026-00001')
  })
})

describe('coeReadiness', () => {
  it('needs a completed assessment on the AO 2021-0044 classes', () => {
    expect(coeReadiness(request).ok).toBe(true)
    expect(coeReadiness({ ...request, intakeSheet: { ...sheet, recommendation: '' } }).ok).toBe(false)
    const legacy = coeReadiness({ ...request, intakeSheet: { ...sheet, meansTestCategory: 'low_income' } })
    expect(legacy.ok).toBe(false)
    expect(legacy.reason).toMatch(/old scale/)
  })
})

describe('buildCoeSnapshot', () => {
  const snap = buildCoeSnapshot({ request, patient, org, settings: { coeNotedByName: 'Maria Santos, RSW' }, controlNo: 'CRMC-COE-2026-00001', now })
  it('freezes the patient, class, basis and signatories', () => {
    expect(snap).toMatchObject({
      controlNo: 'CRMC-COE-2026-00001', category: 'indigent_c3', is4Ps: true, validMonths: 12,
      patient: { name: 'Juan Dela Cruz', sex: 'male' }, hospital: { name: org.facilityName },
      socialWorker: 'Ana Reyes', notedBy: { name: 'Maria Santos, RSW', title: 'Head, Medical Social Service' },
    })
    expect(snap.circumstances).toEqual(['Senior citizen', 'Typhoon victim'])
    expect(snap.basis).toMatchObject({ povertyLine: 2577, region: 'BARMM' })
    expect(snap.validUntil.slice(0, 7)).toBe('2027-11')
  })
  it('lists what will print blank', () => {
    expect(coeMissing(snap)).toEqual([])
    const bare = buildCoeSnapshot({ request: { ...request, intakeSheet: { ...sheet, hospitalCaseNumber: '' } }, patient: { name: 'X' }, controlNo: 'N' })
    expect(coeMissing(bare)).toEqual(['birthdate', 'sex', 'address', 'hospital case number'])
  })
})

describe('buildEligibilityCertificateHTML', () => {
  const snap = buildCoeSnapshot({ request, patient, org, controlNo: 'CRMC-COE-2026-00001', now })
  const html = buildEligibilityCertificateHTML(snap)
  it('ticks the class and certifies eligibility', () => {
    expect(html).toContain('CERTIFICATE OF ELIGIBILITY')
    expect(html).toContain('&#9746; Indigent (C3)')
    expect(html).toContain('&#9744; Financially Capable')
    expect(html).toContain('is therefore eligible to avail')
    expect(html).toContain('Pantawid Pamilyang Pilipino Program')
    expect(html).toContain('66</strong> years old')
    expect(html).toContain('PSA 2023 FY Official Poverty Statistics, BARMM')
    expect(html).not.toContain('undefined')
  })
  it('prints no eligibility sentence for Financially Capable, and outpatient wording', () => {
    const cap = buildEligibilityCertificateHTML({ ...snap, category: 'capable', careSetting: 'outpatient', careUnit: 'dialysis' })
    expect(cap).not.toContain('is therefore eligible')
    expect(cap).toContain('Dialysis Unit')
  })
  it('escapes stored text', () => {
    const evil = buildEligibilityCertificateHTML({ ...snap, diagnosis: '<img src=x onerror=alert(1)>' })
    expect(evil).not.toContain('<img src=x')
  })
})
