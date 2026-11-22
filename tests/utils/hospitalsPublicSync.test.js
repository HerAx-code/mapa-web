import { describe, it, expect } from 'vitest'
import { projectPublicHospital, isPublishedHospital } from '../../src/shared/hospitalPublic.js'

// The public hospital list must never include the Training Hospital (onboarding
// practice with sample patients), whatever edits the Super Admin makes later.
// Since Phase 5 PR 5.2 the onHospitalWritten function writes it, using these
// shared definitions (its own tests: tests/functions/patientIdsAndListing.test.js).
describe('the public hospital listing', () => {
  it('publishes a real hospital, with only the public fields', () => {
    expect(isPublishedHospital({ facilityName: 'CRMC', accessCodePrefix: 'CRMC', enabled: true })).toBe(true)
    const p = projectPublicHospital({ facilityName: 'CRMC', accessCodePrefix: 'CRMC', enabled: false, logoUrl: 'x', staff: ['a'] })
    expect(p).toMatchObject({ facilityName: 'CRMC', accessCodePrefix: 'CRMC', enabled: false })
    expect(p).not.toHaveProperty('logoUrl')
    expect(p).not.toHaveProperty('staff')
  })

  it('never publishes the Training Hospital', () => {
    expect(isPublishedHospital({ facilityName: 'MAPA Training Hospital', enabled: true, onboarding: { stage: 'live', training: true } })).toBe(false)
  })
})
