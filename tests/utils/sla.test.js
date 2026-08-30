import { describe, it, expect } from 'vitest'
import { SLA_HOURS, slaState, slaLabel, isOverdue, overdueCount } from '../../src/utils/sla.js'

// submittedAt as a Firestore-Timestamp-like { seconds }, N hours before `now`.
const submittedHoursAgo = (h, now) => ({ seconds: Math.floor((now - h * 3_600_000) / 1000) })
const NOW = Date.parse('2026-08-30T12:00:00+08:00')

describe('slaState', () => {
  it('ok when comfortably inside the window', () => {
    expect(slaState({ status: 'under_review', submittedAt: submittedHoursAgo(2, NOW) }, NOW)).toBe('ok')
  })
  it('due_soon within 12h of the deadline', () => {
    // 40h elapsed of a 48h SLA → 8h left → due_soon.
    expect(slaState({ status: 'under_review', submittedAt: submittedHoursAgo(40, NOW) }, NOW)).toBe('due_soon')
  })
  it('overdue past the deadline', () => {
    expect(slaState({ status: 'under_review', submittedAt: submittedHoursAgo(SLA_HOURS + 5, NOW) }, NOW)).toBe('overdue')
  })
  it('resolved requests carry no SLA pressure', () => {
    for (const status of ['fully_funded', 'closed', 'rejected']) {
      expect(slaState({ status, submittedAt: submittedHoursAgo(100, NOW) }, NOW)).toBe('ok')
    }
  })
  it('missing submittedAt is treated as ok, not overdue', () => {
    expect(slaState({ status: 'under_review' }, NOW)).toBe('ok')
  })
})

describe('slaLabel', () => {
  it('maps states to short labels', () => {
    expect(slaLabel('overdue')).toBe('past SLA')
    expect(slaLabel('due_soon')).toBe('due today')
    expect(slaLabel('ok')).toBe('within SLA')
  })
})

describe('isOverdue / overdueCount', () => {
  it('counts only breached, non-resolved requests', () => {
    const list = [
      { status: 'under_review', submittedAt: submittedHoursAgo(60, NOW) }, // overdue
      { status: 'assessment',   submittedAt: submittedHoursAgo(60, NOW) }, // overdue
      { status: 'under_review', submittedAt: submittedHoursAgo(2, NOW) },  // ok
      { status: 'closed',       submittedAt: submittedHoursAgo(200, NOW) },// resolved → ok
    ]
    expect(isOverdue(list[0], NOW)).toBe(true)
    expect(overdueCount(list, NOW)).toBe(2)
  })
})
