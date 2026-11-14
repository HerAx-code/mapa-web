import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, query, where, serverTimestamp } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'
import { fileRequest, claimCode } from './helpers/marketplace.js'

// Patient marketplace (docs/patient-marketplace-plan.md): a network-level
// patient chooses the hospital per request by claiming that hospital's access
// code; a hospital sees only patients who filed with it; a code backs one
// request.
const A = 'hospital-1'
const B = 'bgh'
let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-marketplace',
    firestore: {
      rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  })
})
afterAll(async () => testEnv?.cleanup())

const pat = (extra = {}) => ({ role: 'patient', agencyId: null, rank: null, active: true, name: 'Pat', ...extra })

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const put = (p, d) => setDoc(doc(db, ...p.split('/')), d)
    await Promise.all([
      put('hospitals/hospital-1', { gatewayName: 'MSS A', accessCodePrefix: 'MAPA', enabled: true }),
      put('hospitals/bgh', { gatewayName: 'MSS B', accessCodePrefix: 'BGH', enabled: true }),
      put('users/adminA', { role: 'staff_admin', tenantId: A }),
      put('users/adminB', { role: 'staff_admin', tenantId: B }),
      put('users/coord', { role: 'agency', agencyId: 'dswd' }),
      put('users/coordX', { role: 'agency', agencyId: 'pcso' }),
      // A network patient with no hospital yet.
      put('users/fresh', pat()),
      // A patient who filed at A (code used for request rA), now nowhere else.
      put('users/patA', pat({ tenantId: A, tenantIds: [A], hospitalId: 'MAPA-2026-00001', agencyIds: ['dswd'] })),
      // A legacy patient (pre-marketplace): tenantId only, code not yet used.
      put('users/legacy', pat({ tenantId: A, hospitalId: 'MAPA-2026-00003' })),
      put('hospitalIds/MAPA-2026-00001', { status: 'used', patId: 'patA', tenantId: A, requestId: 'rA' }),
      put('hospitalIds/MAPA-2026-00003', { status: 'used', patId: 'legacy', tenantId: A }),
      put('hospitalIds/MAPA-2026-00002', { status: 'available', patId: null, tenantId: A }),
      put('hospitalIds/BGH-2026-00001', { status: 'available', patId: null, tenantId: B }),
      put('hospitalIds/BGH-2026-00002', { status: 'available', patId: null, tenantId: B }),
      put('requests/rA', { patientId: 'patA', status: 'endorsed', agencyIds: ['dswd'], tenantId: A, patientHospitalId: 'MAPA-2026-00001' }),
      put('hospitalsPublicStats/hospital-1', { turnaroundDays: 4, basedOn: 12 }),
    ])
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const ref = (uid, p) => doc(as(uid), ...p.split('/'))
const newReq = (uid, tenantId) => ({ patientId: uid, status: 'submitted', agencyIds: [], amountCommitted: 0, tenantId, submittedAt: serverTimestamp() })

describe('choosing a hospital = claiming its code', () => {
  it('a network patient joins hospital B by claiming a B code', async () => {
    await assertSucceeds(claimCode(as('fresh'), { uid: 'fresh', code: 'BGH-2026-00001', tenantId: B, tenantIds: [B] }))
  })

  it('a patient switches hospital and KEEPS the old one in tenantIds', async () => {
    // patA was at A; filing at B now. Dropping A would cut A off from its own case.
    await assertFails(claimCode(as('patA'), { uid: 'patA', code: 'BGH-2026-00001', tenantId: B, tenantIds: [B] }))
    await assertSucceeds(claimCode(as('patA'), { uid: 'patA', code: 'BGH-2026-00001', tenantId: B, tenantIds: [A, B] }))
  })

  it('a legacy patient (tenantId only) keeps the old hospital too', async () => {
    await assertFails(claimCode(as('legacy'), { uid: 'legacy', code: 'BGH-2026-00001', tenantId: B, tenantIds: [B] }))
    await assertSucceeds(claimCode(as('legacy'), { uid: 'legacy', code: 'BGH-2026-00001', tenantId: B, tenantIds: [A, B] }))
  })

  it("the code must belong to the hospital being joined, and be theirs", async () => {
    await assertFails(claimCode(as('fresh'), { uid: 'fresh', code: 'BGH-2026-00001', tenantId: A, tenantIds: [A] }))
    // Someone else's already-used code can't be reused.
    await assertFails(claimCode(as('fresh'), { uid: 'fresh', code: 'MAPA-2026-00001', tenantId: A, tenantIds: [A] }))
  })

  it('no hospital switch without claiming a code in the same write', async () => {
    await assertFails(updateDoc(ref('patA', 'users/patA'), { tenantId: B, tenantIds: [A, B] }))
    await assertFails(updateDoc(ref('fresh', 'users/fresh'), { tenantIds: [A] }))
  })

  it("a paused hospital's code can't be claimed", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) =>
      updateDoc(doc(ctx.firestore(), 'hospitals', 'bgh'), { enabled: false }))
    await assertFails(claimCode(as('fresh'), { uid: 'fresh', code: 'BGH-2026-00001', tenantId: B, tenantIds: [B] }))
  })
})

