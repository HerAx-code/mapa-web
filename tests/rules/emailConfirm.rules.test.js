import { loadRules } from './helpers/rules.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { fileRequest } from './helpers/marketplace.js'

// Email confirmation before filing (registration research 2026-11-24): a patient
// account created on or after 2026-11-25 00:00 Manila must have opened its
// verification link before it files; older accounts are exempt. createdAt is
// the server's time at sign-up and can't be changed afterwards.
const A = 'hospital-1'
const NEW = Timestamp.fromDate(new Date('2026-12-01T02:00:00Z'))
const OLD = Timestamp.fromDate(new Date('2026-11-01T02:00:00Z'))
let testEnv
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-email-confirm',
    firestore: { rules: loadRules(), host: 'localhost', port: 8080 },
  })
})
afterAll(async () => testEnv?.cleanup())

const patient = (createdAt) => ({
  role: 'patient', agencyId: null, rank: null, active: true, name: 'Pat',
  tenantId: A, tenantIds: [A], hospitalId: 'MAPA-2026-00001',
  ...(createdAt === undefined ? {} : { createdAt }),
})
const seed = (createdAt) => testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await Promise.all([
    setDoc(doc(db, 'hospitals', A), { accessCodePrefix: 'MAPA', enabled: true }),
    setDoc(doc(db, 'users', 'pat'), patient(createdAt)),
    setDoc(doc(db, 'hospitalIds', 'MAPA-2026-00001'), { status: 'used', patId: 'pat', tenantId: A }),
  ])
})
beforeEach(async () => { await testEnv.clearFirestore() })

const as = (uid, verified) => testEnv.authenticatedContext(uid, verified === undefined ? {} : { email_verified: verified }).firestore()
const file = (db) => fileRequest(db, {
  reqId: 'rNew', code: 'MAPA-2026-00001',
  data: { patientId: 'pat', status: 'submitted', agencyIds: [], amountCommitted: 0, tenantId: A, submittedAt: serverTimestamp() },
})

describe('filing needs a confirmed email on new accounts', () => {
  it('a new account with an unconfirmed email cannot file', async () => {
    await seed(NEW)
    await assertFails(file(as('pat', false)))
    await assertFails(file(as('pat')))
  })
  it('a new account files once its email is confirmed', async () => {
    await seed(NEW)
    await assertSucceeds(file(as('pat', true)))
  })
  it('an account made before the cutoff files without confirming', async () => {
    await seed(OLD)
    await assertSucceeds(file(as('pat', false)))
  })
  it('an older account with no createdAt (or a non-timestamp one) is exempt', async () => {
    await seed(undefined)
    await assertSucceeds(file(as('pat', false)))
    await testEnv.clearFirestore()
    await seed('2026-10-01')
    await assertSucceeds(file(as('pat', false)))
  })
})

describe('createdAt is the server time and stays put', () => {
  const signUp = (data) => setDoc(doc(as('newbie', false), 'users', 'newbie'), {
    role: 'patient', name: 'New Patient', email: 'new@example.com', hospitalId: null, agencyId: null, ...data,
  })
  it('sign-up must stamp createdAt with the server time', async () => {
    await assertSucceeds(signUp({ createdAt: serverTimestamp() }))
  })
  it('sign-up without createdAt, or with a chosen one, is refused', async () => {
    await assertFails(signUp({}))
    await assertFails(signUp({ createdAt: OLD }))
  })
  it('a patient cannot change their own createdAt', async () => {
    await seed(NEW)
    await assertFails(updateDoc(doc(as('pat', false), 'users', 'pat'), { createdAt: OLD }))
    await assertSucceeds(updateDoc(doc(as('pat', false), 'users', 'pat'), { contact: '09171234567' }))
  })
})
