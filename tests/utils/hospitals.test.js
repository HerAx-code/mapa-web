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
  tenantWhere, inMyTenant, getUsersInScope, agencyPartnersWith, partnerHospitalIdsOf, fetchHospitalBranding, promoReachesMe,
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

// Phase 4 — tenant-scoped reads: ON by default; VITE_TENANT_SCOPING=false
// switches them off (un-backfilled databases only).
const signInAs = async (tenantId) => {
  getDoc.mockResolvedValue({ exists: () => false })
  await loadHospital(tenantId)
}
const docs = (...ids) => ({ docs: ids.map((id) => ({ id })) })

describe('tenantWhere', () => {
  it('is ON by default (no env flag set)', async () => {
    await signInAs('bgh')
    expect(tenantWhere()).toEqual([{ field: 'tenantId', op: '==', value: 'bgh' }])
  })

  it('adds nothing when switched off with VITE_TENANT_SCOPING=false', async () => {
    vi.stubEnv('VITE_TENANT_SCOPING', 'false')
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
    vi.stubEnv('VITE_TENANT_SCOPING', 'false')
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
    vi.stubEnv('VITE_TENANT_SCOPING', 'false')
    getDocs.mockResolvedValue(docs('a', 'b'))
    await signInAs('bgh')
    expect((await getUsersInScope({})).map((d) => d.id)).toEqual(['a', 'b'])
    expect(getDocs).toHaveBeenCalledTimes(1)
    expect(getDocs.mock.calls[0][0]).toEqual({ name: 'users', cs: [] })
  })

  it('scoping on: own hospital + its patients + agency users, de-duplicated', async () => {
    vi.stubEnv('VITE_TENANT_SCOPING', 'true')
    await signInAs('bgh')
    getDocs.mockImplementation(async (q) =>
      q.cs.some((c) => c.field === 'tenantId') ? docs('pat', 'sw')
        : q.cs.some((c) => c.field === 'tenantIds') ? docs('pat', 'moved')
        : docs('coord', 'sw'))
    expect((await getUsersInScope({})).map((d) => d.id)).toEqual(['pat', 'sw', 'moved', 'coord'])
    expect(getDocs.mock.calls.map(([q]) => q.cs)).toEqual([
      [{ field: 'tenantId', op: '==', value: 'bgh' }],
      [{ field: 'tenantIds', op: 'array-contains', value: 'bgh' }, { field: 'role', op: '==', value: 'patient' }],
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
      // Marketplace: patients who filed here but are now at another hospital.
      [{ field: 'tenantIds', op: 'array-contains', value: 'bgh' }, { field: 'role', op: '==', value: 'patient' }],
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
      [{ field: 'tenantIds', op: 'array-contains', value: 'bgh' }, { field: 'role', op: '==', value: 'patient' }],
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

// Phase 7 — agency ↔ hospital partnerships.
describe('agencyPartnersWith', () => {
  it('uses the agency partner list', () => {
    expect(agencyPartnersWith({ partnerHospitalIds: ['bgh'] }, 'bgh')).toBe(true)
    expect(agencyPartnersWith({ partnerHospitalIds: ['bgh'] }, DEFAULT_HOSPITAL_ID)).toBe(false)
  })

  it('treats a pre-Phase-7 agency (no list) as hospital #1 only, like the rules', () => {
    expect(partnerHospitalIdsOf({})).toEqual([DEFAULT_HOSPITAL_ID])
    expect(agencyPartnersWith({}, DEFAULT_HOSPITAL_ID)).toBe(true)
    expect(agencyPartnersWith({}, 'bgh')).toBe(false)
  })

  it('an empty list partners with nobody', () => {
    expect(agencyPartnersWith({ partnerHospitalIds: [] }, DEFAULT_HOSPITAL_ID)).toBe(false)
  })

  it('a missing tenant means hospital #1 (pre-backfill case)', () => {
    expect(agencyPartnersWith({ partnerHospitalIds: [DEFAULT_HOSPITAL_ID] }, undefined)).toBe(true)
  })
})

describe('getUsersInScope — agency viewer (Phase 7)', () => {
  const coord = { role: 'agency', agencyId: 'dswd' }

  it('staff + agency users, and only the patients endorsed to its agency', async () => {
    getDocs.mockImplementation(async (q) =>
      q.cs.some((c) => c.field === 'agencyIds') ? docs('pat1', 'sw') : docs('sw', 'admin'))
    expect((await getUsersInScope({}, null, coord)).map((d) => d.id)).toEqual(['sw', 'admin', 'pat1'])
    expect(getDocs.mock.calls.map(([q]) => q.cs)).toEqual([
      [{ field: 'role', op: 'in', value: ['super_admin', 'staff_admin', 'agency', 'agency_admin'] }],
      [{ field: 'agencyIds', op: 'array-contains', value: 'dswd' }],
    ])
  })

  it('never issues an unfiltered or role==patient users query', async () => {
    getDocs.mockResolvedValue(docs())
    await getUsersInScope({}, ['patient', 'staff_admin', 'super_admin', 'agency'], coord)
    for (const [q] of getDocs.mock.calls) {
      expect(q.cs.length).toBeGreaterThan(0)
      expect(q.cs.some((c) => c.field === 'role' && (c.value === 'patient' || c.value?.includes?.('patient')))).toBe(false)
    }
  })

  it('skips the patient query when patients are not wanted', async () => {
    getDocs.mockResolvedValue(docs())
    await getUsersInScope({}, ['staff_admin'], coord)
    expect(getDocs).toHaveBeenCalledTimes(1)
  })
})

// Phase 8 — documents print in the case hospital's identity.
describe('fetchHospitalBranding', () => {
  it("loads another hospital's branding (agency viewer) and caches it", async () => {
    await signInAs(null)                       // agency: no tenant
    getDoc.mockReset()
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ facilityName: 'BGH Hospital' }) })
    const b = await fetchHospitalBranding('bgh')
    expect(b.facilityName).toBe('BGH Hospital')
    await fetchHospitalBranding('bgh')
    expect(getDoc).toHaveBeenCalledTimes(1)
    expect(ORG.facilityName).not.toBe('BGH Hospital')   // the viewer's ORG is untouched
  })

  it("uses the viewer's own branding for its own hospital (no read)", async () => {
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ facilityName: 'Mine' }) })
    await loadHospital('bgh')
    getDoc.mockReset()
    expect((await fetchHospitalBranding('bgh')).facilityName).toBe('Mine')
    expect(getDoc).not.toHaveBeenCalled()
  })

  it('falls back to env branding when the read fails, and retries next time', async () => {
    await signInAs(null)
    getDoc.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    getDoc.mockRejectedValueOnce(new Error('offline'))
    expect((await fetchHospitalBranding('cph')).facilityName).toBe(ORG.facilityName)
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ facilityName: 'CPH' }) })
    expect((await fetchHospitalBranding('cph')).facilityName).toBe('CPH')
  })
})

// Agency promotions reach only patients of partner hospitals.
describe('promoReachesMe', () => {
  const agencyMap = { dswd: { partnerHospitalIds: ['bgh'] }, legacy: {} }
  const promo = (agencyId) => ({ source: 'agency', agencyId })

  it("a partner hospital's patient sees it; another hospital's does not", async () => {
    await signInAs('bgh')
    expect(promoReachesMe(promo('dswd'), agencyMap)).toBe(true)
    await signInAs(DEFAULT_HOSPITAL_ID)
    expect(promoReachesMe(promo('dswd'), agencyMap)).toBe(false)
    expect(promoReachesMe(promo('legacy'), agencyMap)).toBe(true)     // no list = hospital #1
  })

  it("hides a promotion whose agency isn't loaded (never leaks it)", async () => {
    await signInAs('bgh')
    expect(promoReachesMe(promo('ghost'), agencyMap)).toBe(false)
  })

  it('gateway announcements and network users are unaffected', async () => {
    await signInAs('bgh')
    expect(promoReachesMe({ title: 'Maintenance' }, agencyMap)).toBe(true)
    await signInAs(null)
    expect(promoReachesMe(promo('dswd'), agencyMap)).toBe(true)
  })
})
