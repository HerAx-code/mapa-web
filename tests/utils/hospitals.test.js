import { describe, it, expect, vi, beforeEach } from 'vitest'

// Multi-hospital Phase 2 — tenant resolution + stamping
// (docs/multi-hospital-network-plan.md). Firestore is mocked: loadHospital's
// read result is controlled per test.
const getDoc = vi.fn()
vi.mock('../../src/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({ doc: (_db, ...path) => path.join('/'), getDoc: (...a) => getDoc(...a) }))

const { tenantIdFor, withTenant, currentTenantId, loadHospital, clearHospital, isNetworkRole } =
  await import('../../src/utils/hospitals')
const { ORG, DEFAULT_HOSPITAL_ID } = await import('../../src/config/org')

beforeEach(() => { getDoc.mockReset(); clearHospital() })

describe('tenantIdFor', () => {
  it('uses the user tenantId when present', () => {
    expect(tenantIdFor({ role: 'patient', tenantId: 'bgh' })).toBe('bgh')
    expect(tenantIdFor({ role: 'staff_admin', tenantId: 'bgh' })).toBe('bgh')
  })

  it('falls back to hospital #1 for patients and gateway staff without one (pre-backfill)', () => {
    expect(tenantIdFor({ role: 'patient' })).toBe(DEFAULT_HOSPITAL_ID)
    expect(tenantIdFor({ role: 'super_admin' })).toBe(DEFAULT_HOSPITAL_ID)
  })

  it('never reads hospitalId — that is the patient access code', () => {
    expect(tenantIdFor({ role: 'patient', hospitalId: 'MAPA-2026-00001' })).toBe(DEFAULT_HOSPITAL_ID)
  })

  it('gives agency users no tenant (agencies are network-level)', () => {
    expect(isNetworkRole('agency')).toBe(true)
    expect(tenantIdFor({ role: 'agency', tenantId: 'bgh' })).toBeNull()
    expect(tenantIdFor({ role: 'agency_admin' })).toBeNull()
  })

  it('is null when signed out', () => {
    expect(tenantIdFor(null)).toBeNull()
  })
})

describe('withTenant', () => {
  it('stamps an explicit tenant', () => {
    expect(withTenant({ a: 1 }, 'bgh')).toEqual({ a: 1, tenantId: 'bgh' })
  })

  it('omits the field (never tenantId: null) when there is no tenant', () => {
    expect(withTenant({ a: 1 }, null)).toEqual({ a: 1 })
    expect(withTenant({ a: 1 })).toEqual({ a: 1 })
  })

  it('defaults to the signed-in tenant', async () => {
    getDoc.mockResolvedValue({ exists: () => false })
    await loadHospital('bgh')
    expect(withTenant({ a: 1 })).toEqual({ a: 1, tenantId: 'bgh' })
  })
})

describe('loadHospital / clearHospital', () => {
  it('sets the tenant and applies the hospital branding', async () => {
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ gatewayName: 'Malasakit Desk' }) })
    await loadHospital('bgh')
    expect(getDoc).toHaveBeenCalledWith('hospitals/bgh')
    expect(currentTenantId()).toBe('bgh')
    expect(ORG.gatewayName).toBe('Malasakit Desk')
  })

  it('keeps the tenant even when the hospital doc fails to load', async () => {
    getDoc.mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await loadHospital('bgh')
    expect(currentTenantId()).toBe('bgh')
  })

  it('agency users: no tenant, default hospital branding', async () => {
    getDoc.mockResolvedValue({ exists: () => false })
    await loadHospital(null)
    expect(currentTenantId()).toBeNull()
    expect(getDoc).toHaveBeenCalledWith(`hospitals/${DEFAULT_HOSPITAL_ID}`)
  })

  it('clears the tenant on sign-out', async () => {
    getDoc.mockResolvedValue({ exists: () => false })
    await loadHospital('bgh')
    clearHospital()
    expect(currentTenantId()).toBeNull()
  })
})
