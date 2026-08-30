import { describe, it, expect } from 'vitest'
import { meansTestSuggestion, POVERTY_LINE_PER_CAPITA, isIntakeComplete } from '../../src/utils/intakeSheet.js'

describe('meansTestSuggestion', () => {
  const L = POVERTY_LINE_PER_CAPITA // 2600 per capita

  it('classifies by income-per-capita vs the poverty line', () => {
    // per capita < 1× → indigent (5000 / 4 = 1250)
    expect(meansTestSuggestion({ monthlyIncome: 5000, householdSize: 4 }).category).toBe('indigent')
    // 1×–1.5× → marginalized (per capita ~3000)
    expect(meansTestSuggestion({ monthlyIncome: 3000 * 2, householdSize: 2 }).category).toBe('marginalized')
    // 1.5×–2× → low_income (per capita ~4500)
    expect(meansTestSuggestion({ monthlyIncome: 4500, householdSize: 1 }).category).toBe('low_income')
    // ≥2× → above_threshold (per capita ~6000)
    expect(meansTestSuggestion({ monthlyIncome: 6000, householdSize: 1 }).category).toBe('above_threshold')
  })

  it('returns per-capita and ratio', () => {
    const s = meansTestSuggestion({ monthlyIncome: 5200, householdSize: 2 })
    expect(s.perCapita).toBe(2600)
    expect(s.ratio).toBe(1) // 2600 / 2600
  })

  it('boundary exactly at 1× is not indigent (marginalized)', () => {
    expect(meansTestSuggestion({ monthlyIncome: L, householdSize: 1 }).category).toBe('marginalized')
  })

  it('returns null when inputs are missing or invalid', () => {
    expect(meansTestSuggestion({ monthlyIncome: '', householdSize: 4 })).toBeNull()
    expect(meansTestSuggestion({ monthlyIncome: 5000, householdSize: 0 })).toBeNull()
    expect(meansTestSuggestion({ monthlyIncome: -100, householdSize: 4 })).toBeNull()
    expect(meansTestSuggestion({})).toBeNull()
    expect(meansTestSuggestion()).toBeNull()
  })
})

// Guard the completeness helper the snapshot/rail lean on.
describe('isIntakeComplete', () => {
  it('true only when all six required fields are present', () => {
    const full = { householdSize: 4, monthlyIncome: 8000, diagnosis: 'CKD', recommendation: 'Endorse', meansTestCategory: 'indigent', completedBy: 'SW' }
    expect(isIntakeComplete(full)).toBe(true)
    expect(isIntakeComplete({ ...full, recommendation: '' })).toBe(false)
  })
})
