import { describe, it, expect } from 'vitest'
import { AGENCIES, INITIAL_BUDGET } from '../../src/data/agencies.seed'

describe('agencies.seed (canonical single source)', () => {
  it('has unique ids and the expected roster', () => {
    const ids = AGENCIES.map(a => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['doh', 'philhealth', 'ambag', 'pcso', 'dswd'])
  })

  it('every agency has the fields the app + seeders rely on', () => {
    for (const a of AGENCIES) {
      expect(typeof a.name).toBe('string')
      expect(a.name.length).toBeGreaterThan(0)
      expect(typeof a.initials).toBe('string')
      expect(a.color).toMatch(/^bg-/)
      expect(typeof a.enabled).toBe('boolean')
      expect(a.slots).toMatchObject({ total: expect.any(Number), remaining: expect.any(Number) })
      expect(Array.isArray(a.requirements)).toBe(true)
      expect(Array.isArray(a.assistanceTypes)).toBe(true)
      expect(a.assistanceTypes.length).toBeGreaterThan(0)
    }
  })

  it('PhilHealth is seeded DISABLED (RA 11463: first-charge deduction, not a funder)', () => {
    const disabled = AGENCIES.filter(a => !a.enabled).map(a => a.id).sort()
    expect(disabled).toEqual(['philhealth'])
  })

  it('does not define budget (seeders apply INITIAL_BUDGET at write time)', () => {
    for (const a of AGENCIES) expect(a.budget).toBeUndefined()
    expect(INITIAL_BUDGET).toEqual({ allocated: 0, committed: 0, disbursed: 0, period: 'monthly' })
  })

  it('carries no CRMC branding in locations/descriptions (de-CRMC)', () => {
    const blob = JSON.stringify(AGENCIES)
    expect(blob).not.toMatch(/CRMC/)
  })

  it('every agency declares a valid residency scope (Phase 2.1); AMBaG is BARMM', () => {
    for (const a of AGENCIES) {
      expect(['nationwide', 'barmm']).toContain(a.eligibility?.residencyScope)
    }
    expect(AGENCIES.find(a => a.id === 'ambag').eligibility.residencyScope).toBe('barmm')
    // Everyone else is nationwide until Phase 0 confirms otherwise.
    for (const a of AGENCIES.filter(a => a.id !== 'ambag')) {
      expect(a.eligibility.residencyScope).toBe('nationwide')
    }
  })
})
