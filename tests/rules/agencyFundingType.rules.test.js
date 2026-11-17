import { loadRules } from './helpers/rules.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc } from 'firebase/firestore'

// Funder type (2026-11-17): only the Super Admin sets agencies.fundingType,
// and only to one of the listed values.
let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-funding-type',
    firestore: { rules: loadRules(), host: 'localhost', port: 8080 },
  })
})
afterAll(async () => testEnv?.cleanup())

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await Promise.all([
      setDoc(doc(db, 'users/plat'), { role: 'platform_admin' }),
      setDoc(doc(db, 'users/aadmin'), { role: 'agency_admin', agencyId: 'ag1' }),
      setDoc(doc(db, 'users/coord'), { role: 'agency', agencyId: 'ag1' }),
      setDoc(doc(db, 'agencies/ag1'), { name: 'Fund', enabled: true, partnerHospitalIds: ['h1'], budget: { allocated: 0 }, slots: { total: 5, remaining: 5 } }),
    ])
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()

describe('agencies.fundingType', () => {
  it('the Super Admin sets a listed type, or clears it', async () => {
    await assertSucceeds(updateDoc(doc(as('plat'), 'agencies/ag1'), { fundingType: 'private' }))
    await assertSucceeds(updateDoc(doc(as('plat'), 'agencies/ag1'), { fundingType: null }))
    await assertSucceeds(setDoc(doc(as('plat'), 'agencies/ag2'), { name: 'New', fundingType: 'national_program' }))
  })
  it('refuses unlisted values', async () => {
    await assertFails(updateDoc(doc(as('plat'), 'agencies/ag1'), { fundingType: 'government' }))
    await assertFails(setDoc(doc(as('plat'), 'agencies/ag3'), { name: 'New', fundingType: 'ngo' }))
  })
  it('agency staff cannot change it, but the Agency Admin still edits other fields', async () => {
    await assertFails(updateDoc(doc(as('aadmin'), 'agencies/ag1'), { fundingType: 'national_program' }))
    await assertFails(updateDoc(doc(as('coord'), 'agencies/ag1'), { fundingType: 'private' }))
    await assertSucceeds(updateDoc(doc(as('aadmin'), 'agencies/ag1'), { description: 'Updated profile' }))
  })
})
