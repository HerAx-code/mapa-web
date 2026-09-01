/**
 * groupByDay — the shared day-bucketing helper behind every facet-sidebar
 * record stream (Audit Log, App Logs, Reports; admin + agency). Verifies the
 * Today / Yesterday / weekday headings, consecutive-day grouping, the timestamp
 * accessor, and graceful handling of unparseable timestamps.
 */
import { describe, it, expect } from 'vitest'
import { groupByDay } from '../../src/utils/groupByDay.js'

// Pin "now" to a fixed Wednesday so the labels are deterministic.
const NOW = new Date('2026-08-19T15:00:00').getTime() // Wed Aug 19, 2026
const at = (iso) => new Date(iso)

describe('groupByDay', () => {
  it('labels the most recent day Today and the one before Yesterday', () => {
    const items = [
      { id: 1, createdAt: at('2026-08-19T14:00:00') }, // today
      { id: 2, createdAt: at('2026-08-19T09:00:00') }, // today
      { id: 3, createdAt: at('2026-08-18T20:00:00') }, // yesterday
      { id: 4, createdAt: at('2026-08-15T10:00:00') }, // older → weekday name
    ]
    const groups = groupByDay(items, undefined, NOW)
    expect(groups.map(g => g.label)).toEqual(['Today', 'Yesterday', 'Saturday'])
    expect(groups[0].entries.map(e => e.id)).toEqual([1, 2]) // both today's
    expect(groups[1].entries).toHaveLength(1)
    expect(groups[2].entries[0].id).toBe(4)
    expect(groups[0].sub).toMatch(/Aug 19, 2026/)
  })

  it('keeps groups in arrival order and does not merge non-adjacent same days', () => {
    // Deliberately out of order: two "today" entries split by a "yesterday".
    const items = [
      { id: 1, createdAt: at('2026-08-19T14:00:00') },
      { id: 2, createdAt: at('2026-08-18T20:00:00') },
      { id: 3, createdAt: at('2026-08-19T09:00:00') },
    ]
    const groups = groupByDay(items, undefined, NOW)
    // Adjacency-based: today, yesterday, today again — three groups.
    expect(groups.map(g => g.label)).toEqual(['Today', 'Yesterday', 'Today'])
  })

  it('uses the supplied timestamp accessor', () => {
    const items = [{ id: 1, submittedAt: at('2026-08-19T10:00:00') }]
    const groups = groupByDay(items, (it) => it.submittedAt, NOW)
    expect(groups[0].label).toBe('Today')
    expect(groups[0].entries[0].id).toBe(1)
  })

  it('buckets unparseable timestamps under Undated', () => {
    const groups = groupByDay([{ id: 1, createdAt: null }], undefined, NOW)
    expect(groups[0].label).toBe('Undated')
    expect(groups[0].key).toBe('unknown')
  })

  it('returns an empty array for no items', () => {
    expect(groupByDay([], undefined, NOW)).toEqual([])
  })
})
