import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDocs, collection, query, where } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

// A hospital admin's Access Codes page lists ONLY its own hospital's codes —
// an unfiltered listing (which would mix in another hospital's codes and skew
// the next code number) must be refused.
let testEnv
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-codelisting',
    firestore: { rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'), host: 'localhost', port: 8080 },
  })
})
afterAll(async () => testEnv?.cleanup())
beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'hospitals', 'crmco'), { accessCodePrefix: 'CRMCO', enabled: true })
    await setDoc(doc(db, 'hospitals', 'cpc'), { accessCodePrefix: 'CPCGHFI', enabled: true })
    await setDoc(doc(db, 'users', 'adminCRMCO'), { role: 'super_admin', tenantId: 'crmco' })
    await setDoc(doc(db, 'hospitalIds', 'CRMCO-2026-00001'), { status: 'available', patId: null, tenantId: 'crmco' })
    await setDoc(doc(db, 'hospitalIds', 'CPCGHFI-2026-00010'), { status: 'available', patId: null, tenantId: 'cpc' })
  })
})

describe('Access Codes listing is per hospital', () => {
  it('own-hospital listing works; an unfiltered listing is refused', async () => {
    const db = testEnv.authenticatedContext('adminCRMCO').firestore()
    await assertSucceeds(getDocs(query(collection(db, 'hospitalIds'), where('tenantId', '==', 'crmco'))))
    await assertFails(getDocs(collection(db, 'hospitalIds')))
    await assertFails(getDocs(query(collection(db, 'hospitalIds'), where('tenantId', '==', 'cpc'))))
  })
})
