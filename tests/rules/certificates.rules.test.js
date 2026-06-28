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
// Phase 0.4 hardening: also requires the LINKED application's agencyId
// to match -- so seed the application before each create test.
describe('certificates.create — cross-agency guard', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'applications', 'app-1'), {
        agencyId: 'malasakit',
        patientId: 'patient-1',
        status: 'approved',
      })
    })
  })

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
    // Admin uses a fresh appId to avoid the parent-application agencyId
    // mismatch from interfering -- admins skip the get() chain anyway.
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'certificates', 'app-1'), {
      appId: 'app-1',
      agencyId: 'pcso',  // admin can attribute to a different agency
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

  // Post-review hotfix (commit 79f51e3): coordinators must be allowed to
  // mutate budget.committed and budget.disbursed -- the GL expiry sweep
  // and approval transactions on the agency dashboard do exactly that.
  // The pre-hotfix rule blocked all budget changes by coordinators and
  // broke the dashboard load. The new rule pins only `allocated` and
  // `fundSource` (the inflation-attack surface).
  it('allows coordinator to mutate budget.committed (GL expiry sweep)', async () => {
    await seedUser('coord-1', 'agency', 'malasakit')
    const ctx = testEnv.authenticatedContext('coord-1')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'agencies', 'malasakit'), {
      name: 'Malasakit Center',
      // allocated unchanged; committed decremented (sweep released funds)
      budget: { allocated: 100_000, committed: -50_000, disbursed: 0 },
    }))
  })

  it('allows coordinator to mutate budget.disbursed (approval flow)', async () => {
    await seedUser('coord-1', 'agency', 'malasakit')
    const ctx = testEnv.authenticatedContext('coord-1')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'agencies', 'malasakit'), {
      name: 'Malasakit Center',
      budget: { allocated: 100_000, committed: 0, disbursed: 50_000 },
    }))
  })

  it('REGRESSION GUARD: still rejects coordinator from mutating budget.fundSource', async () => {
    // fundSource identifies WHERE the money comes from; should be
    // agency_admin-only just like allocated. Today's hotfix carved out
    // committed/disbursed; this test pins the closure.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'agencies', 'malasakit'), {
        name: 'Malasakit Center',
        budget: { allocated: 100_000, committed: 0, disbursed: 0, fundSource: 'Original Source' },
      })
    })
    await seedUser('coord-1', 'agency', 'malasakit')
    const ctx = testEnv.authenticatedContext('coord-1')
    await assertFails(setDoc(doc(ctx.firestore(), 'agencies', 'malasakit'), {
      name: 'Malasakit Center',
      budget: { allocated: 100_000, committed: 0, disbursed: 0, fundSource: 'Changed By Coord' },
    }))
  })
})

// Phase 0.4 forge-protection: certificate create must validate against
// the LINKED application's agencyId via a get() chain. Without this,
// a coordinator at A could create a certificate that claims agencyId=A
// but pointed certId (= appId) at an application owned by agency B.
describe('certificates.create — Phase 0.4 appId cross-check', () => {
  beforeEach(async () => {
    // Seed two applications under different agencies. certId === appId
    // by convention (see src/pages/admin/Patients.jsx:334).
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'applications', 'app-mal'), {
        agencyId: 'malasakit',
        patientId: 'patient-1',
        status: 'approved',
      })
      await setDoc(doc(ctx.firestore(), 'applications', 'app-dswd'), {
        agencyId: 'dswd',
        patientId: 'patient-2',
        status: 'approved',
      })
    })
  })

  it('allows a coordinator to create a cert for an application owned by their own agency', async () => {
    await seedUser('coord-mal', 'agency', 'malasakit')
    const ctx = testEnv.authenticatedContext('coord-mal')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'certificates', 'app-mal'), {
      appId: 'app-mal',
      agencyId: 'malasakit',
      patientId: 'patient-1',
      base64: 'data:image/jpeg;base64,...',
      contentType: 'image/jpeg',
      fileName: 'gl.jpg',
    }))
  })

  it("REGRESSION GUARD: rejects a coordinator from creating a cert for another agency's application", async () => {
    // Pre-Phase 0.4 this would have SUCCEEDED -- the create rule only
    // checked request.resource.data.agencyId == userAgencyId(), so a
    // Malasakit coord could write agencyId=malasakit but certId=app-dswd
    // and silently steal another agency's GL slot.
    await seedUser('coord-mal', 'agency', 'malasakit')
    const ctx = testEnv.authenticatedContext('coord-mal')
    await assertFails(setDoc(doc(ctx.firestore(), 'certificates', 'app-dswd'), {
      appId: 'app-dswd',
      agencyId: 'malasakit',  // forged
      patientId: 'patient-2',
      base64: 'data:image/jpeg;base64,...',
      contentType: 'image/jpeg',
      fileName: 'gl.jpg',
    }))
  })

  it('admin can still write certs for any application (cross-agency remediation)', async () => {
    await seedUser('admin-1', 'super_admin')
    const ctx = testEnv.authenticatedContext('admin-1')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'certificates', 'app-mal'), {
      appId: 'app-mal',
      agencyId: 'malasakit',
      patientId: 'patient-1',
      base64: 'data:image/jpeg;base64,...',
      contentType: 'image/jpeg',
      fileName: 'gl.jpg',
    }))
  })
})