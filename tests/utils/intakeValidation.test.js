import { describe, it, expect } from 'vitest'
import { validateIntakeStep, validateIntakeAll, othersFromHouseholdSize } from '../../src/utils/intakeValidation'

const TODAY = '2026-11-13'
const member = (over = {}) => ({ name: 'Ana Cruz', relationship: 'child', age: '9', occupation: 'Student', monthlyContribution: '', ...over })
const valid = (over = {}) => ({
  householdSize: 3,
  familyMembers: [member(), member({ name: 'Ben Cruz', relationship: 'spouse', age: '40', monthlyContribution: '3000' })],
  monthlyIncome: '8000', employmentType: 'self-employed', employmentTypeOther: '',
  expenses: { food: '4000', utilities: '800', rent: '0', education: '300', medicine: '500', other: '0' },
  diagnosis: 'Pneumonia', dateOfAdmission: '2026-11-01', estimatedTotalCost: '',
  ...over,
})
const step = (key, sheet) => validateIntakeStep(key, sheet, { today: TODAY })

describe('family step', () => {
  it('passes a complete household', () => expect(step('family', valid())).toBeNull())

  it('accepts living alone (0 others, no rows)', () => {
    expect(step('family', valid({ householdSize: 1, familyMembers: [] }))).toBeNull()
  })

  it.each([['', 'blank'], [0, 'size 0'], [22, '21 others'], [2.5, 'fraction']])('rejects household size %s (%s)', (size) => {
    expect(step('family', valid({ householdSize: size }))?.field).toBe('householdSize')
  })

  it('flags rows that do not match the count', () => {
    const e = step('family', valid({ householdSize: 4 }))
    expect(e.field).toBe('householdSize')
    expect(e.en).toMatch(/3 people.*listed 2/)
  })

  it.each([
    ['name', { name: '  ' }],
    ['relationship', { relationship: '' }],
    ['relationship', { relationship: 'Tita' }], // free text from before the dropdown
    ['age', { age: '' }],
    ['age', { age: '121' }],
    ['age', { age: '-1' }],
    ['monthlyContribution', { monthlyContribution: '-5' }],
  ])('flags member %s', (field, over) => {
    expect(step('family', valid({ familyMembers: [member(), member(over)] }))?.field).toBe(`member.1.${field}`)
  })

  it('leaves occupation and contribution optional', () => {
    expect(step('family', valid({ familyMembers: [member({ occupation: '' }), member({ monthlyContribution: '' })] }))).toBeNull()
  })
})

describe('income step', () => {
  it('passes valid income', () => expect(step('income', valid())).toBeNull())
  it('requires income', () => expect(step('income', valid({ monthlyIncome: '' }))?.field).toBe('monthlyIncome'))
  it('allows ₱0 when not working', () => expect(step('income', valid({ monthlyIncome: '0', employmentType: 'unemployed', familyMembers: [] }))).toBeNull())
  it('requires a work situation', () => expect(step('income', valid({ employmentType: '' }))?.field).toBe('employmentType'))

  it('requires a description for Other', () => {
    expect(step('income', valid({ employmentType: 'other' }))?.field).toBe('employmentTypeOther')
    expect(step('income', valid({ employmentType: 'other', employmentTypeOther: 'Odd jobs' }))).toBeNull()
  })

  it('rejects ₱0 income while employed', () => {
    expect(step('income', valid({ monthlyIncome: '0', employmentType: 'employed', familyMembers: [] }))?.field).toBe('monthlyIncome')
  })

  it('rejects contributions larger than household income', () => {
    const e = step('income', valid({ monthlyIncome: '2000' }))
    expect(e.field).toBe('monthlyIncome')
    expect(e.en).toMatch(/₱3,000.*₱2,000/)
  })
})

