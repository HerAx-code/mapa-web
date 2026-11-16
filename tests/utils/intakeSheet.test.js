import { describe, it, expect } from 'vitest'
import {
  meansTestSuggestion, sheetSuggestion, povertyBasis, classCutoffs, maifipCatastrophic, meansCategoryLabel, isLegacyCategory,
  isIntakeComplete, needsMeansTestReason, billIncomeMonths, relationshipLabel, requiredFieldsStatus, factChanges, sameFact,
  mergeRemoteFacts, factsOf, sectionVerification, allSectionsVerified, sectionFacts,
} from '../../src/utils/intakeSheet.js'

// DOH AO 2021-0044 bands against a ₱2,500 line: C3 < 3,500 · C2 ≤ 4,500 · C1 ≤ 5,500 · capable above.
const L = 2500

describe('meansTestSuggestion (DOH AO 2021-0044)', () => {
  const cat = (income, size = 1) => meansTestSuggestion({ monthlyIncome: income, householdSize: size, povertyLine: L }).category

  it('classifies income per person against 140 / 180 / 220% of the poverty line', () => {
    expect(cat(13000, 4)).toBe('indigent_c3')      // 3,250 = 130%
    expect(cat(4000)).toBe('incapacitated_c2')      // 160%
    expect(cat(5000)).toBe('incapacitated_c1')      // 200%
    expect(cat(6000)).toBe('capable')               // 240%
  })

  it('puts the band edges where the AO body text does', () => {
    expect(cat(3499)).toBe('indigent_c3')
    expect(cat(3500)).toBe('incapacitated_c2')      // exactly 140% → C2
    expect(cat(4500)).toBe('incapacitated_c2')      // exactly 180%
    expect(cat(5500)).toBe('incapacitated_c1')      // exactly 220%
    expect(cat(5501)).toBe('capable')
  })

  it('suggests C3 for a 4Ps member even without figures', () => {
    expect(meansTestSuggestion({ is4Ps: true })).toMatchObject({ category: 'indigent_c3', via4Ps: true })
    expect(meansTestSuggestion({ monthlyIncome: 20000, householdSize: 1, povertyLine: L, is4Ps: true }).category).toBe('indigent_c3')
  })

  it('suggests nothing without a poverty line or with blank figures', () => {
    expect(meansTestSuggestion({ monthlyIncome: 5000, householdSize: 2 })).toBeNull()
    expect(meansTestSuggestion({ monthlyIncome: '', householdSize: 4, povertyLine: L })).toBeNull()
    expect(meansTestSuggestion({ monthlyIncome: 5000, householdSize: 0, povertyLine: L })).toBeNull()
    expect(meansTestSuggestion({ monthlyIncome: -100, householdSize: 4, povertyLine: L })).toBeNull()
    expect(meansTestSuggestion()).toBeNull()
  })
})

describe('poverty basis', () => {
  it('prefers the line stored on the sheet over the hospital setting', () => {
    const settings = { povertyLinePerCapita: 3000, povertyLineYear: 2025, region: 'BARMM' }
    expect(povertyBasis({ classificationBasis: { povertyLine: 2577, year: 2023, region: 'BARMM' } }, settings).povertyLine).toBe(2577)
    expect(povertyBasis({}, settings)).toEqual({ povertyLine: 3000, year: 2025, region: 'BARMM', citationShort: '', status: '' })
    expect(povertyBasis({}, { ...settings, povertyLineCitationShort: 'PSA 2025', povertyLineStatus: 'interim' }))
      .toMatchObject({ citationShort: 'PSA 2025', status: 'interim' })
    expect(povertyBasis({}, null)).toBeNull()
    expect(sheetSuggestion({ monthlyIncome: 4000, householdSize: 1 }, { povertyLinePerCapita: L }).category).toBe('incapacitated_c2')
  })
  it('computes the cut-offs', () => {
    expect(classCutoffs(2500)).toEqual({ c3Below: 3500, c2UpTo: 4500, c1UpTo: 5500 })
  })
})

describe('maifipCatastrophic (DOH AO 2026-0031)', () => {
  it('flags a bill above 10% of a year of household income', () => {
    expect(maifipCatastrophic({ bill: 13000, monthlyIncome: 10000 })).toBe(true)   // > 12,000
    expect(maifipCatastrophic({ bill: 12000, monthlyIncome: 10000 })).toBe(false)
    expect(maifipCatastrophic({ bill: 500, monthlyIncome: 0 })).toBe(true)
    expect(maifipCatastrophic({ bill: '', monthlyIncome: 1000 })).toBeNull()
  })
})

describe('old-scale categories', () => {
  it('are labelled and recognised', () => {
    expect(isLegacyCategory('low_income')).toBe(true)
    expect(isLegacyCategory('incapacitated_c2')).toBe(false)
    expect(meansCategoryLabel('low_income')).toBe('Low income (old scale)')
    expect(meansCategoryLabel('indigent_c3')).toBe('Indigent (C3)')
  })
})

// Guard the completeness helper the snapshot/rail lean on.
describe('isIntakeComplete', () => {
  it('true only when all six required fields are present', () => {
    const full = { householdSize: 4, monthlyIncome: 8000, diagnosis: 'CKD', recommendation: 'Endorse', meansTestCategory: 'indigent_c3', completedBy: 'SW' }
    expect(isIntakeComplete(full)).toBe(true)
    expect(isIntakeComplete({ ...full, recommendation: '' })).toBe(false)
  })
  it('keeps an old-scale sheet complete (no reason asked)', () => {
    const old = { householdSize: 1, monthlyIncome: 50000, diagnosis: 'CKD', recommendation: 'Endorse', meansTestCategory: 'above_threshold', completedBy: 'SW',
      classificationBasis: { povertyLine: L } }
    expect(isIntakeComplete(old)).toBe(true)
  })
})

describe('needsMeansTestReason', () => {
  // 8000 / 4 = 2000 per person = 80% of the stored line -> suggests C3
  const base = { householdSize: 4, monthlyIncome: 8000, classificationBasis: { povertyLine: L } }

  it('is not needed when the class matches the suggestion', () => {
    expect(needsMeansTestReason({ ...base, meansTestCategory: 'indigent_c3' })).toBe(false)
  })
  it('is needed when the class departs from the suggestion', () => {
    expect(needsMeansTestReason({ ...base, meansTestCategory: 'incapacitated_c1' })).toBe(true)
  })
  it('is always needed for Financially capable', () => {
    expect(needsMeansTestReason({ householdSize: 1, monthlyIncome: 50000, meansTestCategory: 'capable' })).toBe(true)
  })
  it('is not needed before a class is chosen, without figures, or on the old scale', () => {
    expect(needsMeansTestReason({ ...base, meansTestCategory: '' })).toBe(false)
    expect(needsMeansTestReason({ meansTestCategory: 'incapacitated_c2' })).toBe(false)
    expect(needsMeansTestReason({ ...base, meansTestCategory: 'low_income' })).toBe(false)
  })
  it('makes the intake incomplete until the reason is written', () => {
    const full = { ...base, diagnosis: 'CKD', recommendation: 'Endorse', meansTestCategory: 'incapacitated_c1', completedBy: 'SW' }
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
