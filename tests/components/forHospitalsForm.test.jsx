/**
 * The formal hospital request (form 2, 2026-11-15): what the form requires
 * before it submits, and the reference number quoted on the letter of intent.
 * The same requirements are enforced by firestore.rules (onboardingForm2Ok).
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/firebase', () => ({ auth: {}, db: {}, signInAnonymously: vi.fn() }))

const complete = {
  hospitalName: 'Davao Regional Medical Center', hospitalType: 'DOH-retained', nhfrCode: 'DOH000000012345',
  province: 'Davao del Norte', city: 'Tagum City', region: 'Region XI',
  officialPhone: '084 123 4567', officialEmail: 'mss@drmc.example',
  requestingOffice: 'Medical Social Service', contactName: 'Ana Reyes', contactPosition: 'Head, MSS',
  email: 'ana.reyes@drmc.example', contactPhone: '', signatoryName: 'Dr. Jose Cruz', signatoryPosition: 'Medical Center Chief',
  funders: [], malasakitOnSite: false, message: '', certifiedAuthority: true, privacyConsent: true,
}

describe('For Hospitals request form', () => {
  it('accepts a complete request', async () => {
    const { validateRequest } = await import('../../src/pages/ForHospitals')
    expect(validateRequest(complete)).toBe('')
  })

  it('names the first missing requirement', async () => {
    const { validateRequest } = await import('../../src/pages/ForHospitals')
    expect(validateRequest({ ...complete, nhfrCode: '' })).toMatch(/NHFR facility code/)
    expect(validateRequest({ ...complete, city: '' })).toMatch(/province and the city/)
    expect(validateRequest({ ...complete, officialPhone: '123' })).toMatch(/official phone/)
    expect(validateRequest({ ...complete, officialEmail: 'x' })).toMatch(/official email/)
    expect(validateRequest({ ...complete, signatoryName: '' })).toMatch(/head of facility/)
    expect(validateRequest({ ...complete, certifiedAuthority: false })).toMatch(/authorized/)
    expect(validateRequest({ ...complete, privacyConsent: false })).toMatch(/privacy notice/)
  })

  it('makes a reference the rules accept: MAPA-HR-YYMMDD-XXXX', async () => {
    const { referenceFor } = await import('../../src/pages/ForHospitals')
    const ref = referenceFor('aB3dEFGH', new Date(2026, 10, 15))
    expect(ref).toBe('MAPA-HR-261115-AB3D')
    expect(ref).toMatch(/^MAPA-HR-[0-9]{6}-[A-Z0-9]{4}$/)
  })
})
