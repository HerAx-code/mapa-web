import { describe, it, expect } from 'vitest'
import { agencyVerdict, agenciesByPatient, missingAgencyIds } from '../../scripts/lib/partnership-backfill-plan.mjs'

// Multi-hospital Phase 7 backfill decisions (scripts/backfill-partnerships.mjs).
describe('agencyVerdict', () => {
  it('stamps an agency with no partner list', () => {
    expect(agencyVerdict({ name: 'DSWD' })).toBe('stamp')
  })

  it('never touches an existing list, even an empty one', () => {
    expect(agencyVerdict({ partnerHospitalIds: ['bgh'] })).toBe('already')
    expect(agencyVerdict({ partnerHospitalIds: [] })).toBe('already')
  })
})

describe('agenciesByPatient', () => {
  it('collects every agency holding a slice for each patient, any status', () => {
    const m = agenciesByPatient([
      { patientId: 'p1', agencyId: 'dswd', status: 'approved' },
      { patientId: 'p1', agencyId: 'pcso', status: 'rejected' },
      { patientId: 'p1', agencyId: 'dswd', status: 'endorsed' },
      { patientId: 'p2', agencyId: 'pcso' },
    ])
    expect([...m.get('p1')].sort()).toEqual(['dswd', 'pcso'])
    expect([...m.get('p2')]).toEqual(['pcso'])
  })

  it('ignores slices missing a patient or agency', () => {
    expect(agenciesByPatient([{ patientId: 'p1' }, { agencyId: 'x' }, null]).size).toBe(0)
  })
})

describe('missingAgencyIds', () => {
  it('returns only the ids not already present, sorted', () => {
    expect(missingAgencyIds(['dswd'], new Set(['pcso', 'dswd', 'doh']))).toEqual(['doh', 'pcso'])
  })

  it('handles a patient with no agencyIds yet', () => {
    expect(missingAgencyIds(undefined, new Set(['dswd']))).toEqual(['dswd'])
  })

  it('is empty once complete (the re-run verification)', () => {
    expect(missingAgencyIds(['dswd', 'pcso'], new Set(['pcso']))).toEqual([])
  })
})
