import { describe, it, expect } from 'vitest'
import { billVerified, isIntakeComplete, requiredFieldsStatus, incomeGiven } from '../../src/utils/intakeSheet.js'
import { deriveRequestStage } from '../../src/utils/requestStage.js'

// Revision 11: staff confirm the bill against the billing statement; it gates
// endorsement for sheets flagged billVerificationRequired (grandfathering).
const full = { householdSize: 4, monthlyIncome: 8000, diagnosis: 'CKD', recommendation: 'Endorse', meansTestCategory: 'indigent', completedBy: 'SW' }
const confirmed = (amount) => ({ billVerification: { amount, by: 'SW' } })

describe('billVerified', () => {
  it('needs a confirmation that matches the current bill', () => {
    expect(billVerified({}, 50000)).toBe(false)
    expect(billVerified(confirmed(50000), 50000)).toBe(true)
    expect(billVerified(confirmed(50000), 60000)).toBe(false)   // bill edited after
    expect(billVerified(confirmed(50000), undefined)).toBe(true) // bill unknown (agency view)
  })
})

describe('isIntakeComplete with the bill gate', () => {
  it('grandfathered sheets (no flag) are unaffected', () => {
    expect(isIntakeComplete(full, 50000)).toBe(true)
  })

  it('flagged sheets need the bill confirmed at its current amount', () => {
    const s = { ...full, billVerificationRequired: true }
    expect(isIntakeComplete(s, 50000)).toBe(false)
    expect(isIntakeComplete({ ...s, ...confirmed(50000) }, 50000)).toBe(true)
    expect(isIntakeComplete({ ...s, ...confirmed(50000) }, 55000)).toBe(false)
  })

  it('lists "Bill amount verified" first among the required fields when flagged', () => {
    const rows = requiredFieldsStatus({ ...full, billVerificationRequired: true }, 'SW', 50000)
    expect(rows[0]).toMatchObject({ key: 'verify.bill', done: false })
    expect(requiredFieldsStatus({ ...full }, 'SW', 50000).some(r => r.key === 'verify.bill')).toBe(false)
  })

  it('the endorse gate reads the request bill', () => {
    const docs = [{ status: 'verified' }]
    const req = (sheet, totalBill) => ({ status: 'under_review', totalBill, intakeSheet: sheet })
    const flagged = { ...full, billVerificationRequired: true }
    expect(deriveRequestStage(req(flagged, 50000), docs).canEndorse).toBe(false)
    expect(deriveRequestStage(req({ ...flagged, ...confirmed(50000) }, 50000), docs).canEndorse).toBe(true)
  })
})

// Phase 3 PR 3.2 (gap N17): a blank income is stored as null and used to read
// as ₱0, completing the sheet and suggesting the poorest class.
describe('a blank monthly income is not ₱0', () => {
  it('null or empty keeps the sheet incomplete; a typed 0 counts', () => {
    expect(incomeGiven(null)).toBe(false)
    expect(incomeGiven('')).toBe(false)
    expect(incomeGiven(undefined)).toBe(false)
    expect(incomeGiven(0)).toBe(true)
    expect(incomeGiven('0')).toBe(true)
    expect(isIntakeComplete({ ...full, monthlyIncome: null }, 50000)).toBe(false)
    expect(isIntakeComplete({ ...full, monthlyIncome: 0 }, 50000)).toBe(true)
  })
})
