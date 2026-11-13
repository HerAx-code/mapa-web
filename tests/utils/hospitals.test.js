import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Multi-hospital Phase 2 — tenant resolution + stamping
// (docs/multi-hospital-network-plan.md). Firestore is mocked: loadHospital's
// read result is controlled per test.
const getDoc = vi.fn()
const getDocs = vi.fn()
vi.mock('../../src/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...path) => path.join('/'),
  getDoc: (...a) => getDoc(...a),
  collection: (_db, name) => ({ name, cs: [] }),
  where: (field, op, value) => ({ field, op, value }),
  query: (c, ...cs) => ({ name: c.name, cs: [...c.cs, ...cs] }),
  getDocs: (...a) => getDocs(...a),
}))

const {
  tenantIdFor, withTenant, currentTenantId, loadHospital, clearHospital, isNetworkRole,
  tenantWhere, inMyTenant, getUsersInScope,
} = await import('../../src/utils/hospitals')
const { ORG, DEFAULT_HOSPITAL_ID } = await import('../../src/config/org')

beforeEach(() => { getDoc.mockReset(); getDocs.mockReset(); clearHospital() })
afterEach(() => vi.unstubAllEnvs())

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

  it('gives the platform admin no tenant (network operator, Phase 6)', () => {
    expect(isNetworkRole('platform_admin')).toBe(true)
    expect(tenantIdFor({ role: 'platform_admin', tenantId: 'bgh' })).toBeNull()
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

// Phase 4 — tenant-scoped reads, dormant until VITE_TENANT_SCOPING=true.
const signInAs = async (tenantId) => {
  getDoc.mockResolvedValue({ exists: () => false })
  await loadHospital(tenantId)
}
const docs = (...ids) => ({ docs: ids.map((id) => ({ id })) })

describe('tenantWhere', () => {
  it('adds nothing while scoping is off (the default)', async () => {
    await signInAs('bgh')
    expect(tenantWhere()).toEqual([])
  })

  it('narrows to the signed-in hospital when on', async () => {
    vi.stubEnv('VITE_TENANT_SCOPING', 'true')
    await signInAs('bgh')
    expect(tenantWhere()).toEqual([{ field: 'tenantId', op: '==', value: 'bgh' }])
  })

  it('adds nothing for agency users (network-level) even when on', async () => {
    vi.stubEnv('VITE_TENANT_SCOPING', 'true')
    await signInAs(null)
    expect(tenantWhere()).toEqual([])
  })
})

describe('inMyTenant', () => {
  it('keeps everything while scoping is off', async () => {
    await signInAs('bgh')
    expect(inMyTenant({ tenantId: 'other' })).toBe(true)
  })

  it('keeps own-hospital and network-wide docs, drops other hospitals', async () => {
    vi.stubEnv('VITE_TENANT_SCOPING', 'true')
    await signInAs('bgh')
    expect(inMyTenant({ tenantId: 'bgh' })).toBe(true)
    expect(inMyTenant({ source: 'agency' })).toBe(true)
    expect(inMyTenant({ tenantId: 'other' })).toBe(false)
  })
})

describe('getUsersInScope', () => {
  it('scoping off: one plain query, as before', async () => {
    getDocs.mockResolvedValue(docs('a', 'b'))
    await signInAs('bgh')
    expect((await getUsersInScope({})).map((d) => d.id)).toEqual(['a', 'b'])
    expect(getDocs).toHaveBeenCalledTimes(1)
    expect(getDocs.mock.calls[0][0]).toEqual({ name: 'users', cs: [] })
  })

  it('scoping on: own hospital + agency users, de-duplicated', async () => {
    vi.stubEnv('VITE_TENANT_SCOPING', 'true')
    await signInAs('bgh')
    getDocs.mockImplementation(async (q) =>
      q.cs.some((c) => c.field === 'tenantId') ? docs('pat', 'sw') : docs('coord', 'sw'))
    expect((await getUsersInScope({})).map((d) => d.id)).toEqual(['pat', 'sw', 'coord'])
    expect(getDocs.mock.calls.map(([q]) => q.cs)).toEqual([
      [{ field: 'tenantId', op: '==', value: 'bgh' }],
      [{ field: 'role', op: 'in', value: ['agency', 'agency_admin'] }],
    ])
  })

  it('scoping on with roles: splits hospital roles from agency roles', async () => {
    vi.stubEnv('VITE_TENANT_SCOPING', 'true')
    await signInAs('bgh')
    getDocs.mockResolvedValue(docs())
    await getUsersInScope({}, ['patient', 'staff_admin', 'agency'])
    expect(getDocs.mock.calls.map(([q]) => q.cs)).toEqual([
      [{ field: 'tenantId', op: '==', value: 'bgh' }, { field: 'role', op: 'in', value: ['patient', 'staff_admin'] }],
      [{ field: 'role', op: 'in', value: ['agency'] }],
    ])
  })

  it('scoping on: platform admins are never directory recipients', async () => {
    vi.stubEnv('VITE_TENANT_SCOPING', 'true')
    await signInAs('bgh')
    getDocs.mockResolvedValue(docs())
    await getUsersInScope({}, ['patient', 'platform_admin'])
    expect(getDocs.mock.calls.map(([q]) => q.cs)).toEqual([
      [{ field: 'tenantId', op: '==', value: 'bgh' }, { field: 'role', op: 'in', value: ['patient'] }],
    ])
  })

  it('scoping on, hospital roles only: no agency query', async () => {
    vi.stubEnv('VITE_TENANT_SCOPING', 'true')
    await signInAs('bgh')
    getDocs.mockResolvedValue(docs())
    await getUsersInScope({}, ['super_admin'])
    expect(getDocs).toHaveBeenCalledTimes(1)
  })
})
