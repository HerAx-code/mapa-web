import { describe, it, expect } from 'vitest'
import { approvalCooldownBlock, approvalMarkId, APPROVAL_COOLDOWN_DAYS } from '../../src/utils/approvalCooldown.js'

const DAY = 86400000
const NOW = Date.UTC(2026, 10, 15)
const mark = (daysAgo, requestId = 'r1') => ({ requestId, lastApprovedAt: new Date(NOW - daysAgo * DAY) })

describe('approvalCooldownBlock', () => {
  it('no mark → no block', () => {
    expect(approvalCooldownBlock(null, 'r2', NOW)).toBeNull()
    expect(approvalCooldownBlock({}, 'r2', NOW)).toBeNull()
  })

  it('a recent approval for another request blocks, with days left', () => {
    const b = approvalCooldownBlock(mark(10), 'r2', NOW)
    expect(b).toMatchObject({ daysAgo: 10, daysRemaining: APPROVAL_COOLDOWN_DAYS - 10, requestId: 'r1' })
  })

  it('the same request never blocks (re-approval after a reversal)', () => {
    expect(approvalCooldownBlock(mark(1), 'r1', NOW)).toBeNull()
  })

  it('exactly 30 days later the agency may approve (matches the rule)', () => {
    expect(approvalCooldownBlock(mark(30), 'r2', NOW)).toBeNull()
    expect(approvalCooldownBlock(mark(29), 'r2', NOW)).not.toBeNull()
  })

  it('accepts Firestore Timestamp-like values', () => {
    const ts = { toMillis: () => NOW - 5 * DAY }
    expect(approvalCooldownBlock({ requestId: 'r1', lastApprovedAt: ts }, 'r2', NOW).daysAgo).toBe(5)
    expect(approvalCooldownBlock({ requestId: 'r1', lastApprovedAt: { seconds: (NOW - 5 * DAY) / 1000 } }, 'r2', NOW).daysAgo).toBe(5)
  })

  it('mark ids are agency__patient', () => {
    expect(approvalMarkId('dswd', 'u1')).toBe('dswd__u1')
  })
})

describe('repeat limit per agency (Phase 1)', () => {
  it('reads the agency setting with the rule defaults', async () => {
    const { repeatLimitOf } = await import('../../src/utils/approvalCooldown.js')
    expect(repeatLimitOf({})).toEqual({ days: 30, perType: false })
    expect(repeatLimitOf({ repeatLimit: { days: 90, perType: true } })).toEqual({ days: 90, perType: true })
    expect(repeatLimitOf({ repeatLimit: { days: 0 } })).toEqual({ days: 0, perType: false })
  })
  it('days 0 never blocks; custom days are used', () => {
    expect(approvalCooldownBlock(mark(10), 'r2', NOW, { days: 0 })).toBeNull()
    expect(approvalCooldownBlock(mark(40), 'r2', NOW, { days: 90 })).toMatchObject({ days: 90, daysAgo: 40 })
    expect(approvalCooldownBlock(mark(40), 'r2', NOW, { days: 30 })).toBeNull()
  })
  it('per type: only the same assistance type counts', () => {
    const m = { requestId: 'r1', lastApprovedAt: new Date(NOW - 5 * DAY), byType: { Medicines: { at: new Date(NOW - 5 * DAY), requestId: 'r1' } } }
    expect(approvalCooldownBlock(m, 'r2', NOW, { days: 90, perType: true }, 'Laboratory Tests')).toBeNull()
    expect(approvalCooldownBlock(m, 'r2', NOW, { days: 90, perType: true }, 'Medicines')).toMatchObject({ type: 'Medicines', daysAgo: 5 })
  })
})
