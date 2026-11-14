import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, FieldPath } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

// Per-hospital agency slots (owner decision 2026-11-14): the agency admin sets
// each partner hospital's daily count; a hospital's endorsement uses ONLY its
// own share and never changes a total.
let testEnv
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-hospitalslots',
    firestore: { rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'), host: 'localhost', port: 8080 },
  })
})
afterAll(async () => testEnv?.cleanup())
beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', 'adminA'), { role: 'super_admin', tenantId: 'hospA' })
    await setDoc(doc(db, 'users', 'agAdmin'), { role: 'agency_admin', agencyId: 'dswd' })
    await setDoc(doc(db, 'agencies', 'dswd'), {
      name: 'DSWD', partnerHospitalIds: ['hospA', 'hospB'], slots: { total: 10, remaining: 10 },
      hospitalSlots: { hospA: { total: 5, remaining: 5 }, hospB: { total: 3, remaining: 3 } },
      budget: { allocated: 0, committed: 0 },
    })
  })
})
const ref = (uid) => doc(testEnv.authenticatedContext(uid).firestore(), 'agencies', 'dswd')

describe('per-hospital slots', () => {
  it("a hospital uses its own hospital's slots", async () => {
    await assertSucceeds(updateDoc(ref('adminA'), new FieldPath('hospitalSlots', 'hospA', 'remaining'), 4))
  })

  it("a hospital can't use another hospital's slots or change a total", async () => {
    await assertFails(updateDoc(ref('adminA'), new FieldPath('hospitalSlots', 'hospB', 'remaining'), 2))
    await assertFails(updateDoc(ref('adminA'), new FieldPath('hospitalSlots', 'hospA', 'total'), 50))
  })

  it('the agency admin sets each hospital’s daily count', async () => {
    await assertSucceeds(updateDoc(ref('agAdmin'), new FieldPath('hospitalSlots', 'hospB', 'total'), 8))
  })
})
