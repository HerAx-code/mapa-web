import { loadRules } from './helpers/rules.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore'

// Two-factor stage 2 (Phase 5 PR 5.4, decision P5-D), with the switch ON (the
// shipped rules have it off). Staff permissions need a session signed in with
// a second factor; patients are exempt; a staff member without one can still
// read their own profile, which MfaGate needs to send them to set it up.
const A = 'hospital-1'
let testEnv
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-staff-mfa',
    firestore: { rules: loadRules({ enforceMfa: true }), host: 'localhost', port: 8080 },
  })
})
afterAll(async () => testEnv?.cleanup())

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const put = (p, d) => setDoc(doc(db, ...p.split('/')), d)
    await Promise.all([
      put('users/sw', { role: 'staff_admin', tenantId: A, name: 'SW' }),
      put('users/co', { role: 'agency', agencyId: 'dswd', name: 'Co' }),
      put('users/pat', { role: 'patient', agencyId: null, rank: null, active: true, name: 'Pat', tenantId: A, tenantIds: [A] }),
      put('requests/r1', { patientId: 'pat', tenantId: A, status: 'under_review', agencyIds: [], amountCommitted: 0 }),
      put('agencies/dswd', { name: 'DSWD', enabled: true }),
    ])
  })
})
const withFactor = (uid) => testEnv.authenticatedContext(uid, { firebase: { sign_in_second_factor: 'totp' } }).firestore()
const passwordOnly = (uid) => testEnv.authenticatedContext(uid).firestore()

describe('two-factor stage 2 (switch on)', () => {
  it('hospital staff need a second factor for case data', async () => {
    await assertSucceeds(getDoc(doc(withFactor('sw'), 'requests', 'r1')))
    await assertFails(getDoc(doc(passwordOnly('sw'), 'requests', 'r1')))
  })

  it('agency staff need one too', async () => {
    await assertSucceeds(getDoc(doc(withFactor('co'), 'agencies', 'dswd')))
    await assertFails(updateDoc(doc(passwordOnly('co'), 'agencies', 'dswd'), { 'budget.lowBalanceNotifiedAt': null }))
    await assertSucceeds(updateDoc(doc(withFactor('co'), 'agencies', 'dswd'), { 'budget.lowBalanceNotifiedAt': null }))
  })

  it('a staff member without one can still read their own profile (to set it up)', async () => {
    await assertSucceeds(getDoc(doc(passwordOnly('sw'), 'users', 'sw')))
  })

  it('patients are exempt', async () => {
    await assertSucceeds(getDoc(doc(passwordOnly('pat'), 'requests', 'r1')))
  })
})
