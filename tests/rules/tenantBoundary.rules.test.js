import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc, getDocs, collection, query, where, serverTimestamp,
} from 'firebase/firestore'
import { fileRequest, registerWithCode } from './helpers/marketplace.js'
import fs from 'node:fs'
import path from 'node:path'

// Multi-hospital Phase 5 — the rules enforce the hospital boundary
// (docs/multi-hospital-network-plan.md). Hospital A = 'hospital-1' (the
// default: a doc or user with NO tenantId counts as A), hospital B = 'bgh'.
// The definition of done: every cross-hospital access by gateway staff or a
// patient is denied; agencies keep working across hospitals by design.
const A = 'hospital-1'
const B = 'bgh'
let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-tenant-boundary',
    firestore: {
      rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  })
})
afterAll(async () => testEnv?.cleanup())

const patient = (tenantId, code) => ({ role: 'patient', agencyId: null, rank: null, active: true, hospitalId: code, ...(tenantId ? { tenantId } : {}) })

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const put = (p, d) => setDoc(doc(db, ...p.split('/')), d)
    await Promise.all([
      put('users/adminA', { role: 'staff_admin', tenantId: A }),
      put('users/superA', { role: 'super_admin', tenantId: A }),
      put('users/adminB', { role: 'staff_admin', tenantId: B }),
      put('users/superB', { role: 'super_admin', tenantId: B }),
      put('users/legacyAdmin', { role: 'staff_admin' }),                // pre-backfill: counts as A
      put('users/coord', { role: 'agency', agencyId: 'dswd' }),
      put('users/patA', patient(A, 'CODE-A')),
      put('users/patB', patient(B, 'CODE-B')),
      put('hospitals/hospital-1', { gatewayName: 'MSS A', accessCodePrefix: 'MAPA' }),
      put('hospitals/bgh', { gatewayName: 'MSS B', accessCodePrefix: 'BGH' }),
      // Shared agencies partner with both hospitals (Phase 7).
      put('agencies/dswd', { name: 'DSWD', partnerHospitalIds: [A, B] }),
      put('agencies/pcso', { name: 'PCSO', partnerHospitalIds: [A, B] }),
      put('hospitalIds/CODE-A', { status: 'used', patId: 'patA', tenantId: A }),
      put('hospitalIds/CODE-B', { status: 'used', patId: 'patB', tenantId: B }),
      put('hospitalIds/CODE-A2', { status: 'available', patId: null, tenantId: A }),
      put('hospitalIds/CODE-B2', { status: 'available', patId: null, tenantId: B }),
      put('hospitalIds/CODE-B/privateInfo/details', { usedBy: 'Pat B', usedById: 'patB' }),
      put('requests/rA', { patientId: 'patA', status: 'endorsed', agencyIds: ['dswd'], tenantId: A }),
      put('requests/rB', { patientId: 'patB', status: 'endorsed', agencyIds: ['dswd'], tenantId: B }),
      put('requests/rLegacy', { patientId: 'patA', status: 'closed', agencyIds: [] }),   // no tenantId
      put('applications/aA', { patientId: 'patA', requestId: 'rA', agencyId: 'dswd', status: 'reviewing', amountRequested: 1000, tenantId: A }),
      put('applications/aB', { patientId: 'patB', requestId: 'rB', agencyId: 'dswd', status: 'reviewing', amountRequested: 1000, tenantId: B }),
      put('documents/dA', { patientId: 'patA', status: 'pending', agencyIds: ['dswd'], tenantId: A }),
      put('documents/dB', { patientId: 'patB', status: 'pending', agencyIds: ['dswd'], tenantId: B }),
      put('documentContents/dA', { patientId: 'patA', content: 'x', tenantId: A }),
      put('documentContents/dB', { patientId: 'patB', content: 'x', tenantId: B }),
      put('certificates/aB', { patientId: 'patB', agencyId: 'dswd', appId: 'aB', tenantId: B }),
      put('reports/repB', { reportedBy: 'patB', status: 'open', category: 'Bug', description: 'x', tenantId: B }),
      put('auditLog/logB', { actorId: 'adminB', actorRole: 'staff_admin', details: 'x', tenantId: B }),
      put('auditLog/agencyOnA', { actorId: 'coord', actorRole: 'agency', details: 'x', requestId: 'rA' }),
      put('referralSuggestions/sB', { fromAgencyId: 'dswd', toAgencyId: 'pcso', requestId: 'rB', status: 'pending', reason: 'x', tenantId: B }),
      put('announcements/annB', { title: 'B maintenance', active: true, tenantId: B }),
    ])
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const ref = (uid, p) => doc(as(uid), ...p.split('/'))
const inTenant = (uid, col, t) => query(collection(as(uid), col), where('tenantId', '==', t))

