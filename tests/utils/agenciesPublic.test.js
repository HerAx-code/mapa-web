import { describe, it, expect, vi } from 'vitest'
vi.mock('../../src/firebase', () => ({ functions: {}, httpsCallable: () => async () => ({ data: {} }) }))
import { agencyFromPublic } from '../../src/utils/agenciesPublic.js'
import { effectiveSlots } from '../../src/utils/requests.js'
import { agencyPartnersWith } from '../../src/utils/hospitals.js'

// Phase 1 (N10): patients read the public listing; agencyFromPublic gives it
// the shape the existing helpers expect.
describe('agencyFromPublic', () => {
  const pub = {
    id: 'a1', name: 'A1', enabled: true,
    slots: { total: 9, remaining: 5 },                 // Landing sum
    agencySlots: { total: 3, remaining: 1 }, lastResetDate: '2026-11-21',
    hospitalSlots: { h1: { total: 6, remaining: 4, lastResetDate: '2026-11-21' } },
    partnerHospitalIds: ['h1', 'h2'],
  }
  it('uses the agency-wide counts as `slots`, so effectiveSlots falls back correctly', () => {
    const a = agencyFromPublic(pub)
    expect(a.slots).toEqual({ total: 3, remaining: 1 })
    expect(a).not.toHaveProperty('agencySlots')
    expect(effectiveSlots(a, '2026-11-21', 'h1')).toMatchObject({ total: 6, remaining: 4, perHospital: true })
    expect(effectiveSlots(a, '2026-11-21', 'h2')).toMatchObject({ total: 3, remaining: 1, perHospital: false })
    expect(effectiveSlots(a, '2026-11-22', 'h2')).toMatchObject({ remaining: 3, stale: true })
  })
  it('keeps partners, so agencyPartnersWith works on it', () => {
    expect(agencyPartnersWith(agencyFromPublic(pub), 'h2')).toBe(true)
    expect(agencyPartnersWith(agencyFromPublic(pub), 'h9')).toBe(false)
  })
  it('tolerates an old listing doc without agencySlots', () => {
    expect(agencyFromPublic({ name: 'Old', slots: { total: 2, remaining: 2 } }).slots).toEqual({ total: 2, remaining: 2 })
  })
})
