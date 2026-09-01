import { describe, it, expect } from 'vitest'
import {
  SLOT_STATUS, DEFAULT_WINDOWS, canBookInterview, formatSlotTime, toDateKey,
  addDaysKey, phWeekdayOfKey, generateSlots, isFutureSlot, groupSlotsByDay,
} from '../../src/utils/appointments.js'

describe('canBookInterview', () => {
  const open = { interviewBookingOpen: true, status: 'assessment', interviewOutcome: null }
  it('allows only when CRMC has opened booking', () => {
    expect(canBookInterview(open)).toBe(true)
    expect(canBookInterview({ ...open, interviewBookingOpen: false })).toBe(false)
    expect(canBookInterview({ ...open, interviewBookingOpen: undefined })).toBe(false)
  })
  it('blocks terminal requests', () => {
    for (const status of ['fully_funded', 'closed', 'rejected']) {
      expect(canBookInterview({ ...open, status })).toBe(false)
    }
  })
  it('blocks a request whose interview already concluded', () => {
    expect(canBookInterview({ ...open, interviewOutcome: 'completed' })).toBe(false)
    expect(canBookInterview({ ...open, interviewOutcome: 'no_show' })).toBe(false)
  })
  it('is false for nullish input', () => {
    expect(canBookInterview(null)).toBe(false)
    expect(canBookInterview(undefined)).toBe(false)
  })
})

describe('formatSlotTime', () => {
  it('formats 12-hour clock with AM/PM', () => {
    expect(formatSlotTime(0)).toBe('12:00 AM')
    expect(formatSlotTime(9 * 60)).toBe('9:00 AM')
    expect(formatSlotTime(11 * 60 + 30)).toBe('11:30 AM')
    expect(formatSlotTime(12 * 60)).toBe('12:00 PM')
    expect(formatSlotTime(13 * 60 + 30)).toBe('1:30 PM')
    expect(formatSlotTime(23 * 60 + 45)).toBe('11:45 PM')
  })
})

describe('date-key helpers (PH-local)', () => {
  it('addDaysKey rolls forward across a month boundary', () => {
    expect(addDaysKey('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDaysKey('2026-08-29', 7)).toBe('2026-09-05')
    expect(addDaysKey('2026-08-29', 0)).toBe('2026-08-29')
  })
  it('phWeekdayOfKey returns 0=Sun..6=Sat', () => {
    // 2026-08-30 is a Sunday; 2026-08-31 a Monday; 2026-09-05 a Saturday.
    expect(phWeekdayOfKey('2026-08-30')).toBe(0)
    expect(phWeekdayOfKey('2026-08-31')).toBe(1)
    expect(phWeekdayOfKey('2026-09-05')).toBe(6)
  })
  it('toDateKey emits a PH-local YYYY-MM-DD', () => {
    // 2026-08-29 23:00 UTC is already 2026-08-30 07:00 in PH.
    expect(toDateKey(new Date('2026-08-29T23:00:00Z'))).toBe('2026-08-30')
  })
})

describe('generateSlots', () => {
  it('expands one weekday window into fixed-duration slots', () => {
    // Monday 2026-08-31, 9:00–10:30 in 30-min slots → 9:00, 9:30, 10:00 (3).
    const slots = generateSlots({
      fromKey: '2026-08-31', days: 1,
      windows: [{ weekday: 1, startMin: 9 * 60, endMin: 10 * 60 + 30 }],
      durationMin: 30,
    })
    expect(slots.map(s => s.time)).toEqual(['9:00 AM', '9:30 AM', '10:00 AM'])
    expect(slots.every(s => s.status === SLOT_STATUS.OPEN)).toBe(true)
    expect(slots.every(s => s.date === '2026-08-31')).toBe(true)
    expect(slots[0].start instanceof Date).toBe(true)
  })
  it('emits only whole slots that fit inside the window', () => {
    // 9:00–10:15 with 30-min slots → 9:00, 9:30 (10:00+30=10:30 > 10:15 drops).
    const slots = generateSlots({
      fromKey: '2026-08-31', days: 1,
      windows: [{ weekday: 1, startMin: 9 * 60, endMin: 10 * 60 + 15 }],
      durationMin: 30,
    })
    expect(slots.map(s => s.time)).toEqual(['9:00 AM', '9:30 AM'])
  })
  it('skips days whose weekday has no window (e.g. weekends)', () => {
    // 2026-08-29 Sat, 30 Sun, 31 Mon. Weekday-1 window → only Monday yields.
    const slots = generateSlots({
      fromKey: '2026-08-29', days: 3,
      windows: [{ weekday: 1, startMin: 9 * 60, endMin: 9 * 60 + 30 }],
      durationMin: 30,
    })
    expect(slots).toHaveLength(1)
    expect(slots[0].date).toBe('2026-08-31')
  })
  it('DEFAULT_WINDOWS yields Mon–Fri only, none on the weekend', () => {
    const slots = generateSlots({ fromKey: '2026-08-29', days: 7, windows: DEFAULT_WINDOWS })
    const days = new Set(slots.map(s => s.date))
    expect(days.has('2026-08-29')).toBe(false) // Sat
    expect(days.has('2026-08-30')).toBe(false) // Sun
    expect(days.has('2026-08-31')).toBe(true)  // Mon
    // 2.5h (5 slots) + 3h (6 slots) = 11 slots per weekday.
    expect(slots.filter(s => s.date === '2026-08-31')).toHaveLength(11)
  })
})

describe('isFutureSlot', () => {
  const now = new Date('2026-08-29T12:00:00+08:00')
  it('is true for an open slot in the future', () => {
    expect(isFutureSlot({ status: 'open', start: new Date('2026-08-29T15:00:00+08:00') }, now)).toBe(true)
  })
  it('is false for a past slot or a booked slot', () => {
    expect(isFutureSlot({ status: 'open', start: new Date('2026-08-29T09:00:00+08:00') }, now)).toBe(false)
    expect(isFutureSlot({ status: 'booked', start: new Date('2026-08-29T15:00:00+08:00') }, now)).toBe(false)
  })
  it('tolerates a Timestamp-like start (.toDate) and an ISO string', () => {
    const ts = { toDate: () => new Date('2026-08-29T15:00:00+08:00') }
    expect(isFutureSlot({ status: 'open', start: ts }, now)).toBe(true)
    expect(isFutureSlot({ status: 'open', start: '2026-08-29T15:00:00+08:00' }, now)).toBe(true)
  })
})

describe('groupSlotsByDay', () => {
  it('buckets by day in chronological order, slots sorted within a day', () => {
    const grouped = groupSlotsByDay([
      { date: '2026-09-01', startMin: 600, time: '10:00 AM' },
      { date: '2026-08-31', startMin: 540, time: '9:00 AM' },
      { date: '2026-08-31', startMin: 780, time: '1:00 PM' },
    ])
    expect(grouped.map(g => g.date)).toEqual(['2026-08-31', '2026-09-01'])
    expect(grouped[0].slots.map(s => s.time)).toEqual(['9:00 AM', '1:00 PM'])
    expect(grouped[0].label).toMatch(/Monday/)
  })
})