// Every tenant collection: hospital A's staff are denied hospital B's docs.
describe("another hospital's records are off-limits to gateway staff", () => {
  const tenantDocs = [
    'requests/rB', 'applications/aB', 'documents/dB', 'documentContents/dB',
    'certificates/aB', 'reports/repB', 'referralSuggestions/sB', 'users/patB',
  ]

  it.each(tenantDocs)('hospital A admin cannot READ %s', async (p) => {
    await assertFails(getDoc(ref('adminA', p)))
  })

  it.each(tenantDocs)('hospital B admin CAN read %s', async (p) => {
    await assertSucceeds(getDoc(ref('adminB', p)))
  })

  it.each(['requests/rB', 'applications/aB', 'documents/dB', 'documentContents/dB', 'certificates/aB', 'reports/repB', 'users/patB'])(
    'hospital A admin cannot UPDATE %s', async (p) => {
      await assertFails(updateDoc(ref('adminA', p), { note: 'x' }))
    })

  it.each(['requests/rB', 'applications/aB', 'documents/dB', 'certificates/aB', 'reports/repB'])(
    'hospital A admin cannot DELETE %s', async (p) => {
      await assertFails(deleteDoc(ref('adminA', p)))
    })

  it('hospital A super admin cannot read B audit entries or B access-code names', async () => {
    await assertFails(getDoc(ref('superA', 'auditLog/logB')))
    await assertFails(getDoc(ref('superA', 'hospitalIds/CODE-B/privateInfo/details')))
    await assertSucceeds(getDoc(ref('superB', 'auditLog/logB')))
  })

  it("hospital A super admin cannot edit, reissue or delete B's access codes", async () => {
    await assertFails(updateDoc(ref('superA', 'hospitalIds/CODE-B2'), { status: 'revoked' }))
    await assertFails(deleteDoc(ref('superA', 'hospitalIds/CODE-B2')))
    await assertFails(setDoc(ref('superA', 'hospitalIds/BGH-2026-00099'), { status: 'available', patId: null, tenantId: B }))
    // Phase 8: codes only under the issuing hospital's own prefix.
    await assertFails(setDoc(ref('superA', 'hospitalIds/BGH-2026-00098'), { status: 'available', patId: null, tenantId: A }))
    await assertSucceeds(setDoc(ref('superA', 'hospitalIds/MAPA-2026-00099'), { status: 'available', patId: null, tenantId: A }))
  })

  it("hospital A super admin cannot rebrand hospital B", async () => {
    await assertFails(updateDoc(ref('superA', 'hospitals/bgh'), { gatewayName: 'Hacked' }))
    await assertSucceeds(updateDoc(ref('superB', 'hospitals/bgh'), { gatewayName: 'Malasakit' }))
  })

  it("hospital A staff can't edit B's gateway announcements", async () => {
    await assertFails(updateDoc(ref('adminA', 'announcements/annB'), { title: 'x' }))
    await assertFails(deleteDoc(ref('adminA', 'announcements/annB')))
  })
})

describe('queries: rules are not filters', () => {
  it.each(['requests', 'applications', 'documents', 'reports', 'certificates', 'referralSuggestions', 'hospitalIds'])(
    '%s: own-hospital query succeeds, other-hospital query fails', async (col) => {
      await assertSucceeds(getDocs(inTenant('adminB', col, B)))
      await assertFails(getDocs(inTenant('adminA', col, B)))
    })

  it('an admin query without a tenant filter is denied (scoping must be on)', async () => {
    await assertFails(getDocs(collection(as('adminA'), 'requests')))
    await assertFails(getDocs(query(collection(as('adminA'), 'documents'), where('patientId', '==', 'patB'))))
  })

  it('a patient-directory query in scope succeeds; another hospital fails', async () => {
    await assertSucceeds(getDocs(query(collection(as('adminB'), 'users'), where('tenantId', '==', B), where('role', '==', 'patient'))))
    await assertFails(getDocs(query(collection(as('adminA'), 'users'), where('tenantId', '==', B), where('role', '==', 'patient'))))
  })

  it('agency users stay listable by every hospital (network-level)', async () => {
    await assertSucceeds(getDocs(query(collection(as('adminB'), 'users'), where('role', 'in', ['agency', 'agency_admin']))))
  })

  it("the request timeline shows an agency actor's entry to the request's own hospital only", async () => {
    const timeline = (uid) => getDocs(query(collection(as(uid), 'auditLog'), where('requestId', '==', 'rA')))
    await assertSucceeds(timeline('superA'))
    await assertFails(timeline('superB'))
  })
})

// Rules go live only after the Phase 3 backfill. Staff access to an existing
// doc is strict on tenantId (a default would leak through unfiltered queries —
// see the header comment in firestore.rules), so an untagged doc is reachable
// by no gateway staff until it's backfilled. Users are the exception: a staff
// user doc without tenantId is hospital #1.
describe('untagged records and users', () => {
  it('an untagged record is not readable by any gateway staff (backfill first)', async () => {
    await assertFails(getDoc(ref('adminA', 'requests/rLegacy')))
    await assertFails(getDoc(ref('adminB', 'requests/rLegacy')))
  })

  it("the patient still reads their own untagged record", async () => {
    await assertSucceeds(getDoc(ref('patA', 'requests/rLegacy')))
  })

  it('a staff user with no tenantId counts as hospital #1', async () => {
    await assertSucceeds(getDoc(ref('legacyAdmin', 'requests/rA')))
    await assertFails(getDoc(ref('legacyAdmin', 'requests/rB')))
    await assertSucceeds(getDocs(inTenant('legacyAdmin', 'requests', A)))
  })
})

