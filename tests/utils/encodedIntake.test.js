import { describe, it, expect } from 'vitest'
import { encodedIntakeProblem, deriveRequestStage } from '../../src/utils/requestStage.js'

// 2026-11-15 intake review: answers staff type for a patient (encodedOnBehalf)
// must pass the same checks as the patient's own form before endorsing.
const expenses = { food: 3000, utilities: 500, rent: 0, education: 0, medicine: 500, other: 0 }
const encoded = (over = {}) => ({
  encodedOnBehalf: { by: 'SW', byUid: 'sw', reason: 'Patient unconscious; daughter answered at the desk' },
  householdSize: 2, familyMembers: [{ name: 'Lito Cruz', relationship: 'child', age: 12, occupation: '', monthlyContribution: '' }],
  monthlyIncome: 6000, employmentType: 'self-employed', expenses, diagnosis: 'Pneumonia',
  // ₱6,000 for 2 people = ₱3,000 each, 1.15× the poverty line → marginalized.
  recommendation: 'Endorse', meansTestCategory: 'marginalized', completedBy: 'SW',
  ...over,
})

describe('encodedIntakeProblem', () => {
  it('ignores sheets the patient filled themselves', () => {
    expect(encodedIntakeProblem({ householdSize: 9, familyMembers: [] })).toBeNull()
  })
  it('passes a complete encoded sheet, ignoring empty member rows', () => {
    const s = encoded({ familyMembers: [...encoded().familyMembers, { name: '', relationship: '', age: '', occupation: '', monthlyContribution: '' }] })
    expect(encodedIntakeProblem(s)).toBeNull()
  })
  it('household members must match the household size', () => {
    expect(encodedIntakeProblem(encoded({ householdSize: 4 }))?.field).toBe('householdSize')
  })
  it('all six expenses are required', () => {
    expect(encodedIntakeProblem(encoded({ expenses: { ...expenses, rent: '' } }))?.field).toBe('expenses.rent')
  })
  it('does not block on the patient-only "amounts look mistyped" prompt', () => {
    expect(encodedIntakeProblem(encoded({ monthlyIncome: 1000, employmentType: 'self-employed', expenses: { ...expenses, food: 9000 }, shortfallCoverage: ['relatives'] }))).toBeNull()
  })
})

describe('endorse gate', () => {
  const req = (sheet) => ({ status: 'under_review', totalBill: 10000, intakeSheet: sheet })
  const docs = [{ status: 'verified' }]
  it('blocks an encoded sheet with a problem, and says what', () => {
    const s = deriveRequestStage(req(encoded({ householdSize: 4 })), docs)
    expect(s.canEndorse).toBe(false)
    expect(s.stages.find(x => x.key === 'assess').detail).toMatch(/^Encoded answers:/)
  })
  it('allows it once the answers pass', () => {
    expect(deriveRequestStage(req(encoded()), docs).canEndorse).toBe(true)
  })
})
