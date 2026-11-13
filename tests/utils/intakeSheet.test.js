import { describe, it, expect } from 'vitest'
import { meansTestSuggestion, POVERTY_LINE_PER_CAPITA, isIntakeComplete, needsMeansTestReason, billIncomeMonths, relationshipLabel, requiredFieldsStatus, factChanges, sameFact, mergeRemoteFacts, factsOf, sectionVerification, allSectionsVerified, sectionFacts } from '../../src/utils/intakeSheet.js'

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

describe('needsMeansTestReason (revision 7e)', () => {
  // 8000 / 4 = 2000 per person -> suggests indigent
  const base = { householdSize: 4, monthlyIncome: 8000 }

  it('is not needed when the category matches the suggestion', () => {
    expect(needsMeansTestReason({ ...base, meansTestCategory: 'indigent' })).toBe(false)
  })
  it('is needed when the category departs from the suggestion', () => {
    expect(needsMeansTestReason({ ...base, meansTestCategory: 'low_income' })).toBe(true)
  })
  it('is always needed for Above Threshold', () => {
    expect(needsMeansTestReason({ householdSize: 1, monthlyIncome: 50000, meansTestCategory: 'above_threshold' })).toBe(true)
  })
  it('is not needed before a category is chosen, or without figures to compare', () => {
    expect(needsMeansTestReason({ ...base, meansTestCategory: '' })).toBe(false)
    expect(needsMeansTestReason({ meansTestCategory: 'indigent' })).toBe(false)
  })
  it('makes the intake incomplete until the reason is written', () => {
    const full = { ...base, diagnosis: 'CKD', recommendation: 'Endorse', meansTestCategory: 'low_income', completedBy: 'SW' }
    expect(isIntakeComplete(full)).toBe(false)
    expect(isIntakeComplete({ ...full, meansTestOverrideReason: 'Spouse lost job last week' })).toBe(true)
    expect(requiredFieldsStatus(full).find(f => f.key === 'meansTestOverrideReason')?.done).toBe(false)
  })
})

describe('billIncomeMonths (revision 7c)', () => {
  it('expresses the bill in months of household income', () => {
    expect(billIncomeMonths({ bill: 120000, monthlyIncome: 10000 }).months).toBe(12)
  })
  it('is Infinity with no income, null when inputs are blank or zero', () => {
    expect(billIncomeMonths({ bill: 5000, monthlyIncome: 0 }).months).toBe(Infinity)
    expect(billIncomeMonths({ bill: '', monthlyIncome: 1000 })).toBeNull()
    expect(billIncomeMonths({ bill: 0, monthlyIncome: 1000 })).toBeNull()
    expect(billIncomeMonths({ bill: 5000, monthlyIncome: null })).toBeNull()
  })
})

describe('relationshipLabel (revision 2)', () => {
  it('maps codes to labels and keeps old free-text values as typed', () => {
    expect(relationshipLabel('spouse')).toBe('Spouse')
    expect(relationshipLabel('Tita')).toBe('Tita')
    expect(relationshipLabel(undefined)).toBe('')
  })
})

describe('sameFact — compares form state to stored data', () => {
  it('treats string/number, blank/null and blank rows as equal', () => {
    expect(sameFact('8000', 8000)).toBe(true)
    expect(sameFact('', null)).toBe(true)
    expect(sameFact({ food: '', rent: '500' }, { rent: 500 })).toBe(true)
    expect(sameFact([{ name: 'Ana', age: '9' }, { name: '', age: '' }], [{ name: 'Ana', age: 9 }])).toBe(true)
  })
  it('detects a real change', () => {
    expect(sameFact('8000', 3000)).toBe(false)
    expect(sameFact([{ name: 'Ana' }], [{ name: 'Ana' }, { name: 'Ben' }])).toBe(false)
  })
})

describe('factChanges (improvement A3)', () => {
  const before = factsOf({
    householdSize: 3, monthlyIncome: 8000, employmentType: 'employed',
    familyMembers: [{ name: 'Ana', relationship: 'child', age: 9 }],
    expenses: { food: 4000, rent: 0 }, diagnosis: 'Pneumonia',
  })

  it('is empty when nothing changed or there is no review yet', () => {
    expect(factChanges(before, { ...before, monthlyIncome: '8000' })).toEqual([])
    expect(factChanges(undefined, before)).toEqual([])
  })

  it('lists readable before → after rows', () => {
    const after = { ...before, monthlyIncome: 3000, employmentType: 'unemployed',
      expenses: { food: 4000, rent: 1500 }, familyMembers: [...before.familyMembers, { name: 'Ben', relationship: 'spouse', age: 40 }] }
    const rows = factChanges(before, after)
    expect(rows).toContainEqual({ key: 'monthlyIncome', label: 'Monthly income', from: '₱8,000', to: '₱3,000' })
    expect(rows).toContainEqual({ key: 'employmentType', label: 'Work situation', from: 'Employed', to: 'Unemployed' })
    expect(rows).toContainEqual({ key: 'expenses.rent', label: 'Expenses: Rent', from: '₱0', to: '₱1,500' })
    expect(rows.find(r => r.key === 'familyMembers').to).toBe('Ana (Son / Daughter, 9); Ben (Spouse, 40)')
    expect(rows.some(r => r.key === 'expenses.food')).toBe(false)
  })
})

