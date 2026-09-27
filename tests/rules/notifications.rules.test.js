import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

let testEnv
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-notifications',
    firestore: { rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'), host: 'localhost', port: 8080 },
  })
})
afterAll(async () => testEnv?.cleanup())
beforeEach(async () => testEnv.clearFirestore())

async function seedUser(uid, role) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { role, agencyId: null })
  })
}
const notif = (fromUid) => ({ type: 'app_submitted', title: 'Hi', body: 'Test', read: false, fromUid, createdAt: serverTimestamp() })
const items = (fs, targetUid) => collection(fs, 'notifications', targetUid, 'items')

// Abuse hardening #1: a PATIENT may only create a notification addressed to
// themselves. Staff/agency keep cross-user create (used across the app).
describe('notifications.create — patients cannot notify others', () => {
  it('rejects a patient writing into a staff feed (the spam/phishing vector)', async () => {
    await seedUser('patient-1', 'patient')
    await seedUser('admin-1', 'super_admin')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(items(ctx.firestore(), 'admin-1'), notif('patient-1')))
  })

  it('allows a patient to notify themselves', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(addDoc(items(ctx.firestore(), 'patient-1'), notif('patient-1')))
  })

  it('still allows an admin to notify a patient', async () => {
    await seedUser('admin-1', 'super_admin')
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('admin-1')
    await assertSucceeds(addDoc(items(ctx.firestore(), 'patient-1'), notif('admin-1')))
  })

  it('still requires truthful fromUid attribution', async () => {
    await seedUser('admin-1', 'super_admin')
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('admin-1')
    // fromUid spoofed as the patient → denied regardless of role.
    await assertFails(addDoc(items(ctx.firestore(), 'patient-1'), notif('patient-1')))
  })
})
