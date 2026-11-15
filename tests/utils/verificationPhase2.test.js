import { describe, it, expect } from 'vitest'
import { docChecksFor, checksComplete } from '../../src/utils/docChecks.js'
import { interviewReasons, policyOf, callRecorded, secondPersonHold, DECLARATION_VERSION } from '../../src/utils/verificationPolicy.js'
import { deriveRequestStage } from '../../src/utils/requestStage.js'

// Input verification Phase 2 (reports/Patient input verification.md).
describe('document checklists', () => {
  it('medical documents check the doctor, the date and the patient', () => {
    const items = docChecksFor({ documentTypeName: 'Medical Abstract' })
    expect(items.map(i => i.key)).toEqual(['physician', 'recent', 'patient'])
    expect(docChecksFor({ documentTypeName: 'Medical Certificate' })).toBe(items)
  })
  it('the bill, indigency certificate and case study have their own; others none', () => {
    expect(docChecksFor({ documentTypeName: 'Hospital Billing Statement' }).length).toBe(2)
    expect(docChecksFor({ documentTypeName: 'Barangay Certificate of Indigency' }).length).toBe(2)
    expect(docChecksFor({ documentTypeName: 'Social Case Study Report' }).length).toBe(1)
    expect(docChecksFor({ documentTypeName: 'Valid ID' })).toEqual([])
    expect(docChecksFor({ name: 'Laboratory Results' })).toEqual([])
  })
  it('complete only when every item is ticked', () => {
    const items = docChecksFor({ documentTypeName: 'Barangay Certificate of Indigency' })
    expect(checksComplete(items, { barangay: true })).toBe(false)
    expect(checksComplete(items, { barangay: true, signed: true })).toBe(true)
  })
})

describe('verification call policy', () => {
  const req = (amountNeeded, extra = {}) => ({ amountNeeded, intakeSheet: {}, ...extra })
  const strong = { matches: [{ kind: 'name_phone', sameHospitalUids: [], otherHospitalCount: 1 }] }
  const phoneOnly = { matches: [{ kind: 'phone', sameHospitalUids: ['x'], otherHospitalCount: 0 }] }

  it('defaults: no amount rule, duplicate flags on', () => {
    expect(policyOf(null)).toEqual({ interviewAboveAmount: null, interviewOnDuplicate: true, secondPersonAboveAmount: null })
    expect(interviewReasons({ request: req(900000) })).toEqual([])
  })
  it('amount at or above the hospital threshold', () => {
    const settings = { interviewAboveAmount: 50000 }
    expect(interviewReasons({ request: req(49999), settings })).toEqual([])
    expect(interviewReasons({ request: req(50000), settings }).map(r => r.key)).toEqual(['amount'])
  })
  it('a strong duplicate match needs a call; a shared phone alone does not', () => {
    expect(interviewReasons({ request: req(1), identityFlag: strong }).map(r => r.key)).toEqual(['duplicate'])
    expect(interviewReasons({ request: req(1), identityFlag: phoneOnly })).toEqual([])
    expect(interviewReasons({ request: req(1), identityFlag: strong, settings: { interviewOnDuplicate: false } })).toEqual([])
  })
  it('a reused bill number always needs a call', () => {
    const r = req(1, { intakeSheet: { billVerification: { reusedFromRequestId: 'old' } } })
    expect(interviewReasons({ request: r, settings: { interviewOnDuplicate: false } }).map(x => x.key)).toEqual(['bill_reused'])
  })
})

describe('endorse gate with a verification call', () => {
  // A request that is otherwise ready (docs verified, intake complete).
  const ready = {
    status: 'under_review', totalBill: 10000,
    intakeSheet: { householdSize: 3, monthlyIncome: 5000, diagnosis: 'x', recommendation: 'y', meansTestCategory: 'indigent', completedBy: 'SW' },
  }
  const docs = [{ status: 'verified' }]
  const reasons = [{ key: 'amount', label: 'Amount is ₱5,000 or more' }]

  it('no reasons → unchanged behaviour', () => {
    expect(deriveRequestStage(ready, docs).canEndorse).toBe(true)
  })
  it('blocks until the call is recorded, and says why', () => {
    const s = deriveRequestStage(ready, docs, { callReasons: reasons })
    expect(s.canEndorse).toBe(false)
    expect(s.blockers.find(b => b.call).detail).toMatch(/₱5,000/)
    const called = { ...ready, intakeSheet: { ...ready.intakeSheet, verificationCall: { at: 'TS', method: 'phone', notes: 'confirmed' } } }
    expect(callRecorded(called)).toBe(true)
    expect(deriveRequestStage(called, docs, { callReasons: reasons }).canEndorse).toBe(true)
  })
})

// ── Phase 3 ──────────────────────────────────────────────────────────────────
describe('second-person approval', () => {
  const me = { uid: 'sw1', name: 'Social Worker' }
  const prepared = (amountNeeded, sheet = {}) => ({ amountNeeded, intakeSheet: { completedBy: 'Other', ...sheet } })

  it('off by default, and below the amount', () => {
    expect(secondPersonHold({ request: prepared(900000, { billVerification: { byUid: 'sw1' } }), user: me })).toBeNull()
    expect(secondPersonHold({ request: prepared(9999, { billVerification: { byUid: 'sw1' } }), settings: { secondPersonAboveAmount: 10000 }, user: me })).toBeNull()
  })
  it('holds whoever confirmed the bill, recorded the call or completed the assessment', () => {
    const settings = { secondPersonAboveAmount: 10000 }
    expect(secondPersonHold({ request: prepared(10000, { billVerification: { byUid: 'sw1' } }), settings, user: me })?.key).toBe('second_person')
    expect(secondPersonHold({ request: prepared(10000, { verificationCall: { byUid: 'sw1' } }), settings, user: me })?.key).toBe('second_person')
    expect(secondPersonHold({ request: prepared(10000, { completedBy: 'Social Worker' }), settings, user: me })?.key).toBe('second_person')
  })
  it('another staff member may endorse', () => {
    const settings = { secondPersonAboveAmount: 10000 }
    const r = prepared(50000, { billVerification: { byUid: 'sw1' }, verificationCall: { byUid: 'sw1' } })
    expect(secondPersonHold({ request: r, settings, user: { uid: 'sw2', name: 'Second' } })).toBeNull()
  })
  it('a hold blocks the endorse gate', () => {
    const ready = {
      status: 'under_review', totalBill: 10000,
      intakeSheet: { householdSize: 3, monthlyIncome: 5000, diagnosis: 'x', recommendation: 'y', meansTestCategory: 'indigent', completedBy: 'SW' },
    }
    const s = deriveRequestStage(ready, [{ status: 'verified' }], { holds: [{ key: 'second_person', label: 'Another staff member must endorse', detail: 'x' }] })
    expect(s.canEndorse).toBe(false)
    expect(s.blockers.find(b => b.hold).key).toBe('second_person')
  })
})

describe('declaration', () => {
  it('has a version so each request records which wording was signed', () => {
    expect(DECLARATION_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
