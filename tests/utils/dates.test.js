/**
 * dates — the shared timestamp/day helpers. phTodayKey is the canonical
 * "which day is it at the pilot site" key (Asia/Manila, UTC+8, no DST); it
 * must match the key the Dashboard writes to agency.lastResetDate so Slot
 * Management's reset-pending check can't disagree. The boundary case below is
 * the regression it fixes: for the 8h window each PH day when UTC still reads
 * the previous calendar date, a naive UTC key would differ.
 */
import { describe, it, expect } from 'vitest'
import { tsToDate, phTodayKey } from '../../src/utils/dates.js'

describe('phTodayKey', () => {
  it('returns the PH-local date, not the UTC date, across the midnight boundary', () => {
    // 2026-09-01 20:00 UTC === 2026-09-02 04:00 in Asia/Manila (+8).
    const inst = new Date('2026-09-01T20:00:00Z')
    expect(phTodayKey(inst)).toBe('2026-09-02')
    // The old bug: a UTC key would have said 2026-09-01 here.
    expect(inst.toISOString().slice(0, 10)).toBe('2026-09-01')
  })

  it('agrees with the UTC date when PH and UTC are on the same calendar day', () => {
    // Midday UTC is still the same date in PH (20:00 PHT).
    const inst = new Date('2026-09-01T12:00:00Z')
    expect(phTodayKey(inst)).toBe('2026-09-01')
  })

  it('produces a YYYY-MM-DD string by default', () => {
    expect(phTodayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('is stable regardless of the exact instant within a PH day', () => {
    // 00:30 and 23:30 PHT on 2026-09-02 → both 2026-09-02.
    const early = new Date('2026-09-01T16:30:00Z') // 00:30 PHT Sep 2
    const late  = new Date('2026-09-02T15:30:00Z') // 23:30 PHT Sep 2
    expect(phTodayKey(early)).toBe('2026-09-02')
    expect(phTodayKey(late)).toBe('2026-09-02')
  })
})

describe('tsToDate', () => {
  it('returns null for null/undefined', () => {
    expect(tsToDate(null)).toBeNull()
    expect(tsToDate(undefined)).toBeNull()
  })

  it('unwraps a Firestore-style Timestamp via toDate()', () => {
    const d = new Date('2026-09-01T00:00:00Z')
    expect(tsToDate({ toDate: () => d })).toBe(d)
  })

  it('coerces an ISO string or JS Date to a Date', () => {
    expect(tsToDate('2026-09-01T00:00:00Z')).toBeInstanceOf(Date)
    const d = new Date()
    expect(tsToDate(d).getTime()).toBe(d.getTime())
  })
})
