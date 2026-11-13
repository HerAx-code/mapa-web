import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc, getDocs, collection, query, where, increment,
} from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

// Multi-hospital Phase 6 — the platform_admin role (docs/multi-hospital-network-plan.md).
// The network operator onboards hospitals + their staff and owns network config
// (agencies, reference data), and must never reach patient data. Hospital
// admins lose network config, except the slot counters the endorse flow needs.
const A = 'hospital-1'
const B = 'bgh'
let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-platform-admin',
    firestore: {
      rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  })
})
afterAll(async () => testEnv?.cleanup())

const staff = (role, tenantId) => ({ role, agencyId: null, active: true, rank: 'low', name: role, ...(tenantId ? { tenantId } : {}) })
const AGENCY = { name: 'DSWD', enabled: true, slots: { total: 10, remaining: 4 }, budget: { allocated: 1000 } }

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const put = (p, d) => setDoc(doc(db, ...p.split('/')), d)
    await Promise.all([
      put('users/plat', { role: 'platform_admin', agencyId: null, active: true, rank: null, name: 'Network Ops' }),
      put('users/plat2', { role: 'platform_admin', agencyId: null, active: true, rank: null, name: 'Ops 2' }),
      put('users/superA', staff('super_admin', A)),
      put('users/staffA', staff('staff_admin', A)),
      put('users/legacySuper', staff('super_admin')),                       // pre-backfill: hospital #1
      put('users/coord', { role: 'agency', agencyId: 'dswd', active: true, rank: null, name: 'Coord' }),
      put('users/newAgencyAdmin', { role: 'agency_admin', agencyId: null, active: true, rank: null, name: 'New' }),
      put('users/patA', { role: 'patient', agencyId: null, active: true, rank: null, name: 'Pat', tenantId: A, hospitalId: 'CODE-A' }),
      put('hospitals/hospital-1', { gatewayName: 'MSS A', accessCodePrefix: 'MAPA', enabled: true }),
      put('hospitals/bgh', { gatewayName: 'MSS B', accessCodePrefix: 'BGH', enabled: true }),
      put('agencies/dswd', AGENCY),
      put('agenciesPublic/dswd', { name: 'DSWD', enabled: true, slots: { total: 10, remaining: 4 } }),
      put('documentTypes/id', { name: 'Valid ID', order: 1 }),
      put('hospitalIds/CODE-A', { status: 'used', patId: 'patA', tenantId: A }),
      put('hospitalIds/CODE-A/privateInfo/details', { usedBy: 'Pat', usedById: 'patA' }),
      put('requests/rA', { patientId: 'patA', status: 'endorsed', agencyIds: ['dswd'], tenantId: A }),
      put('applications/aA', { patientId: 'patA', requestId: 'rA', agencyId: 'dswd', status: 'reviewing', amountRequested: 1000, tenantId: A }),
      put('documents/dA', { patientId: 'patA', status: 'pending', agencyIds: ['dswd'], tenantId: A }),
      put('documentContents/dA', { patientId: 'patA', content: 'x', tenantId: A }),
      put('certificates/aA', { patientId: 'patA', agencyId: 'dswd', appId: 'aA', tenantId: A }),
      put('reports/repA', { reportedBy: 'patA', status: 'open', category: 'Bug', description: 'x', tenantId: A }),
      put('auditLog/logA', { actorId: 'staffA', actorRole: 'staff_admin', details: 'x', tenantId: A }),
    ])
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const ref = (uid, p) => doc(as(uid), ...p.split('/'))

describe('platform_admin never reaches patient data', () => {
  const patientDocs = [
    'users/patA', 'requests/rA', 'applications/aA', 'documents/dA', 'documentContents/dA',
    'certificates/aA', 'reports/repA', 'auditLog/logA', 'hospitalIds/CODE-A/privateInfo/details',
  ]
  it.each(patientDocs)('cannot read %s', async (p) => {
    await assertFails(getDoc(ref('plat', p)))
  })

  it.each(['requests', 'applications', 'documents', 'reports', 'auditLog'])('cannot list %s, filtered or not', async (col) => {
    await assertFails(getDocs(collection(as('plat'), col)))
    await assertFails(getDocs(query(collection(as('plat'), col), where('tenantId', '==', A))))
  })

  it('cannot list patients or access codes', async () => {
    await assertFails(getDocs(query(collection(as('plat'), 'users'), where('role', '==', 'patient'))))
    await assertFails(getDocs(collection(as('plat'), 'hospitalIds')))
  })

  it('cannot write case data', async () => {
    await assertFails(updateDoc(ref('plat', 'requests/rA'), { status: 'closed' }))
    await assertFails(updateDoc(ref('plat', 'applications/aA'), { status: 'approved' }))
  })

  it('can list staff and agency users (operator directory, no PII)', async () => {
    await assertSucceeds(getDocs(query(collection(as('plat'), 'users'), where('role', 'in', ['super_admin', 'staff_admin']))))
    await assertSucceeds(getDocs(query(collection(as('plat'), 'users'), where('role', 'in', ['agency', 'agency_admin']))))
    await assertSucceeds(getDocs(query(collection(as('plat'), 'users'), where('role', '==', 'platform_admin'))))
  })
})

