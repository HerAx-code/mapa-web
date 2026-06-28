import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-hospitalids',
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

async function seedHospitalId(id, overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'hospitalIds', id), {
      status: 'available',
      patId: null,
      ...overrides,
    })
  })
}

async function seedPrivateInfo(hospitalId, usedById, usedBy = 'Maria Santos') {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'hospitalIds', hospitalId, 'privateInfo', 'details'),
      { usedBy, usedById, createdAt: 'whenever' },
    )
  })
}

// ── Phase 0.3 — hospitalIds parent stays public for registration ───────
// The parent doc retains allow get: if true so registration verification
// can happen before sign-in. Tests pin that behavior so a future
// "let's just close it" change doesn't break the registration flow.
describe('hospitalIds parent — public get preserved (Phase 0.3)', () => {
  it('allows an unauthenticated client to GET the parent doc', async () => {
    await seedHospitalId('CRMC-2026-00001')
    const ctx = testEnv.unauthenticatedContext()
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'hospitalIds', 'CRMC-2026-00001')))
  })

  it('rejects an unauthenticated client from LISTING the collection', async () => {
    // get is allowed; list requires auth. Together they let registration
    // verify a specific code without exposing a scrapable enumeration
    // endpoint.
    const ctx = testEnv.unauthenticatedContext()
    // assertFails on a list intentionally: rules deny the broader scope.
    await assertFails(
      ctx.firestore().collection('hospitalIds').get()
    )
  })
})

// ── Phase 0.3 — privateInfo PII sub-collection ─────────────────────────
// The patient NAME (`usedBy`) used to live on the parent doc, leaking
// to anyone who iterated the access-code range. Moved to this auth-
// gated sub-collection. These tests pin the rule contract:
//   - admin: read all
//   - claimant patient: read own (parent.patId == uid())
//   - any other auth user (incl. agencies): denied
//   - unauthenticated: denied
describe('hospitalIds/{id}/privateInfo/{infoId} — Phase 0.3 PII gate', () => {
  beforeEach(async () => {
    await seedHospitalId('CRMC-2026-00042', { status: 'used', patId: 'patient-1' })
    await seedPrivateInfo('CRMC-2026-00042', 'patient-1', 'Maria Santos')
  })

  it('REGRESSION GUARD: rejects unauthenticated read (the original enumeration leak)', async () => {
    const ctx = testEnv.unauthenticatedContext()
    await assertFails(getDoc(doc(
      ctx.firestore(), 'hospitalIds', 'CRMC-2026-00042', 'privateInfo', 'details',
    )))
  })

  it('allows the claimant patient to read their own privateInfo', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(getDoc(doc(
      ctx.firestore(), 'hospitalIds', 'CRMC-2026-00042', 'privateInfo', 'details',
    )))
  })

  it('allows an admin to read any privateInfo', async () => {
    await seedUser('admin-1', 'super_admin')
    const ctx = testEnv.authenticatedContext('admin-1')
    await assertSucceeds(getDoc(doc(
      ctx.firestore(), 'hospitalIds', 'CRMC-2026-00042', 'privateInfo', 'details',
    )))
  })

  it('REGRESSION GUARD: rejects an agency coordinator from reading privateInfo', async () => {
    // Coordinators get patient names through users/{uid}, not through
    // this collection. Closing that path means an agency rogue can't
    // pivot from "I know a code is claimed" to "I know who claimed it."
    await seedUser('coord-1', 'agency', 'malasakit')
    const ctx = testEnv.authenticatedContext('coord-1')
    await assertFails(getDoc(doc(
      ctx.firestore(), 'hospitalIds', 'CRMC-2026-00042', 'privateInfo', 'details',
    )))
  })

  it('rejects a different patient from reading another patient\'s privateInfo', async () => {
    await seedUser('patient-1', 'patient')
    await seedUser('patient-2', 'patient')
    const ctx = testEnv.authenticatedContext('patient-2')
    await assertFails(getDoc(doc(
      ctx.firestore(), 'hospitalIds', 'CRMC-2026-00042', 'privateInfo', 'details',
    )))
  })

  // Create is the claim-transaction path. The rule requires the writer
  // to self-attribute via usedById and bounds usedBy at 120 chars.
  describe('create (claim transaction)', () => {
    beforeEach(async () => {
      // Different parent so the create test isn't blocked by an
      // existing sub-doc from the read tests' beforeEach.
      await seedHospitalId('CRMC-2026-00099', { status: 'used', patId: 'new-patient' })
    })

    it('allows the claimant to create their own privateInfo', async () => {
      await seedUser('new-patient', 'patient')
      const ctx = testEnv.authenticatedContext('new-patient')
      await assertSucceeds(setDoc(
        doc(ctx.firestore(), 'hospitalIds', 'CRMC-2026-00099', 'privateInfo', 'details'),
        { usedBy: 'Juan Dela Cruz', usedById: 'new-patient', createdAt: 'whenever' },
      ))
    })

    it("REGRESSION GUARD: rejects creating privateInfo with someone else's usedById", async () => {
      // Self-attribution requirement prevents a malicious user from
      // writing a name + foreign uid combination.
      await seedUser('attacker', 'patient')
      const ctx = testEnv.authenticatedContext('attacker')
      await assertFails(setDoc(
        doc(ctx.firestore(), 'hospitalIds', 'CRMC-2026-00099', 'privateInfo', 'details'),
        { usedBy: 'Fake Name', usedById: 'someone-else', createdAt: 'whenever' },
      ))
    })

    it('rejects oversize usedBy (> 120 chars) on create', async () => {
      await seedUser('new-patient', 'patient')
      const ctx = testEnv.authenticatedContext('new-patient')
      await assertFails(setDoc(
        doc(ctx.firestore(), 'hospitalIds', 'CRMC-2026-00099', 'privateInfo', 'details'),
        { usedBy: 'A'.repeat(121), usedById: 'new-patient', createdAt: 'whenever' },
      ))
    })
  })
})
