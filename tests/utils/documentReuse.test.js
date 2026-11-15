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
