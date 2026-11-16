import { describe, it, expect } from 'vitest'
import { missingAgencyDocs } from '../../src/utils/agencyDocs.js'

const REQS = ['Valid ID', 'Medical Certificate', 'Hospital Billing Statement', 'Live Selfie']

describe('missingAgencyDocs', () => {
  it('lists the agency documents the request does not have (case-insensitive)', () => {
    expect(missingAgencyDocs(REQS, ['valid id', 'Live Selfie', 'Hospital Billing Statement'], {}))
      .toEqual(['Medical Certificate'])
  })
  it('for an outpatient, the unit charge slip stands in for the billing statement', () => {
    const have = ['Valid ID', 'Live Selfie', 'Medical Certificate', 'Charge Slip from the Hospital Unit']
    expect(missingAgencyDocs(REQS, have, { careSetting: 'outpatient' })).toEqual([])
    expect(missingAgencyDocs(REQS, have, { careSetting: 'inpatient' })).toEqual(['Hospital Billing Statement'])
  })
  it('handles agencies with no list', () => {
    expect(missingAgencyDocs(undefined, ['Valid ID'], {})).toEqual([])
  })
})
