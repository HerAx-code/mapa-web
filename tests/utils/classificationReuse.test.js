import { describe, it, expect } from 'vitest'
import { reusableClassification } from '../../src/utils/classificationReuse.js'

const NOW = Date.UTC(2026, 10, 16)
const monthsAgo = (m) => { const d = new Date(NOW); d.setMonth(d.getMonth() - m); return d }
const req = (id, m, extra = {}) => ({ id, requestId: `REQ-${id}`, intakeSheet: {
  meansTestCategory: 'indigent', completedBy: 'Ana', completedAt: monthsAgo(m), householdSize: 4, monthlyIncome: 8000, ...extra } })

describe('reusableClassification', () => {
  it('picks the most recent classification from the last 6 months', () => {
    const r = reusableClassification([req('a', 5), req('b', 2, { meansTestCategory: 'marginalized' })], NOW)
    expect(r).toMatchObject({ requestId: 'b', category: 'marginalized', by: 'Ana', householdSize: 4 })
    expect(r.validUntil.getTime()).toBeGreaterThan(NOW)
  })
  it('ignores classifications older than 6 months, or never completed', () => {
    expect(reusableClassification([req('a', 7)], NOW)).toBeNull()
    expect(reusableClassification([{ id: 'x', intakeSheet: { meansTestCategory: 'indigent' } }], NOW)).toBeNull()
    expect(reusableClassification([], NOW)).toBeNull()
  })
  it('carries the written reason when the category departed from the suggestion', () => {
    expect(reusableClassification([req('a', 1, { meansTestOverrideReason: 'Medical debts' })], NOW).reason).toBe('Medical debts')
  })
})
