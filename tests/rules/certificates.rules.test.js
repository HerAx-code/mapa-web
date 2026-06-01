import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, collection, addDoc } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-certificates',
    firestore: {
      rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  })
})

afterAll(async () => testEnv?.cleanup())
beforeEach(async () => testEnv.clearFirestore())

async function seedUser(uid, role, agencyId = null) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { role, agencyId })
  })
}

// certificates.create from security pass 3 (commit 9a596d4): when isAgency
// (not admin), the agency must be writing to their own agencyId.
describe('certificates.create — cross-agency guard', () => {
  it('allows an agency to upload a cert scoped to their own agencyId', async () => {
    await seedUser('agency-coord-1', 'agency', 'malasakit')
    const ctx = testEnv.authenticatedContext('agency-coord-1')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'certificates', 'app-1'), {
      appId: 'app-1',
      agencyId: 'malasakit',
      patientId: 'patient-1',
      base64: 'data:image/jpeg;base64,...',
      contentType: 'image/jpeg',
      fileName: 'gl.jpg',
    }))
  })

  it('rejects an agency uploading a cert attributed to a different agency', async () => {
    await seedUser('agency-coord-1', 'agency', 'malasakit')
    const ctx = testEnv.authenticatedContext('agency-coord-1')
    await assertFails(setDoc(doc(ctx.firestore(), 'certificates', 'app-1'), {
      appId: 'app-1',
      agencyId: 'pcso',
      patientId: 'patient-1',
      base64: 'data:image/jpeg;base64,...',
      contentType: 'image/jpeg',
      fileName: 'gl.jpg',
    }))
  })

  it('allows an admin to upload a cert under any agencyId (cross-agency remediation)', async () => {
    await seedUser('admin-1', 'super_admin')
    const ctx = testEnv.authenticatedContext('admin-1')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'certificates', 'app-1'), {
      appId: 'app-1',
      agencyId: 'pcso',
      patientId: 'patient-1',
      base64: 'data:image/jpeg;base64,...',
      contentType: 'image/jpeg',
      fileName: 'gl.jpg',
    }))
  })

  it('rejects a patient from writing certificates', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(setDoc(doc(ctx.firestore(), 'certificates', 'app-1'), {
      appId: 'app-1',
      agencyId: 'malasakit',
      patientId: 'patient-1',
      base64: 'data:image/jpeg;base64,...',
      contentType: 'image/jpeg',
      fileName: 'gl.jpg',
    }))
  })
})

// agencies.update from item 6 (commit 608738b): coordinator (role='agency',
// not 'agency_admin') cannot mutate budget fields.
describe('agencies.update — coordinator budget guard', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'agencies', 'malasakit'), {
        name: 'Malasakit Center',
        budget: { allocated: 100_000, committed: 0, disbursed: 0 },
      })
    })
  })

  it('allows agency_admin to mutate budget fields', async () => {
    await seedUser('admin-1', 'agency_admin', 'malasakit')
    const ctx = testEnv.authenticatedContext('admin-1')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'agencies', 'malasakit'), {
      name: 'Malasakit Center',
      budget: { allocated: 200_000, committed: 0, disbursed: 0 },
    }))
  })

  it('rejects coordinator from mutating budget.allocated', async () => {
    await seedUser('coord-1', 'agency', 'malasakit')
    const ctx = testEnv.authenticatedContext('coord-1')
    await assertFails(setDoc(doc(ctx.firestore(), 'agencies', 'malasakit'), {
      name: 'Malasakit Center',
      // Coordinator cannot inflate the budget through the SDK.
      budget: { allocated: 999_999_999, committed: 0, disbursed: 0 },
    }))
  })

  it('allows coordinator to update non-budget fields as long as budget round-trips byte-identical', async () => {
    await seedUser('coord-1', 'agency', 'malasakit')
    const ctx = testEnv.authenticatedContext('coord-1')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'agencies', 'malasakit'), {
      name: 'Malasakit Center (updated description)',
      budget: { allocated: 100_000, committed: 0, disbursed: 0 },  // unchanged
    }))
  })

  it("rejects a different agency's coordinator entirely (cross-agency)", async () => {
    await seedUser('coord-pcso', 'agency', 'pcso')
    const ctx = testEnv.authenticatedContext('coord-pcso')
    await assertFails(setDoc(doc(ctx.firestore(), 'agencies', 'malasakit'), {
      name: 'Hijacked',
      budget: { allocated: 100_000, committed: 0, disbursed: 0 },
    }))
  })
})