describe('mergeRemoteFacts (improvement A3)', () => {
  const baseline = { monthlyIncome: 8000, diagnosis: 'Pneumonia' }

  it("takes the patient's new value for a fact the worker hasn't touched", () => {
    const local = { monthlyIncome: '8000', diagnosis: 'Pneumonia', recommendation: 'Endorse' }
    const next = mergeRemoteFacts(local, baseline, { monthlyIncome: 3000, diagnosis: 'Pneumonia' })
    expect(next.monthlyIncome).toBe(3000)
    expect(next.recommendation).toBe('Endorse') // assessment is never touched
  })

  it("keeps the worker's in-progress edit", () => {
    const local = { monthlyIncome: '9500', diagnosis: 'Pneumonia' }
    const next = mergeRemoteFacts(local, baseline, { monthlyIncome: 3000, diagnosis: 'Pneumonia' })
    expect(next.monthlyIncome).toBe('9500')
  })
})

describe('shortfall helpers', () => {
  const exp = { food: 6000, utilities: 1500, rent: 2500, education: 500, medicine: 1000, other: 500 } // 12,000
  it('computes the monthly shortfall only when income is entered', async () => {
    const { monthlyShortfall, expensesLookMistyped } = await import('../../src/utils/intakeSheet.js')
    expect(monthlyShortfall({ monthlyIncome: 8000, expenses: exp })).toBe(4000)
    expect(monthlyShortfall({ monthlyIncome: 20000, expenses: exp })).toBe(0)
    expect(monthlyShortfall({ monthlyIncome: '', expenses: exp })).toBe(0)
    expect(expensesLookMistyped({ monthlyIncome: 3000, expenses: exp })).toBe(true)
    expect(expensesLookMistyped({ monthlyIncome: 8000, expenses: exp })).toBe(false)
    expect(expensesLookMistyped({ monthlyIncome: 0, expenses: exp })).toBe(false)
  })
  it('reports a changed shortfall answer in readable form', () => {
    const rows = factChanges(factsOf({ shortfallCoverage: ['borrowing'] }), factsOf({ shortfallCoverage: ['borrowing', 'relatives'] }))
    expect(rows).toContainEqual({ key: 'shortfallCoverage', label: 'How the shortfall is covered',
      from: 'Borrowing / loans', to: 'Borrowing / loans, Help from relatives or friends' })
  })
})

describe('section verification (revision 9)', () => {
  const s0 = {
    householdSize: 2, familyMembers: [{ name: 'Ana', relationship: 'child', age: 9 }],
    monthlyIncome: 8000, employmentType: 'employed', expenses: { food: 4000 }, diagnosis: 'CKD',
  }
  const verify = (s, key, status = 'verified', note = '') =>
    ({ ...s, factsVerification: { ...(s.factsVerification ?? {}), [key]: { status, note, by: 'SW', facts: sectionFacts(s, key) } } })
  const allVerified = ['family', 'income', 'expenses', 'medical'].reduce((s, k) => verify(s, k), s0)

  it('starts pending', () => expect(sectionVerification(s0, 'income').status).toBe('pending'))

  it('stays verified while the answers are unchanged (form strings vs stored numbers)', () => {
    expect(sectionVerification({ ...verify(s0, 'income'), monthlyIncome: '8000' }, 'income').status).toBe('verified')
  })

  it('becomes "changed" when the patient edits a verified or flagged section', () => {
    const v = sectionVerification({ ...verify(s0, 'income'), monthlyIncome: 12000 }, 'income')
    expect(v).toMatchObject({ status: 'changed', previousStatus: 'verified' })
    const f = sectionVerification({ ...verify(s0, 'income', 'needs_correction', 'Payslip says 12k'), monthlyIncome: 12000 }, 'income')
    expect(f).toMatchObject({ status: 'changed', previousStatus: 'needs_correction' })
  })

  it('a change in one section leaves the others verified', () => {
    const s = { ...allVerified, diagnosis: 'Pneumonia' }
    expect(sectionVerification(s, 'medical').status).toBe('changed')
    expect(sectionVerification(s, 'family').status).toBe('verified')
    expect(allSectionsVerified(s)).toBe(false)
    expect(allSectionsVerified(allVerified)).toBe(true)
  })

  it('gates completion only when verificationRequired (old cases grandfathered)', () => {
    const assessed = { ...s0, recommendation: 'Endorse', completedBy: 'SW' } // 8000 / 2 = 4000 per person = 1.54x line -> low_income
    const done = { ...assessed, meansTestCategory: 'low_income' }
    expect(isIntakeComplete(done)).toBe(true)                                   // grandfathered
    expect(isIntakeComplete({ ...done, verificationRequired: true })).toBe(false) // new case, unverified
    const verified = ['family', 'income', 'expenses', 'medical'].reduce((s, k) => verify(s, k), { ...done, verificationRequired: true })
    expect(isIntakeComplete(verified)).toBe(true)
    const keys = requiredFieldsStatus({ ...done, verificationRequired: true }).map(f => f.key)
    expect(keys).toEqual(expect.arrayContaining(['verify.family', 'verify.income', 'verify.expenses', 'verify.medical']))
  })
})
