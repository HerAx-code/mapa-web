import { describe, it, expect } from 'vitest'
import { deriveRequestFinancials, syncedRequestStatus, effectiveSlots, isSliceTerminal } from '../../src/utils/requests.js'

// Logic review 2026-11-14: request/slice lifecycle consistency.
describe('every agency declined', () => {
  it('goes back to the gateway as under_review, not submitted', () => {
    expect(deriveRequestFinancials([{ status: 'rejected' }, { status: 'closed' }], 20000).status).toBe('under_review')
    expect(deriveRequestFinancials([], 20000).status).toBe('submitted')
    expect(deriveRequestFinancials([{ status: 'reviewing', amountRequested: 20000 }], 20000).status).toBe('endorsed')
  })
})

describe('syncedRequestStatus — slice events never overwrite gateway decisions', () => {
  it('keeps rejected / closed / under_review / assessment', () => {
    for (const s of ['rejected', 'closed', 'under_review', 'assessment']) expect(syncedRequestStatus(s, 'partially_funded')).toBe(s)
  })
  it('updates the derived states', () => {
    expect(syncedRequestStatus('endorsed', 'partially_funded')).toBe('partially_funded')
    expect(syncedRequestStatus('endorsed', 'under_review')).toBe('under_review')
  })
})

describe('effectiveSlots — today’s figure', () => {
  const a = { slots: { total: 25, remaining: 0 }, lastResetDate: '2026-11-13' }
  it('a figure from an earlier day means the slots refilled', () => {
    expect(effectiveSlots(a, '2026-11-14')).toMatchObject({ total: 25, remaining: 25, stale: true, perHospital: false })
  })
  it("today's figure is used as stored", () => {
    expect(effectiveSlots({ ...a, lastResetDate: '2026-11-14' }, '2026-11-14')).toMatchObject({ total: 25, remaining: 0, stale: false })
  })
  it('a hospital with its own daily count uses it; others use the agency default', () => {
    const ag = { ...a, lastResetDate: '2026-11-14', hospitalSlots: { crmc: { total: 5, remaining: 2, lastResetDate: '2026-11-14' } } }
    expect(effectiveSlots(ag, '2026-11-14', 'crmc')).toMatchObject({ total: 5, remaining: 2, perHospital: true })
    expect(effectiveSlots(ag, '2026-11-14', 'other')).toMatchObject({ total: 25, remaining: 0, perHospital: false })
    expect(effectiveSlots({ ...ag, hospitalSlots: { crmc: { total: 5, remaining: 0, lastResetDate: '2026-11-13' } } }, '2026-11-14', 'crmc'))
      .toMatchObject({ remaining: 5, stale: true })
  })
})

describe('a slice closed by the hospital is terminal', () => {
  it('counts as done for the patient', () => {
    expect(isSliceTerminal({ status: 'closed' })).toBe(true)
  })
})
