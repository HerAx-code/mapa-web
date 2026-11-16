import { loadRules } from './helpers/rules.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc } from 'firebase/firestore'

// Phase 3B (2026-11-16): sex (for the DOH monthly report) — female or male,
// filled in once by the patient; hospital staff can correct it.
const A = 'hospital-1'
let testEnv
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-patient-sex',
    firestore: { rules: loadRules(), host: 'localhost', port: 8080 },
  })
})
afterAll(async () => testEnv?.cleanup())
beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', 'old'), { role: 'patient', agencyId: null, rank: null, active: true, name: 'Old', tenantId: A, tenantIds: [A] })
    await setDoc(doc(db, 'users', 'set'), { role: 'patient', agencyId: null, rank: null, active: true, name: 'Set', tenantId: A, tenantIds: [A], sex: 'female', birthdate: '1990-01-01' })
    await setDoc(doc(db, 'users', 'staffA'), { role: 'staff_admin', tenantId: A })
  })
})
const as = (uid) => testEnv.authenticatedContext(uid).firestore()

describe('patient sex', () => {
  it('an older account fills in sex and birthdate once', async () => {
    await assertSucceeds(updateDoc(doc(as('old'), 'users', 'old'), { sex: 'male', birthdate: '1985-03-02' }))
  })
  it('only female or male', async () => {
    await assertFails(updateDoc(doc(as('old'), 'users', 'old'), { sex: 'x' }))
  })
  it('once set, the patient cannot change it; staff can correct it', async () => {
    await assertFails(updateDoc(doc(as('set'), 'users', 'set'), { sex: 'male' }))
    await assertSucceeds(updateDoc(doc(as('staffA'), 'users', 'set'), { sex: 'male' }))
  })
  it('sign-up accepts only a valid sex', async () => {
    await assertFails(setDoc(doc(as('newbie'), 'users', 'newbie'), { role: 'patient', name: 'N', sex: 'unknown' }))
    await assertSucceeds(setDoc(doc(as('newbie'), 'users', 'newbie'), { role: 'patient', name: 'N', sex: 'female' }))
  })
})