describe('a code backs exactly one request', () => {
  it('files with an unused current code, binding it', async () => {
    await assertSucceeds(fileRequest(as('legacy'), { reqId: 'rL', code: 'MAPA-2026-00003', data: newReq('legacy', A) }))
  })

  it("a code that already backs a request can't back another", async () => {
    await assertFails(fileRequest(as('patA'), { reqId: 'r2', code: 'MAPA-2026-00001', data: newReq('patA', A) }))
  })

  it('the request must carry the code and the binding must happen in the same write', async () => {
    // Without binding the code:
    await assertFails(setDoc(ref('legacy', 'requests/rX'), { ...newReq('legacy', A), patientHospitalId: 'MAPA-2026-00003' }))
    // Without a code at all:
    await assertFails(setDoc(ref('legacy', 'requests/rY'), newReq('legacy', A)))
  })

  it("can't file with a code that isn't the patient's current one", async () => {
    await assertFails(fileRequest(as('legacy'), { reqId: 'rZ', code: 'MAPA-2026-00002', data: newReq('legacy', A) }))
  })

  it("a code can't be bound to someone else's request", async () => {
    await assertFails(updateDoc(ref('legacy', 'hospitalIds/MAPA-2026-00003'), { requestId: 'rA' }))
  })
})

describe('hospitals see only patients who filed with them', () => {
  it('A reads its patient; B does not (until the patient files at B)', async () => {
    await assertSucceeds(getDoc(ref('adminA', 'users/patA')))
    await assertFails(getDoc(ref('adminB', 'users/patA')))
  })

  it('a hospital lists its patients by tenantIds; broader patient queries are denied', async () => {
    await assertSucceeds(getDocs(query(collection(as('adminA'), 'users'), where('tenantIds', 'array-contains', A))))
    await assertFails(getDocs(query(collection(as('adminB'), 'users'), where('tenantIds', 'array-contains', A))))
    await assertFails(getDocs(query(collection(as('adminA'), 'users'), where('role', '==', 'patient'))))
  })

  it('after filing at B, B reads the patient and A still does', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) =>
      updateDoc(doc(ctx.firestore(), 'users', 'patA'), { tenantId: B, tenantIds: [A, B] }))
    await assertSucceeds(getDoc(ref('adminB', 'users/patA')))
    await assertSucceeds(getDoc(ref('adminA', 'users/patA')))
  })

  it("a hospital can edit its patient but never move the patient's hospitals or code", async () => {
    await assertSucceeds(updateDoc(ref('adminA', 'users/patA'), { contact: '0917' }))
    await assertFails(updateDoc(ref('adminA', 'users/patA'), { tenantIds: [A, B] }))
    await assertFails(updateDoc(ref('adminA', 'users/patA'), { tenantId: B }))
    await assertFails(updateDoc(ref('adminA', 'users/patA'), { hospitalId: 'MAPA-2026-00002' }))
    await assertFails(updateDoc(ref('adminB', 'users/patA'), { contact: '0917' }))
  })
})

// Consistency fixes (2026-11-14 logic review).
describe('network accounts: who may lock, erase or re-point', () => {
  const seed = (fn) => testEnv.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()))
  beforeEach(async () => seed(async (db) => {
    await setDoc(doc(db, 'users', 'superA'), { role: 'super_admin', tenantId: A })
    await setDoc(doc(db, 'users', 'superB'), { role: 'super_admin', tenantId: B })
    // Filed at A, now filing at B.
    await setDoc(doc(db, 'users', 'moved'), pat({ tenantId: B, tenantIds: [A, B], hospitalId: 'BGH-2026-00002' }))
  }))

  it("hospital #1 can't edit a patient who hasn't chosen any hospital", async () => {
    await assertFails(updateDoc(ref('adminA', 'users/fresh'), { contact: '0917' }))
    await assertFails(updateDoc(ref('adminA', 'users/fresh'), { active: false }))
  })

  it('only the CURRENT hospital may lock the network account; a past one edits the profile only', async () => {
    await assertSucceeds(updateDoc(ref('adminA', 'users/moved'), { contact: '0917' }))
    await assertFails(updateDoc(ref('adminA', 'users/moved'), { deletion: true }))
    await assertFails(updateDoc(ref('adminA', 'users/moved'), { active: false }))
    await assertSucceeds(updateDoc(ref('adminB', 'users/moved'), { deletion: true }))
  })

  it('a hospital may erase a patient only when it is their sole hospital', async () => {
    await assertFails(deleteDoc(ref('superB', 'users/moved')))   // also A's patient
    await assertSucceeds(deleteDoc(ref('superA', 'users/patA')))  // A only
  })

  it('a code that backs a request is permanent; an unfiled claimed code can be reset', async () => {
    const reset = { status: 'available', patId: null }
    await assertFails(updateDoc(ref('superA', 'hospitalIds/MAPA-2026-00001'), reset))
    await assertFails(deleteDoc(ref('superA', 'hospitalIds/MAPA-2026-00001')))
    await assertSucceeds(updateDoc(ref('superA', 'hospitalIds/MAPA-2026-00003'), reset))
  })
})

describe('hospitalsPublicStats — public counts, no client writes', () => {
  it('anyone reads; nobody writes', async () => {
    await assertSucceeds(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'hospitalsPublicStats', 'hospital-1')))
    await assertFails(setDoc(doc(as('adminA'), 'hospitalsPublicStats', 'hospital-1'), { turnaroundDays: 1 }))
    await assertFails(setDoc(doc(as('plat'), 'hospitalsPublicStats', 'hospital-1'), { turnaroundDays: 1 }))
  })
})
