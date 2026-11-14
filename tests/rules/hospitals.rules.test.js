import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

// Multi-hospital Phase 1 — hospitals/{id} (docs/multi-hospital-network-plan.md).
let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-hospitals',
    firestore: {
      rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  })
})

afterAll(async () => testEnv?.cleanup())
beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', 'super-1'),   { role: 'super_admin' })
    await setDoc(doc(db, 'users', 'staff-1'),   { role: 'staff_admin' })
    await setDoc(doc(db, 'users', 'agency-1'),  { role: 'agency', agencyId: 'dswd' })
    await setDoc(doc(db, 'users', 'patient-1'), { role: 'patient' })
    await setDoc(doc(db, 'hospitals', 'hospital-1'), { gatewayName: 'Medical Social Services', enabled: true })
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const hospital1 = (db) => doc(db, 'hospitals', 'hospital-1')

describe('hospitals — read', () => {
  it.each(['super-1', 'staff-1', 'agency-1', 'patient-1'])('signed-in %s can read', async (uid) => {
    await assertSucceeds(getDoc(hospital1(as(uid))))
  })

  it('signed-out visitors cannot read', async () => {
    await assertFails(getDoc(hospital1(testEnv.unauthenticatedContext().firestore())))
  })
})

describe('hospitals — write', () => {
  it("super_admin can update their own hospital's doc with allowed keys", async () => {
    await assertSucceeds(updateDoc(hospital1(as('super-1')), { contactEmail: 'mss@example.org' }))
  })

  // Phase 5: a hospital super_admin is scoped to its own hospital (super-1 has
  // no tenantId, so it is hospital #1). Creating other hospitals is the
  // platform_admin's job (Phase 6).
  it('super_admin cannot create or edit another hospital', async () => {
    const db = as('super-1')
    await assertFails(setDoc(doc(db, 'hospitals', 'hospital-2'), { gatewayName: 'MSS', facilityName: 'BGH', enabled: true }))
  })

  it('super_admin cannot add keys outside the allowlist', async () => {
    await assertFails(updateDoc(hospital1(as('super-1')), { patientList: ['x'] }))
  })

  it('super_admin cannot delete a hospital', async () => {
    await assertFails(deleteDoc(hospital1(as('super-1'))))
  })

  it.each(['staff-1', 'agency-1', 'patient-1'])('%s cannot write', async (uid) => {
    await assertFails(updateDoc(hospital1(as(uid)), { gatewayName: 'Hijacked' }))
    await assertFails(setDoc(doc(as(uid), 'hospitals', 'hospital-x'), { gatewayName: 'X' }))
  })
})