describe('expenses step', () => {
  it('passes when all six are filled (0 allowed)', () => expect(step('expenses', valid())).toBeNull())
  it.each(['food', 'utilities', 'rent', 'education', 'medicine', 'other'])('requires %s', (k) => {
    const s = valid()
    s.expenses = { ...s.expenses, [k]: '' }
    expect(step('expenses', s)?.field).toBe(`expenses.${k}`)
  })
  it('rejects negatives', () => {
    const s = valid(); s.expenses = { ...s.expenses, rent: '-1' }
    expect(step('expenses', s)?.field).toBe('expenses.rent')
  })
})

describe('medical step', () => {
  it('passes', () => expect(step('medical', valid())).toBeNull())
  it('requires a diagnosis', () => expect(step('medical', valid({ diagnosis: ' ' }))?.field).toBe('diagnosis'))
  it('allows today, rejects a future admission date', () => {
    expect(step('medical', valid({ dateOfAdmission: TODAY }))).toBeNull()
    expect(step('medical', valid({ dateOfAdmission: '2026-11-14' }))?.field).toBe('dateOfAdmission')
  })
  it('rejects a negative estimated cost', () => expect(step('medical', valid({ estimatedTotalCost: '-1' }))?.field).toBe('estimatedTotalCost'))
})

describe('validateIntakeAll', () => {
  const steps = ['family', 'income', 'expenses', 'medical', 'review']
  it('returns null for a valid sheet', () => expect(validateIntakeAll(valid(), steps, { today: TODAY })).toBeNull())
  it('reports the first failing step', () => {
    const e = validateIntakeAll(valid({ diagnosis: '', monthlyIncome: '' }), steps, { today: TODAY })
    expect(e).toMatchObject({ stepKey: 'income', field: 'monthlyIncome' })
  })
})

describe('othersFromHouseholdSize', () => {
  it('converts the stored total to "people besides you"', () => {
    expect(othersFromHouseholdSize(6)).toBe(5)
    expect(othersFromHouseholdSize(1)).toBe(0)
    expect(othersFromHouseholdSize('')).toBe('')
    expect(othersFromHouseholdSize(null)).toBe('')
  })
})

describe('expenses above income (shortfall)', () => {
  // income 8000; expenses total 12,000 -> ₱4,000 shortfall, not a likely typo (< 3x)
  const over = (o = {}) => valid({
    expenses: { food: '6000', utilities: '1500', rent: '2500', education: '500', medicine: '1000', other: '500' }, ...o,
  })

  it('is allowed, but asks how the difference is covered', () => {
    expect(step('expenses', over())?.field).toBe('shortfallCoverage')
    expect(step('expenses', over({ shortfallCoverage: ['borrowing', 'relatives'] }))).toBeNull()
  })

  it('requires a description for Other', () => {
    expect(step('expenses', over({ shortfallCoverage: ['other'] }))?.field).toBe('shortfallCoverageOther')
    expect(step('expenses', over({ shortfallCoverage: ['other'], shortfallCoverageOther: 'Sari-sari store credit' }))).toBeNull()
  })

  it('does not ask when expenses are within income', () => {
    expect(step('expenses', valid())).toBeNull()
  })

  it('asks for a double-check when expenses are over 3x income, then accepts', () => {
    const typo = valid({ expenses: { food: '40000', utilities: '0', rent: '0', education: '0', medicine: '0', other: '0' } })
    expect(step('expenses', typo)?.field).toBe('amountsConfirmed')
    const confirmed = { ...typo, _amountsConfirmed: true }
    expect(step('expenses', confirmed)?.field).toBe('shortfallCoverage') // still asked how it's covered
    expect(step('expenses', { ...confirmed, shortfallCoverage: ['borrowing'] })).toBeNull()
  })

  it('asks how the gap is covered when income is ₱0 (no double-check: nothing to compare)', () => {
    const s = valid({ monthlyIncome: '0', employmentType: 'unemployed', familyMembers: [], householdSize: 1 })
    expect(step('expenses', s)?.field).toBe('shortfallCoverage')
  })
})
