import { describe, it, expect } from 'vitest'
import { canReuseDocument } from '../../src/utils/documentReuse.js'

const NOW = Date.UTC(2026, 10, 15)
const monthsAgo = (m) => { const d = new Date(NOW); d.setMonth(d.getMonth() - m); return d }

describe('canReuseDocument', () => {
  it('reuses a document verified within the last 12 months', () => {
    expect(canReuseDocument({ status: 'verified', reviewedAt: monthsAgo(3) }, NOW)).toBe(true)
    expect(canReuseDocument({ status: 'verified', reviewedAt: monthsAgo(12) }, NOW)).toBe(true)
  })

  it('asks again once the verification is older than 12 months', () => {
    expect(canReuseDocument({ status: 'verified', reviewedAt: monthsAgo(13) }, NOW)).toBe(false)
  })

  it('never reuses a pending or rejected document', () => {
    expect(canReuseDocument({ status: 'pending', reviewedAt: monthsAgo(1) }, NOW)).toBe(false)
    expect(canReuseDocument({ status: 'rejected', reviewedAt: monthsAgo(1) }, NOW)).toBe(false)
  })

  it('falls back to createdAt, and refuses a document with no date', () => {
    expect(canReuseDocument({ status: 'verified', createdAt: { seconds: monthsAgo(2).getTime() / 1000 } }, NOW)).toBe(true)
    expect(canReuseDocument({ status: 'verified' }, NOW)).toBe(false)
  })
})

describe('reuse rules per document type (Phase 2B)', () => {
  it('reads the type rule with defaults', async () => {
    const { reuseRuleOf } = await import('../../src/utils/documentReuse.js')
    expect(reuseRuleOf({})).toEqual({ months: 12, from: 'verified' })
    expect(reuseRuleOf({ reuseMonths: 3, reuseFrom: 'issued' })).toEqual({ months: 3, from: 'issued' })
  })
  it('counts from the date on the document when the type says so', () => {
    const rule = { months: 3, from: 'issued' }
    // NOW = 15 Nov 2026
    expect(canReuseDocument({ status: 'verified', issuedOn: '2026-09-01' }, NOW, rule)).toBe(true)
    expect(canReuseDocument({ status: 'verified', issuedOn: '2026-08-01' }, NOW, rule)).toBe(false)
    // verified recently but issued long ago: not reused
    expect(canReuseDocument({ status: 'verified', issuedOn: '2026-07-01', reviewedAt: monthsAgo(0) }, NOW, rule)).toBe(false)
  })
  it('without the recorded date, an issued-date type is never reused', () => {
    expect(canReuseDocument({ status: 'verified', reviewedAt: monthsAgo(1) }, NOW, { months: 3, from: 'issued' })).toBe(false)
  })
})
