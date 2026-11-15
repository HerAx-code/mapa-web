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
