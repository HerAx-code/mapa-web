import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-agencies',
    firestore: {
      rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  })
})

afterAll(async () => testEnv?.cleanup())
beforeEach(async () => testEnv.clearFirestore())

async function seed(collectionPath, id, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collectionPath, id), data)
  })
}

// ── agencies parent — now auth-gated (SEC-3) ──────────────────────────────
// The rich agency doc carries budget / fundSource / contacts, so it must not
// be world-readable. Previously `allow read: if true`; now `if isAuth()`.
describe('agencies — read requires auth (SEC-3 closed)', () => {
  beforeEach(async () => {
    await seed('agencies', 'pcso', {
      name: 'PCSO', enabled: true,
      slots: { total: 10, remaining: 4 },
      budget: { allocated: 500000, committed: 120000, disbursed: 30000 },
      fundSource: 'PCSO Resolution #2026-15',
    })
  })

  it('DENIES an unauthenticated client from reading the rich agency doc', async () => {
    const ctx = testEnv.unauthenticatedContext()
    await assertFails(getDoc(doc(ctx.firestore(), 'agencies', 'pcso')))
  })

  it('allows an authenticated client to read the agency doc', async () => {
    const ctx = testEnv.authenticatedContext('some-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'agencies', 'pcso')))
  })
})

// ── agenciesPublic projection — world-readable, privileged client-write ───
// The onAgencyWritten Cloud Function is the authoritative writer, but it is NOT
// deployed on the live project, so the client mirrors this projection from the
// agency-write paths (src/utils/agenciesPublic.js). Writes are therefore
// allowed for the exact principals who may edit the source agencies/{id} doc
// (CRMC admin, or any agency role on its OWN agency) — but ONLY the projected
// fields (name/initials/color/location/enabled/slots), so it can never become a
// budget/contact leak.
describe('agenciesPublic — public read, field-pinned privileged write', () => {
  const VALID = { name: 'PCSO', initials: 'PC', color: 'bg-red-600', location: 'CRMC', enabled: true, slots: { total: 10, remaining: 9 } }

  beforeEach(async () => {
    await seed('agenciesPublic', 'pcso', {
      name: 'PCSO', enabled: true, slots: { total: 10, remaining: 4 },
    })
    // Role/agency bindings the rules read via userRole() / userAgencyId().
    await seed('users', 'admin-uid',    { role: 'super_admin' })
    await seed('users', 'aadmin-pcso',  { role: 'agency_admin', agencyId: 'pcso' })
    await seed('users', 'coord-other',  { role: 'agency',       agencyId: 'dswd' })
    await seed('users', 'patient-uid',  { role: 'patient' })
  })

  it('allows an unauthenticated client to read the public projection (Landing)', async () => {
    const ctx = testEnv.unauthenticatedContext()
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'agenciesPublic', 'pcso')))
  })

  it('denies an unauthenticated write', async () => {
    const ctx = testEnv.unauthenticatedContext()
    await assertFails(setDoc(doc(ctx.firestore(), 'agenciesPublic', 'pcso'), VALID))
  })

  it('denies a non-privileged authenticated write (patient)', async () => {
    const ctx = testEnv.authenticatedContext('patient-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'agenciesPublic', 'pcso'), VALID))
  })

  it('allows a CRMC admin to write the projection (valid shape)', async () => {
    const ctx = testEnv.authenticatedContext('admin-uid')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'agenciesPublic', 'pcso'), VALID))
  })

  it('allows an agency_admin to write its OWN agency projection', async () => {
    const ctx = testEnv.authenticatedContext('aadmin-pcso')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'agenciesPublic', 'pcso'), VALID))
  })

  it("denies an agency coordinator writing a DIFFERENT agency's projection", async () => {
    const ctx = testEnv.authenticatedContext('coord-other') // bound to 'dswd'
    await assertFails(setDoc(doc(ctx.firestore(), 'agenciesPublic', 'pcso'), VALID))
  })

  it('denies an admin write that smuggles a non-projected field (budget leak guard)', async () => {
    const ctx = testEnv.authenticatedContext('admin-uid')
    await assertFails(setDoc(
      doc(ctx.firestore(), 'agenciesPublic', 'pcso'),
      { ...VALID, budget: { allocated: 999999 } },
    ))
  })

  it('denies an admin write whose slots carry an extra key', async () => {
    const ctx = testEnv.authenticatedContext('admin-uid')
    await assertFails(setDoc(
      doc(ctx.firestore(), 'agenciesPublic', 'pcso'),
      { ...VALID, slots: { total: 10, remaining: 9, secret: 1 } },
    ))
  })
})
