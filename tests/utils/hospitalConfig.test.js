import { describe, it, expect } from 'vitest'
import {
  validateHospital, hospitalDocFromForm, normalizeHospitalId, normalizePrefix,
  suggestHospitalId, emptyHospitalForm,
} from '../../src/utils/hospitalConfig'

// Multi-hospital Phase 6 — the platform admin's hospital onboarding form.
const existing = [
  { id: 'hospital-1', accessCodePrefix: 'MAPA' },
  { id: 'bgh', accessCodePrefix: 'BGH' },
]
const valid = { ...emptyHospitalForm(), id: 'cph', facilityName: 'Cotabato Provincial Hospital', accessCodePrefix: 'CPH' }

describe('validateHospital', () => {
  it('accepts a complete new hospital', () => {
    expect(validateHospital(valid, existing)).toEqual({})
  })

  it('requires a well-formed, unused id when adding', () => {
    expect(validateHospital({ ...valid, id: 'X' }, existing).id).toBeTruthy()
    expect(validateHospital({ ...valid, id: 'has space' }, existing).id).toBeTruthy()
    expect(validateHospital({ ...valid, id: 'bgh' }, existing).id).toMatch(/already exists/)
  })

  it('does not re-check the id when editing', () => {
    expect(validateHospital({ ...valid, id: '' }, existing, 'bgh').id).toBeUndefined()
  })

  it('requires the hospital and gateway names', () => {
    const e = validateHospital({ ...valid, facilityName: ' ', gatewayName: '' }, existing)
    expect(e.facilityName).toBeTruthy()
    expect(e.gatewayName).toBeTruthy()
  })

  it('keeps access-code prefixes globally unique (D5), case-insensitively', () => {
    expect(validateHospital({ ...valid, accessCodePrefix: 'bgh' }, existing).accessCodePrefix).toMatch(/already uses/)
  })

  it("lets a hospital keep its own prefix when edited", () => {
    expect(validateHospital({ ...valid, accessCodePrefix: 'BGH' }, existing, 'bgh').accessCodePrefix).toBeUndefined()
  })

  it('rejects prefixes that would break the access-code regex', () => {
    for (const p of ['A', '1AB', 'AB-C', 'A.B', 'TOOLONGPREFIX1']) {
      expect(validateHospital({ ...valid, accessCodePrefix: p }, existing).accessCodePrefix).toBeTruthy()
    }
  })

  it('checks the contact email only when given', () => {
    expect(validateHospital({ ...valid, contactEmail: '' }, existing).contactEmail).toBeUndefined()
    expect(validateHospital({ ...valid, contactEmail: 'nope' }, existing).contactEmail).toBeTruthy()
  })
})

describe('hospitalDocFromForm', () => {
  it('trims, upper-cases the prefix, drops empty optionals and the id', () => {
    expect(hospitalDocFromForm({ ...valid, accessCodePrefix: ' cph ', shortName: '  ', address: ' Cotabato ' })).toEqual({
      facilityName: 'Cotabato Provincial Hospital',
      gatewayName: 'Medical Social Services',
      gatewayInitials: 'MSS',
      accessCodePrefix: 'CPH',
      address: 'Cotabato',
    })
  })
})

describe('id + prefix helpers', () => {
  it('normalizes ids to lowercase slugs', () => {
    expect(normalizeHospitalId('  Bgh Main!! ')).toBe('bgh-main')
    expect(suggestHospitalId('Cotabato Provincial Hospital')).toBe('cotabato-provincial-hospital')
  })

  it('upper-cases prefixes', () => {
    expect(normalizePrefix(' bgh ')).toBe('BGH')
  })
})
