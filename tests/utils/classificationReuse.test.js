import { describe, it, expect } from 'vitest'
import { reusableClassification, classificationValidUntil, classificationSummary } from '../../src/utils/classificationReuse.js'

const NOW = Date.UTC(2026, 10, 16)
const monthsAgo = (m) => { const d = new Date(NOW); d.setMonth(d.getMonth() - m); return d }
const req = (id, m, extra = {}) => ({ id, requestId: `REQ-${id}`, intakeSheet: {
  meansTestCategory: 'indigent_c3', completedBy: 'Ana', completedAt: monthsAgo(m), householdSize: 4, monthlyIncome: 8000, ...extra } })

describe('reusableClassification', () => {
  it('picks the most recent classification still valid', () => {
    const r = reusableClassification([req('a', 5), req('b', 2, { meansTestCategory: 'incapacitated_c2', is4Ps: true })], NOW)
    expect(r).toMatchObject({ requestId: 'b', category: 'incapacitated_c2', by: 'Ana', householdSize: 4, is4Ps: true, validMonths: 6 })
    expect(r.validUntil.getTime()).toBeGreaterThan(NOW)
  })
  it('uses each sheet\'s own validity (6 or 12 months)', () => {
    expect(reusableClassification([req('a', 7)], NOW)).toBeNull()
    expect(reusableClassification([req('a', 7, { classificationValidMonths: 12 })], NOW)).toMatchObject({ requestId: 'a', validMonths: 12 })
    expect(reusableClassification([req('a', 13, { classificationValidMonths: 12 })], NOW)).toBeNull()
  })
  it('never reuses an old-scale category, or one never completed', () => {
    expect(reusableClassification([req('a', 1, { meansTestCategory: 'low_income' })], NOW)).toBeNull()
    expect(reusableClassification([{ id: 'x', intakeSheet: { meansTestCategory: 'indigent_c3' } }], NOW)).toBeNull()
    expect(reusableClassification([], NOW)).toBeNull()
  })
  it('carries the written reason when the class departed from the suggestion', () => {
    expect(reusableClassification([req('a', 1, { meansTestOverrideReason: 'Medical debts' })], NOW).reason).toBe('Medical debts')
  })
})

describe('classificationSummary', () => {
  it('reads class, share of the line, 4Ps and validity', () => {
    const s = { meansTestCategory: 'indigent_c3', householdSize: 4, monthlyIncome: 8000, is4Ps: true,
      classificationBasis: { povertyLine: 2500, year: 2023, region: 'BARMM' }, completedAt: new Date(Date.UTC(2026, 10, 16)) }
    expect(classificationSummary(s)).toMatch(/^Indigent \(C3\) · 80% of BARMM 2023 poverty line · 4Ps · valid until /)
    expect(classificationValidUntil(s).getUTCMonth()).toBe(4)   // 6 months on: May
  })
  it('shows an old-scale category plainly', () => {
    expect(classificationSummary({ meansTestCategory: 'low_income', completedAt: new Date() })).toBe('Low income (old scale)')
    expect(classificationSummary({})).toBe('')
  })
})