describe('writes stay inside the writer\'s hospital', () => {
  it('an admin cannot create a slice in another hospital', async () => {
    await assertFails(setDoc(ref('adminA', 'applications/new'), { patientId: 'patB', agencyId: 'dswd', status: 'endorsed', tenantId: B }))
    await assertSucceeds(setDoc(ref('adminA', 'applications/new'), { patientId: 'patA', agencyId: 'dswd', status: 'endorsed', tenantId: A }))
  })

  it('an admin cannot move a record or a patient to another hospital', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'requests', 'rA2'), { patientId: 'patA', status: 'endorsed', agencyIds: [], tenantId: A }))
    await assertFails(updateDoc(ref('adminA', 'requests/rA2'), { tenantId: B }))
    await assertFails(updateDoc(ref('adminA', 'users/patA'), { tenantId: B }))
  })

  it('an admin cannot create a staff account in another hospital', async () => {
    await assertFails(setDoc(ref('adminA', 'users/newStaff'), { role: 'staff_admin', tenantId: B }))
    await assertSucceeds(setDoc(ref('adminA', 'users/newStaff'), { role: 'staff_admin', tenantId: A }))
  })

  // Phase 6: agency users are network-level and belong to the platform admin
  // (tests/rules/platformAdmin.rules.test.js) and their own agency admin.
  it('a hospital admin cannot create agency users (Phase 6: platform-owned)', async () => {
    await assertFails(setDoc(ref('adminB', 'users/newCoord'), { role: 'agency_admin', agencyId: 'dswd' }))
  })

  it("a patient files only at their current hospital, with that hospital's code", async () => {
    const req = { patientId: 'patA', status: 'submitted', agencyIds: [], amountCommitted: 0 }
    await assertFails(fileRequest(as('patA'), { reqId: 'x1', code: 'CODE-A', data: { ...req, tenantId: B } }))
    await assertSucceeds(fileRequest(as('patA'), { reqId: 'x2', code: 'CODE-A', data: { ...req, tenantId: A } }))
    await assertFails(setDoc(ref('patA', 'documents/x3'), { patientId: 'patA', status: 'pending', tenantId: B }))
  })

  // Registration requires a code, and joins exactly the code's hospital.
  it("registration joins the access code's hospital, nothing else", async () => {
    await assertFails(setDoc(ref('newPat1', 'users/newPat1'), { role: 'patient', name: 'Pat' }))
    await assertFails(registerWithCode(as('newPat1'), { uid: 'newPat1', code: 'CODE-B2', tenantId: A }))
    await assertSucceeds(registerWithCode(as('newPat2'), { uid: 'newPat2', code: 'CODE-B2', tenantId: B }))
  })

  it('audit entries and reports can only be tagged with the writer\'s own hospital', async () => {
    await assertFails(setDoc(ref('adminA', 'auditLog/x'), { actorId: 'adminA', details: 'x', tenantId: B }))
    await assertSucceeds(setDoc(ref('adminA', 'auditLog/y'), { actorId: 'adminA', details: 'x', tenantId: A }))
    await assertFails(setDoc(ref('patA', 'reports/x'), {
      reportedBy: 'patA', status: 'open', createdAt: serverTimestamp(), category: 'Bug', description: 'x', tenantId: B,
    }))
  })
})

describe('agencies keep working across hospitals (by design)', () => {
  it('reads its slices, documents and requests in both hospitals', async () => {
    for (const p of ['applications/aA', 'applications/aB', 'documents/dA', 'documents/dB', 'requests/rA', 'requests/rB']) {
      await assertSucceeds(getDoc(ref('coord', p)))
    }
  })

  it("a GL or suggestion it writes must carry the case's hospital", async () => {
    await assertFails(setDoc(ref('coord', 'certificates/aA'), { agencyId: 'dswd', patientId: 'patA', appId: 'aA', tenantId: B }))
    await assertSucceeds(setDoc(ref('coord', 'certificates/aA'), { agencyId: 'dswd', patientId: 'patA', appId: 'aA', tenantId: A }))
    const sug = { fromAgencyId: 'dswd', fromUserId: 'coord', toAgencyId: 'pcso', requestId: 'rB', status: 'pending', reason: 'Needs more cover' }
    await assertFails(setDoc(ref('coord', 'referralSuggestions/x1'), { ...sug, tenantId: A }))
    await assertSucceeds(setDoc(ref('coord', 'referralSuggestions/x2'), { ...sug, tenantId: B }))
  })
})
