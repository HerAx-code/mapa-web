import { describe, it, expect } from 'vitest'
import {
  residencyEligibility,
  isResidencyEligible,
  hasResidencyScope,
} from '../../src/utils/eligibility.js'
import { BARMM_PROVINCES } from '../../src/utils/barmm.js'

// Residency eligibility (remediation Phase 2.1). ADVISORY: 'unknown' and
// nationwide must never exclude a patient; only an explicit province mismatch
// against a scoped funder yields 'out_of_area'.

const nationwide = { eligibility: { residencyScope: 'nationwide' } }
const barmm      = { eligibility: { residencyScope: 'barmm' } }
const unscoped   = { name: 'legacy agency, no eligibility field' }

describe('residencyEligibility', () => {
  it('nationwide funders are eligible for any province, incl. empty', () => {
    expect(residencyEligibility('Cebu', nationwide)).toBe('eligible')
    expect(residencyEligibility('', nationwide)).toBe('eligible')
    expect(residencyEligibility(undefined, nationwide)).toBe('eligible')
  })

  it('a missing eligibility field defaults to nationwide (backward compatible)', () => {
    expect(residencyEligibility('Cebu', unscoped)).toBe('eligible')
    expect(residencyEligibility('', unscoped)).toBe('eligible')
  })

  it('BARMM-scoped funders accept every BARMM province', () => {
    for (const prov of BARMM_PROVINCES) {
      expect(residencyEligibility(prov, barmm)).toBe('eligible')
    }
  })

  it('BARMM-scoped funders flag a non-BARMM province out_of_area', () => {
    expect(residencyEligibility('Cebu', barmm)).toBe('out_of_area')
    expect(residencyEligibility('Metro Manila', barmm)).toBe('out_of_area')
  })

  it('BARMM-scoped funders return unknown on missing/blank province (never excluded)', () => {
    expect(residencyEligibility('', barmm)).toBe('unknown')
    expect(residencyEligibility(null, barmm)).toBe('unknown')
    expect(residencyEligibility('   ', barmm)).toBe('unknown')
  })

  it('trims surrounding whitespace before matching', () => {
    expect(residencyEligibility('  Basilan  ', barmm)).toBe('eligible')
  })

  it('supports an explicit province allowlist scope (future use)', () => {
    const custom = { eligibility: { residencyScope: ['Basilan', 'Sulu'] } }
    expect(residencyEligibility('Basilan', custom)).toBe('eligible')
    expect(residencyEligibility('Lanao del Sur', custom)).toBe('out_of_area')
  })
})

describe('isResidencyEligible (boolean convenience)', () => {
  it('only out_of_area is disqualifying; unknown + eligible pass', () => {
    expect(isResidencyEligible('Basilan', barmm)).toBe(true)      // eligible
    expect(isResidencyEligible('', barmm)).toBe(true)             // unknown → not excluded
    expect(isResidencyEligible('Cebu', barmm)).toBe(false)        // out_of_area
    expect(isResidencyEligible('Cebu', nationwide)).toBe(true)
  })
})

describe('hasResidencyScope', () => {
  it('is true only for funders narrower than nationwide', () => {
    expect(hasResidencyScope(barmm)).toBe(true)
    expect(hasResidencyScope(nationwide)).toBe(false)
    expect(hasResidencyScope(unscoped)).toBe(false)
  })
})