describe('hospitals — platform_admin onboards, the hospital edits its branding', () => {
  const NEW = { gatewayName: 'MSS', gatewayInitials: 'MSS', facilityName: 'Cotabato Provincial Hospital', accessCodePrefix: 'CPH', enabled: true }

  it('platform_admin creates a hospital and edits any hospital', async () => {
    await assertSucceeds(setDoc(ref('plat', 'hospitals/cph'), NEW))
    await assertSucceeds(updateDoc(ref('plat', 'hospitals/bgh'), { accessCodePrefix: 'BGHX', enabled: false }))
  })

  it('platform_admin cannot add keys outside the allowlist or delete a hospital', async () => {
    await assertFails(setDoc(ref('plat', 'hospitals/cph'), { ...NEW, patients: ['x'] }))
    await assertFails(deleteDoc(ref('plat', 'hospitals/bgh')))
  })

  it('a hospital super_admin cannot create a hospital', async () => {
    await assertFails(setDoc(ref('superA', 'hospitals/cph'), NEW))
  })

  it("a hospital super_admin edits its own branding but not its prefix or enabled flag", async () => {
    await assertSucceeds(updateDoc(ref('superA', 'hospitals/hospital-1'), { gatewayName: 'Malasakit Desk' }))
    await assertFails(updateDoc(ref('superA', 'hospitals/hospital-1'), { accessCodePrefix: 'BGH' }))
    await assertFails(updateDoc(ref('superA', 'hospitals/hospital-1'), { enabled: false }))
    await assertFails(updateDoc(ref('superA', 'hospitals/bgh'), { gatewayName: 'Hijacked' }))
  })
})

describe('users — platform_admin manages staff and agency users', () => {
  it("creates a hospital's first super_admin in an existing hospital", async () => {
    await assertSucceeds(setDoc(ref('plat', 'users/newSuper'), staff('super_admin', B)))
  })

  it('cannot create staff for a missing hospital or with no hospital', async () => {
    await assertFails(setDoc(ref('plat', 'users/x1'), staff('super_admin', 'nowhere')))
    await assertFails(setDoc(ref('plat', 'users/x2'), staff('staff_admin')))
  })

  it('creates agency users with no tenant, never with one', async () => {
    await assertSucceeds(setDoc(ref('plat', 'users/x3'), { role: 'agency_admin', agencyId: null, name: 'A' }))
    await assertFails(setDoc(ref('plat', 'users/x4'), { role: 'agency', agencyId: 'dswd', tenantId: A }))
  })

  it('cannot create a patient or another platform_admin', async () => {
    await assertFails(setDoc(ref('plat', 'users/x5'), { role: 'patient', tenantId: A }))
    await assertFails(setDoc(ref('plat', 'users/x6'), { role: 'platform_admin', agencyId: null }))
  })

  it('transfers a staff member to another existing hospital (D2)', async () => {
    await assertSucceeds(updateDoc(ref('plat', 'users/staffA'), { tenantId: B }))
    await assertFails(updateDoc(ref('plat', 'users/superA'), { tenantId: 'nowhere' }))
  })

  it('links an agency admin to its new agency (AddAgency second write)', async () => {
    await assertSucceeds(setDoc(ref('plat', 'users/newAgencyAdmin'), { agencyId: 'dswd' }, { merge: true }))
  })

  it('cannot cross role classes or touch patients and platform admins', async () => {
    await assertFails(updateDoc(ref('plat', 'users/staffA'), { role: 'agency' }))
    await assertFails(updateDoc(ref('plat', 'users/coord'), { role: 'super_admin' }))
    await assertFails(updateDoc(ref('plat', 'users/patA'), { tenantId: B }))
    await assertFails(updateDoc(ref('plat', 'users/plat2'), { active: false }))
    await assertFails(updateDoc(ref('plat', 'users/staffA'), { role: 'platform_admin' }))
  })

  it('deletes staff and agency users, never patients or platform admins', async () => {
    await assertSucceeds(deleteDoc(ref('plat', 'users/staffA')))
    await assertSucceeds(deleteDoc(ref('plat', 'users/coord')))
    await assertFails(deleteDoc(ref('plat', 'users/patA')))
    await assertFails(deleteDoc(ref('plat', 'users/plat2')))
  })

  it("can't promote itself (self-update pins role)", async () => {
    await assertFails(updateDoc(ref('plat', 'users/plat'), { role: 'super_admin' }))
    await assertSucceeds(updateDoc(ref('plat', 'users/plat'), { contact: '0917' }))
  })
})

