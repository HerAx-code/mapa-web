/**
 * aging — the shared staff-queue aging vocabulary, and the guarantee that
 * sla.js (the CRMC request SLA) still maps correctly through it after being
 * refactored to delegate. One state model (ok/warn/over), per-queue thresholds.
 */
import { describe, it, expect } from 'vitest'
import { aging, toMs } from '../../src/utils/aging.js'
import { slaState, SLA_HOURS } from '../../src/utils/sla.js'

const now = Date.now()
const hoursAgo = (h) => now - h * 3_600_000
const daysAgo  = (d) => now - d * 86_400_000

describe('aging', () => {
  it('buckets by hours', () => {
    expect(aging(hoursAgo(1),  { warnAt: 36, overAt: 48, now }).state).toBe('ok')
    expect(aging(hoursAgo(40), { warnAt: 36, overAt: 48, now }).state).toBe('warn')
    expect(aging(hoursAgo(50), { warnAt: 36, overAt: 48, now }).state).toBe('over')
  })

  it('buckets by days (agency inbox thresholds)', () => {
    expect(aging(daysAgo(1), { warnAt: 3, overAt: 7, unit: 'd', now }).state).toBe('ok')
    expect(aging(daysAgo(4), { warnAt: 3, overAt: 7, unit: 'd', now }).state).toBe('warn')
    expect(aging(daysAgo(9), { warnAt: 3, overAt: 7, unit: 'd', now }).state).toBe('over')
  })

  it('missing/unparseable timestamp is ok (no false alarm)', () => {
    expect(aging(null, { warnAt: 3, overAt: 7 }).state).toBe('ok')
    expect(aging(undefined, { warnAt: 3, overAt: 7 }).elapsed).toBeNull()
  })

  it('toMs accepts Timestamp-like, {seconds}, Date and ISO', () => {
    expect(toMs({ toDate: () => new Date(1000) })).toBe(1000)
    expect(toMs({ seconds: 2 })).toBe(2000)
    expect(toMs(new Date(3000))).toBe(3000)
    expect(typeof toMs('2026-01-01')).toBe('number')
    expect(toMs(null)).toBeNull()
  })
})

describe('slaState still maps correctly after delegating to aging', () => {
  const at = (h) => ({ status: 'submitted', submittedAt: new Date(hoursAgo(h)) })
  it('ok well within SLA', () => expect(slaState(at(1), now)).toBe('ok'))
  it('due_soon within 12h of the deadline', () => expect(slaState(at(SLA_HOURS - 6), now)).toBe('due_soon'))
  it('overdue past the deadline', () => expect(slaState(at(SLA_HOURS + 2), now)).toBe('overdue'))
  it('terminal requests carry no SLA pressure', () => {
    expect(slaState({ status: 'fully_funded', submittedAt: new Date(hoursAgo(100)) }, now)).toBe('ok')
  })
})
