import { describe, it, expect } from 'vitest'
import {
  validateHospital, hospitalDocFromForm, normalizeHospitalId, normalizePrefix,
  suggestHospitalId, emptyHospitalForm, nextPartnerLists, prefixFromInput,
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

// Partner agencies chosen in the hospital form → each agency's partner list.
describe('nextPartnerLists', () => {
  const agencies = [
    { id: 'dswd', partnerHospitalIds: ['hospital-1'] },
    { id: 'pcso', partnerHospitalIds: ['hospital-1', 'cph'] },
    { id: 'legacy' },                                            // no list = hospital #1
  ]

  it('adds and removes only where the partnership changes', () => {
    expect(nextPartnerLists(agencies, 'cph', new Set(['dswd']))).toEqual([
      { agencyId: 'dswd', partnerHospitalIds: ['hospital-1', 'cph'] },
      { agencyId: 'pcso', partnerHospitalIds: ['hospital-1'] },
    ])
  })

  it("keeps hospital #1 when a legacy agency (no list) gains a new hospital", () => {
    expect(nextPartnerLists(agencies, 'cph', new Set(['pcso', 'legacy']))).toEqual([
      { agencyId: 'legacy', partnerHospitalIds: ['hospital-1', 'cph'] },
    ])
  })

  it('removing hospital #1 from a legacy agency writes an explicit empty list', () => {
    expect(nextPartnerLists(agencies, 'hospital-1', new Set(['dswd', 'pcso']))).toEqual([
      { agencyId: 'legacy', partnerHospitalIds: [] },
    ])
  })

  it('no changes, no writes', () => {
    expect(nextPartnerLists(agencies, 'cph', new Set(['pcso']))).toEqual([])
  })
})

// The hospital form's prefix box keeps only the prefix part.
describe('prefixFromInput', () => {
  it('drops the code format or a pasted code after the first dash', () => {
    expect(prefixFromInput('CRMC-YYYY-NNNNN')).toBe('CRMC')
    expect(prefixFromInput('crmc-2026-00001')).toBe('CRMC')
  })

  it('upper-cases and keeps letters and digits only, max 10', () => {
    expect(prefixFromInput(' bgh ')).toBe('BGH')
    expect(prefixFromInput('C.R.M.C')).toBe('CRMC')
    expect(prefixFromInput('ABCDEFGHIJKLMN')).toBe('ABCDEFGHIJ')
  })
})