describe("hospital admins can't touch a platform_admin (no tenant ≠ hospital #1)", () => {
  // A platform_admin doc has no tenantId; tenantOf() would default it to
  // hospital #1, so hospital #1's admins must be stopped by role.
  it.each(['superA', 'legacySuper'])('%s cannot edit or delete a platform_admin', async (uid) => {
    await assertFails(updateDoc(ref(uid, 'users/plat'), { active: false }))
    await assertFails(updateDoc(ref(uid, 'users/plat'), { role: 'staff_admin' }))
    await assertFails(deleteDoc(ref(uid, 'users/plat')))
  })

  it('hospital admins cannot edit or delete agency users any more', async () => {
    await assertFails(updateDoc(ref('superA', 'users/coord'), { active: false }))
    await assertFails(deleteDoc(ref('superA', 'users/coord')))
  })

  it('hospital admins still manage their own staff', async () => {
    await assertSucceeds(setDoc(ref('superA', 'users/newStaff'), staff('staff_admin', A)))
    await assertSucceeds(updateDoc(ref('superA', 'users/staffA'), { active: false }))
    await assertSucceeds(deleteDoc(ref('superA', 'users/staffA')))
  })
})

describe('agencies — network config belongs to the platform admin', () => {
  it('platform_admin creates, edits and deletes agencies', async () => {
    await assertSucceeds(setDoc(ref('plat', 'agencies/pcso'), { ...AGENCY, name: 'PCSO' }))
    await assertSucceeds(updateDoc(ref('plat', 'agencies/dswd'), { enabled: false, 'slots.total': 20 }))
    await assertSucceeds(deleteDoc(ref('plat', 'agencies/dswd')))
  })

  it.each(['superA', 'staffA'])('%s cannot create, delete, disable or resize an agency', async (uid) => {
    await assertFails(setDoc(ref(uid, 'agencies/pcso'), { ...AGENCY, name: 'PCSO' }))
    await assertFails(deleteDoc(ref(uid, 'agencies/dswd')))
    await assertFails(updateDoc(ref(uid, 'agencies/dswd'), { enabled: false }))
    await assertFails(updateDoc(ref(uid, 'agencies/dswd'), { 'slots.total': 99 }))
    await assertFails(updateDoc(ref(uid, 'agencies/dswd'), { name: 'Renamed' }))
  })

  it('hospital admins keep the endorse slot decrement and the daily slot reset', async () => {
    await assertSucceeds(updateDoc(ref('staffA', 'agencies/dswd'), { 'slots.remaining': 3 }))
    await assertSucceeds(updateDoc(ref('superA', 'agencies/dswd'), { 'slots.remaining': 10, lastResetDate: '2026-11-14' }))
  })

  it('agency staff keep their own-agency updates', async () => {
    await assertSucceeds(updateDoc(ref('coord', 'agencies/dswd'), { 'slots.remaining': increment(-1) }))
  })

  it('agenciesPublic: platform_admin writes and deletes; hospital admins mirror but cannot delete', async () => {
    const pub = { name: 'DSWD', enabled: false, slots: { total: 10, remaining: 4 } }
    await assertSucceeds(setDoc(ref('plat', 'agenciesPublic/dswd'), pub))
    await assertSucceeds(setDoc(ref('staffA', 'agenciesPublic/dswd'), pub))
    await assertFails(deleteDoc(ref('superA', 'agenciesPublic/dswd')))
    await assertSucceeds(deleteDoc(ref('plat', 'agenciesPublic/dswd')))
  })
})

describe('reference data — platform_admin only', () => {
  it.each(['documentTypes', 'assistanceTypes'])('%s: platform_admin writes, a hospital super_admin cannot', async (col) => {
    await assertSucceeds(setDoc(ref('plat', `${col}/x`), { name: 'X', order: 9 }))
    await assertFails(setDoc(ref('superA', `${col}/y`), { name: 'Y', order: 9 }))
  })

  it('everyone signed in still reads them', async () => {
    await assertSucceeds(getDoc(ref('patA', 'documentTypes/id')))
  })
})

describe('audit trail', () => {
  it('platform_admin logs its own actions untagged (network-level)', async () => {
    await assertSucceeds(setDoc(ref('plat', 'auditLog/p1'), { actorId: 'plat', actorRole: 'platform_admin', action: 'hospital_created', details: 'x' }))
    await assertFails(setDoc(ref('plat', 'auditLog/p2'), { actorId: 'plat', details: 'x', tenantId: B }))
  })
})
