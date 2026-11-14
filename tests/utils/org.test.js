import { describe, it, expect, afterEach, vi } from 'vitest'
import { ORG, applyHospital, onOrgChange } from '../../src/config/org'

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

  it('never lets a hospital rename the product or change the access-code prefix', () => {
    applyHospital({ name: 'X', fullName: 'Y', accessCodePrefix: 'BGH' }, 'bgh')
    expect(ORG.name).toBe(ENV.name)
    expect(ORG.fullName).toBe(ENV.fullName)
    expect(ORG.accessCodePrefix).toBe(ENV.accessCodePrefix)
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
