import { loadRules } from './helpers/rules.js'
import { issuedRecord } from './helpers/codes.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { codeProof } from '../../src/utils/codeIssue.js'

// Open sign-up (owner decision 2026-11-15, reports/Access code at
// registration.md): a patient may create a network account with no access
// code and no hospital. They join a hospital only by claiming its code when
// they file — with the patient-bound proof for a named code.
const A = 'hosp-a'
const CODE = 'AAA-2026-00001'
let env

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-open-signup',
    firestore: { rules: loadRules(), host: 'localhost', port: 8080 },
  })
})
afterAll(async () => env?.cleanup())
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'hospitals', A), { accessCodePrefix: 'AAA', enabled: true })
    await setDoc(doc(db, 'hospitalIds', CODE), { status: 'available', patId: null, bound: true, tenantId: A })
    await setDoc(doc(db, 'hospitalIds', CODE, 'privateInfo', 'issued'), issuedRecord({ lastName: 'Cruz', birthdate: '1990-05-01' }))
  })
})

const as = (u) => env.authenticatedContext(u).firestore()
const profile = { role: 'patient', agencyId: null, name: 'Ana Cruz', birthdate: '1990-05-01', hospitalId: null }

describe('open sign-up', () => {
  it('creates a network account with no hospital and no code', async () => {
    await assertSucceeds(setDoc(doc(as('p1'), 'users', 'p1'), profile))
  })
  it('cannot pick a hospital or a code without claiming one', async () => {
    await assertFails(setDoc(doc(as('p1'), 'users', 'p1'), { ...profile, tenantId: A }))
    await assertFails(setDoc(doc(as('p1'), 'users', 'p1'), { ...profile, tenantIds: [A] }))
    await assertFails(setDoc(doc(as('p1'), 'users', 'p1'), { ...profile, hospitalId: CODE }))
    await assertFails(setDoc(doc(as('p1'), 'users', 'p1'), { ...profile, agencyIds: ['dswd'] }))
  })
  it('still cannot mint a staff role', async () => {
    await assertFails(setDoc(doc(as('p1'), 'users', 'p1'), { ...profile, role: 'super_admin' }))
  })
})

describe('joining a hospital later runs on the server now (PR 3.4)', () => {
  // claimAccessCode (server) does the whole claim and checks the proof against
  // the account's own profile; the browser can no longer write status / patId
  // or privateInfo. The positive proof paths live in
  // tests/functions/codeActions.test.js.
  beforeEach(async () => { await setDoc(doc(as('p1'), 'users', 'p1'), profile) })

  it('the browser claim batch is refused', async () => {
    const db = as('p1')
    const b = writeBatch(db)
    b.update(doc(db, 'hospitalIds', CODE), { status: 'used', patId: 'p1', date: 'x', time: '' })
    b.set(doc(db, 'hospitalIds', CODE, 'privateInfo', 'details'), { usedBy: 'Ana Cruz', usedById: 'p1', createdAt: serverTimestamp(), proof: codeProof('Cruz', '1990-05-01') })
    b.update(doc(db, 'users', 'p1'), { tenantId: A, tenantIds: [A], hospitalId: CODE })
    await assertFails(b.commit())
  })
})

// Plan step 3 (lite): last name + birthdate back the patient-bound code proof,
// so a patient may fill them in once but never change them.
describe('last name and birthdate are set once', () => {
  it('an older account without them may add them', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'users', 'old'), { role: 'patient', agencyId: null, name: 'Ana Cruz', hospitalId: null }))
    await assertSucceeds(updateDoc(doc(as('old'), 'users', 'old'), { birthdate: '1990-05-01', lastName: 'Cruz' }))
  })
  it('once set, the patient cannot change them', async () => {
    await setDoc(doc(as('p2'), 'users', 'p2'), { ...profile, lastName: 'Cruz' })
    await assertFails(updateDoc(doc(as('p2'), 'users', 'p2'), { birthdate: '1991-01-01' }))
    await assertFails(updateDoc(doc(as('p2'), 'users', 'p2'), { lastName: 'Santos' }))
  })
  it('other profile edits still work, and a family manager can be recorded', async () => {
    await setDoc(doc(as('p3'), 'users', 'p3'), { ...profile, lastName: 'Cruz', managedBy: { name: 'Maria Cruz', relationship: 'child' } })
    await assertSucceeds(updateDoc(doc(as('p3'), 'users', 'p3'), { contact: '09171234567' }))
  })
})
