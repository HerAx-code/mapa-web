import { describe, it, expect, afterEach, vi } from 'vitest'
import { ORG, applyHospital, onOrgChange, brandingFor, accessCodeRe } from '../../src/config/org'

// Multi-hospital Phase 1 — a hospital doc overrides ORG in place, with the
// env values as the fallback (docs/multi-hospital-network-plan.md).
const ENV = { ...ORG }

afterEach(() => applyHospital(null))

describe('applyHospital', () => {
  it('starts on the env defaults and carries no tenant id (branding only)', () => {
    expect(ORG.gatewayName).toBe(ENV.gatewayName)
    expect(ORG).not.toHaveProperty('hospitalId')
    expect(ORG).not.toHaveProperty('tenantId')
  })

  it('copies hospital-level fields into ORG', () => {
    applyHospital({
      gatewayName: 'Malasakit Desk', gatewayInitials: 'MD',
      facilityName: 'Bangsamoro General Hospital', contactEmail: 'mss@bgh.example',
      shortName: 'BGH',
    }, 'bgh')
    expect(ORG).toMatchObject({
      gatewayName: 'Malasakit Desk', gatewayInitials: 'MD',
      facilityName: 'Bangsamoro General Hospital', contactEmail: 'mss@bgh.example', shortName: 'BGH',
    })
  })

  it('uses a configured facility name verbatim in Filipino too', () => {
    applyHospital({ facilityName: 'Bangsamoro General Hospital' }, 'bgh')
    expect(ORG.facilityNameFil).toBe('Bangsamoro General Hospital')
  })

  it('never lets a hospital rename the product', () => {
    applyHospital({ name: 'X', fullName: 'Y' }, 'bgh')
    expect(ORG.name).toBe(ENV.name)
    expect(ORG.fullName).toBe(ENV.fullName)
  })

  // Phase 8: each hospital issues codes under its own prefix.
  it("uses the hospital's access-code prefix and address", () => {
    applyHospital({ accessCodePrefix: 'BGH', address: 'Cotabato City' }, 'bgh')
    expect(ORG.accessCodePrefix).toBe('BGH')
    expect(ORG.address).toBe('Cotabato City')
  })

  it('keeps the env value for blank or non-string fields', () => {
    applyHospital({ gatewayName: '   ', contactEmail: 42 }, 'bgh')
    expect(ORG.gatewayName).toBe(ENV.gatewayName)
    expect(ORG.contactEmail).toBe(ENV.contactEmail)
  })

  it('resets fully to env (no leftovers from the previous hospital) on null', () => {
    applyHospital({ gatewayName: 'Malasakit Desk', facilityName: 'BGH' }, 'bgh')
    applyHospital(null)
    expect(ORG).toEqual(ENV)
  })

  it('notifies subscribers, and stops after unsubscribe', () => {
    const fn = vi.fn()
    const off = onOrgChange(fn)
    applyHospital({ gatewayName: 'A' }, 'a')
    expect(fn).toHaveBeenCalledWith(ORG)
    off()
    applyHospital(null)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

// Phase 8 — a case hospital's branding without touching the viewer's ORG.
describe('brandingFor', () => {
  it("returns the hospital's branding and leaves ORG alone", () => {
    const b = brandingFor({ facilityName: 'Bangsamoro General Hospital', gatewayInitials: 'BGH' })
    expect(b.facilityName).toBe('Bangsamoro General Hospital')
    expect(b.facilityNameFil).toBe('Bangsamoro General Hospital')
    expect(b.gatewayInitials).toBe('BGH')
    expect(ORG).toEqual(ENV)
  })

  it('falls back to env for a missing hospital', () => {
    expect(brandingFor(null)).toEqual(ENV)
  })
})

describe('accessCodeRe (any hospital, Phase 8)', () => {
  it("accepts any well-formed hospital prefix", () => {
    expect(accessCodeRe().test('MAPA-2026-00001')).toBe(true)
    expect(accessCodeRe().test('BGH-2026-00001')).toBe(true)
    expect(accessCodeRe().test('CPH2-2026-00001')).toBe(true)
  })

  it('rejects malformed codes', () => {
    for (const c of ['B-2026-00001', '1AB-2026-00001', 'BGH-26-00001', 'BGH-2026-0001', 'bgh-2026-00001', 'BGH-2026-00001X']) {
      expect(accessCodeRe().test(c)).toBe(false)
    }
  })
})
