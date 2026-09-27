/**
 * journeyState — the one canonical patient journey model. Every request status
 * (incl. terminal + legacy/unknown) must resolve to a sensible rank + a
 * done/current/upcoming distribution, and never throw. This is the acceptance
 * guard for "Dashboard and TrackStatus render the same stages from one source."
 */
import { describe, it, expect } from 'vitest'
import { journeyState, JOURNEY_STAGES, JOURNEY_TOTAL } from '../../src/utils/journey.js'

const states = (r) => journeyState(r).stages.map((s) => s.state)
const currentKey = (r) => journeyState(r).stages.find((s) => s.state === 'current')?.key ?? null

describe('journeyState', () => {
  it('has exactly six stages in lifecycle order', () => {
    expect(JOURNEY_TOTAL).toBe(6)
    expect(JOURNEY_STAGES.map((s) => s.key)).toEqual([
      'submitted', 'under_review', 'assessment', 'endorsed', 'funding', 'complete',
    ])
  })

  it('submitted → first stage current, rest upcoming', () => {
    const r = { status: 'submitted' }
    expect(journeyState(r).rank).toBe(0)
    expect(currentKey(r)).toBe('submitted')
    expect(states(r)).toEqual(['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming'])
  })

  it('assessment → rank 2, two done then current', () => {
    const r = { status: 'assessment' }
    expect(journeyState(r).rank).toBe(2)
    expect(currentKey(r)).toBe('assessment')
    expect(states(r)).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming'])
  })

  it('partially_funded → funding is current', () => {
    const r = { status: 'partially_funded' }
    expect(journeyState(r).rank).toBe(4)
    expect(currentKey(r)).toBe('funding')
    expect(states(r).slice(0, 4).every((s) => s === 'done')).toBe(true)
  })

  it('fully_funded → all prior done, complete current', () => {
    const r = { status: 'fully_funded' }
    expect(journeyState(r).rank).toBe(5)
    expect(currentKey(r)).toBe('complete')
    expect(states(r)).toEqual(['done', 'done', 'done', 'done', 'done', 'current'])
  })

  it('rejected → outcome rejected, no stage current', () => {
    const r = { status: 'rejected' }
    const j = journeyState(r)
    expect(j.outcome).toBe('rejected')
    expect(j.rank).toBe(-1)
    expect(currentKey(r)).toBeNull()
  })

  it('closed → outcome closed, resolves to the partially_funded rank', () => {
    const r = { status: 'closed' }
    const j = journeyState(r)
    expect(j.outcome).toBe('closed')
    expect(j.rank).toBe(4)
  })

  it('unknown / missing status falls back to rank 0 and never throws', () => {
    expect(() => journeyState({ status: 'interview' })).not.toThrow() // removed legacy status
    expect(journeyState({ status: 'interview' }).rank).toBe(0)
    expect(journeyState({}).rank).toBe(0)
    expect(journeyState(null).rank).toBe(0)
    expect(journeyState(undefined).outcome).toBeNull()
  })
})
