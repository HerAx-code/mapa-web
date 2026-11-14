import { describe, it, expect } from 'vitest'
import {
  hospitalsByPatient, patientTenantIds, requestByCode, codeVerdict,
  projectPublicHospital, publicNeedsSync,
} from '../../scripts/lib/marketplace-backfill-plan.mjs'
import { projectPublicHospital as clientProjection } from '../../src/utils/hospitalsPublic.js'

// Patient-marketplace backfill decisions (scripts/backfill-marketplace.mjs).
describe('patientTenantIds', () => {
  it('a legacy patient gets [tenantId]', () => {
    expect(patientTenantIds({ role: 'patient', tenantId: 'hospital-1' })).toEqual(['hospital-1'])
  })

  it('adds the hospital of every request the patient filed', () => {
    expect(patientTenantIds({ role: 'patient', tenantId: 'bgh' }, new Set(['hospital-1', 'bgh'])))
      .toEqual(['bgh', 'hospital-1'])
  })

  it('is additive and idempotent', () => {
    expect(patientTenantIds({ role: 'patient', tenantId: 'bgh', tenantIds: ['bgh', 'x'] })).toBeNull()
    expect(patientTenantIds({ role: 'patient', tenantId: 'bgh', tenantIds: ['x'] })).toEqual(['bgh', 'x'])
  })

  it('leaves staff, agencies and never-filed network patients alone', () => {
    expect(patientTenantIds({ role: 'staff_admin', tenantId: 'bgh' })).toBeNull()
    expect(patientTenantIds({ role: 'agency' })).toBeNull()
    expect(patientTenantIds({ role: 'patient' })).toBeNull()
  })
})

describe('hospitalsByPatient', () => {
  it('maps each patient to their requests’ hospitals, defaulting legacy ones', () => {
    const m = hospitalsByPatient([
      { patientId: 'p1', tenantId: 'bgh' },
      { patientId: 'p1' },
      { tenantId: 'x' },
    ], 'hospital-1')
    expect([...m.get('p1')].sort()).toEqual(['bgh', 'hospital-1'])
    expect(m.size).toBe(1)
  })
})

describe('requestByCode + codeVerdict', () => {
  it('binds each code to its latest request', () => {
    const m = requestByCode([
      { id: 'r1', patientId: 'p1', patientHospitalId: 'C1', submittedAt: 1 },
      { id: 'r2', patientId: 'p1', patientHospitalId: 'C1', submittedAt: 5 },
      { id: 'r3', patientId: 'p2', patientHospitalId: null },
    ])
    expect(m.get('C1').id).toBe('r2')
    expect(m.size).toBe(1)
  })

  it("binds only the filer's own, unbound code", () => {
    const req = { id: 'r1', patientId: 'p1' }
    expect(codeVerdict({ patId: 'p1' }, req)).toBe('bind')
    expect(codeVerdict({ patId: 'p1', requestId: 'r0' }, req)).toBe('already')
    expect(codeVerdict({ patId: 'p2' }, req)).toBe('mismatch')
    expect(codeVerdict(null, req)).toBe('skip')
  })
})

describe('hospitalsPublic re-projection', () => {
  it('matches the client projection exactly (the rules compare them)', () => {
    const h = { facilityName: 'A', shortName: 'a', accessCodePrefix: 'AA', enabled: false, gatewayName: 'MSS', address: 'X', region: 'BARMM', contactEmail: 'e@x.ph', secret: 1 }
    expect(projectPublicHospital(h)).toEqual(clientProjection(h))
  })

  it('syncs when a field is missing or differs; not when equal', () => {
    const h = { facilityName: 'A', accessCodePrefix: 'AA', address: 'X' }
    expect(publicNeedsSync(h, null)).toBe(true)
    expect(publicNeedsSync(h, { facilityName: 'A', shortName: '', accessCodePrefix: 'AA', enabled: true })).toBe(true)
    expect(publicNeedsSync(h, { ...projectPublicHospital(h), updatedAt: 1 })).toBe(false)
  })
})
