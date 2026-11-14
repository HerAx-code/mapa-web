import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import {
  doc, setDoc, getDoc, updateDoc, getDocs, collection, query, where, arrayUnion,
} from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

// Multi-hospital Phase 7 — agency ↔ hospital partnerships
// (docs/multi-hospital-network-plan.md). A gateway endorses only to agencies
// partnered with its hospital; the platform admin owns the partner list; an
// agency reads a patient only after that patient is endorsed to it.
const A = 'hospital-1'
const B = 'bgh'
let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-partnerships',
    firestore: {
      rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  })
})
afterAll(async () => testEnv?.cleanup())

const patient = (tenantId, extra = {}) =>
  ({ role: 'patient', agencyId: null, rank: null, active: true, name: 'Pat', hospitalId: 'CODE', tenantId, ...extra })
const budget = { allocated: 1000 }

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const put = (p, d) => setDoc(doc(db, ...p.split('/')), d)
    await Promise.all([
      put('hospitals/hospital-1', { gatewayName: 'MSS A' }),
      put('hospitals/bgh', { gatewayName: 'MSS B' }),
      put('agencies/both',   { name: 'Both',   enabled: true, budget, slots: { total: 5, remaining: 5 }, partnerHospitalIds: [A, B] }),
      put('agencies/onlyA',  { name: 'Only A', enabled: true, budget, slots: { total: 5, remaining: 5 }, partnerHospitalIds: [A] }),
      put('agencies/legacy', { name: 'Legacy', enabled: true, budget, slots: { total: 5, remaining: 5 } }),   // pre-Phase 7
      put('users/adminA', { role: 'staff_admin', tenantId: A }),
      put('users/adminB', { role: 'staff_admin', tenantId: B }),
      put('users/plat', { role: 'platform_admin' }),
      put('users/coordBoth', { role: 'agency', agencyId: 'both', active: true, rank: null }),
      put('users/aadminA', { role: 'agency_admin', agencyId: 'onlyA', active: true, rank: null }),
      put('users/coordA', { role: 'agency', agencyId: 'onlyA', active: true, rank: null }),
      put('users/patA', patient(A, { agencyIds: ['both'] })),
      put('users/patB', patient(B, { agencyIds: [] })),
      put('users/patLegacy', patient(A)),                                   // no agencyIds yet
      put('requests/rA', { patientId: 'patA', status: 'endorsed', agencyIds: ['both'], tenantId: A }),
      put('requests/rB', { patientId: 'patB', status: 'endorsed', agencyIds: ['both'], tenantId: B }),
    ])
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const ref = (uid, p) => doc(as(uid), ...p.split('/'))
const slice = (agencyId, tenantId, patientId = 'patA') => ({ patientId, agencyId, status: 'endorsed', tenantId })

describe('endorse only to a partner agency', () => {
  it("a hospital endorses to its own partners", async () => {
    await assertSucceeds(setDoc(ref('adminA', 'applications/s1'), slice('onlyA', A)))
    await assertSucceeds(setDoc(ref('adminB', 'applications/s2'), slice('both', B, 'patB')))
  })

  it("a hospital can't endorse to an agency that doesn't partner with it", async () => {
    await assertFails(setDoc(ref('adminB', 'applications/s3'), slice('onlyA', B, 'patB')))
  })

  it('a pre-Phase-7 agency (no list yet) partners with hospital #1 only', async () => {
    await assertSucceeds(setDoc(ref('adminA', 'applications/s4'), slice('legacy', A)))
    await assertFails(setDoc(ref('adminB', 'applications/s5'), slice('legacy', B, 'patB')))
  })

  it('a slice to an agency that does not exist is denied', async () => {
    await assertFails(setDoc(ref('adminA', 'applications/s6'), slice('ghost', A)))
  })

  it("an agency can suggest only a partner of the case's hospital", async () => {
    const sug = { fromAgencyId: 'both', fromUserId: 'coordBoth', requestId: 'rB', status: 'pending', reason: 'More cover', tenantId: B }
    await assertFails(setDoc(ref('coordBoth', 'referralSuggestions/x1'), { ...sug, toAgencyId: 'onlyA' }))
    await assertSucceeds(setDoc(ref('coordBoth', 'referralSuggestions/x2'), { ...sug, requestId: 'rA', tenantId: A, toAgencyId: 'onlyA' }))
  })
})

describe('the partner list belongs to the platform admin (D4)', () => {
  it('platform admin sets it', async () => {
    await assertSucceeds(updateDoc(ref('plat', 'agencies/onlyA'), { partnerHospitalIds: [A, B] }))
  })

  it('agency staff and hospital admins cannot change it', async () => {
    for (const uid of ['aadminA', 'coordA', 'adminA']) {
      await assertFails(updateDoc(ref(uid, 'agencies/onlyA'), { partnerHospitalIds: [A, B] }))
    }
  })

  it('an agency admin still edits the rest of its own agency', async () => {
    await assertSucceeds(updateDoc(ref('aadminA', 'agencies/onlyA'), { description: 'Updated' }))
  })

  it('everyone signed in can read it (agency admins see their partners)', async () => {
    await assertSucceeds(getDoc(ref('aadminA', 'agencies/onlyA')))
  })
})

describe('agencies read only the patients endorsed to them', () => {
  it('reads an endorsed patient', async () => {
    await assertSucceeds(getDoc(ref('coordBoth', 'users/patA')))
  })

  it("can't read other patients — in any hospital, or not yet endorsed", async () => {
    await assertFails(getDoc(ref('coordBoth', 'users/patB')))
    await assertFails(getDoc(ref('coordBoth', 'users/patLegacy')))
    await assertFails(getDoc(ref('coordA', 'users/patA')))
  })

  it('can list its own patients by agencyIds, but not every patient', async () => {
    await assertSucceeds(getDocs(query(collection(as('coordBoth'), 'users'), where('agencyIds', 'array-contains', 'both'))))
    await assertFails(getDocs(query(collection(as('coordBoth'), 'users'), where('agencyIds', 'array-contains', 'onlyA'))))
    await assertFails(getDocs(query(collection(as('coordBoth'), 'users'), where('role', '==', 'patient'))))
    await assertFails(getDocs(collection(as('coordBoth'), 'users')))
  })

  it('still lists staff and agency users (directory, team)', async () => {
    await assertSucceeds(getDocs(query(collection(as('coordBoth'), 'users'), where('role', 'in', ['super_admin', 'staff_admin', 'agency', 'agency_admin']))))
    await assertSucceeds(getDocs(query(collection(as('aadminA'), 'users'), where('agencyId', '==', 'onlyA'), where('role', 'in', ['agency', 'agency_admin']))))
  })
})

describe("who writes a patient's agencyIds", () => {
  it("the patient's own gateway, at endorsement", async () => {
    await assertSucceeds(updateDoc(ref('adminA', 'users/patLegacy'), { agencyIds: arrayUnion('onlyA') }))
  })

  it("not another hospital's gateway", async () => {
    await assertFails(updateDoc(ref('adminB', 'users/patA'), { agencyIds: arrayUnion('both') }))
  })

  it('not the patient (it decides who can read their profile)', async () => {
    await assertFails(updateDoc(ref('patA', 'users/patA'), { agencyIds: ['both', 'onlyA'] }))
    await assertFails(updateDoc(ref('patA', 'users/patA'), { agencyIds: [] }))
    await assertSucceeds(updateDoc(ref('patA', 'users/patA'), { contact: '0917' }))
  })
})
