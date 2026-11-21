import { loadRules } from './helpers/rules.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-agencies',
    firestore: {
      rules: loadRules(),
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

// ── agenciesPublic projection — world-readable, function-only write ───────
// Phase 1 (N10, 2026-11-21): the onAgencyWritten / resyncAgenciesPublic Cloud
// Functions are the only writers (Admin SDK, rules don't apply to them). No
// browser — not even the Super Admin — writes or deletes the listing, and
// patients read it instead of the full agencies record.
describe('agenciesPublic — public read, no browser writes', () => {
  const VALID = { name: 'PCSO', initials: 'PC', color: 'bg-red-600', location: 'CRMC', enabled: true, slots: { total: 10, remaining: 9 } }

  beforeEach(async () => {
    await seed('agencies', 'pcso', { name: 'PCSO', enabled: true, slots: { total: 10, remaining: 4 }, budget: { allocated: 500000 } })
    await seed('agenciesPublic', 'pcso', { name: 'PCSO', enabled: true, slots: { total: 10, remaining: 4 } })
    await seed('users', 'admin-uid',    { role: 'super_admin' })
    await seed('users', 'aadmin-pcso',  { role: 'agency_admin', agencyId: 'pcso' })
    await seed('users', 'plat-uid',     { role: 'platform_admin' })
    await seed('users', 'patient-uid',  { role: 'patient' })
  })

  it('anyone reads the public listing, signed in or not (Landing, patients)', async () => {
    await assertSucceeds(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'agenciesPublic', 'pcso')))
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('patient-uid').firestore(), 'agenciesPublic', 'pcso')))
  })

  it('no browser writes or deletes it, whatever the role', async () => {
    for (const uid of ['admin-uid', 'aadmin-pcso', 'plat-uid', 'patient-uid']) {
      const db = testEnv.authenticatedContext(uid).firestore()
      await assertFails(setDoc(doc(db, 'agenciesPublic', 'pcso'), VALID))
      await assertFails(deleteDoc(doc(db, 'agenciesPublic', 'pcso')))
    }
    await assertFails(setDoc(doc(testEnv.unauthenticatedContext().firestore(), 'agenciesPublic', 'pcso'), VALID))
  })

  it('a patient cannot read the full agency record (budget, caps, contacts)', async () => {
    await assertFails(getDoc(doc(testEnv.authenticatedContext('patient-uid').firestore(), 'agencies', 'pcso')))
  })

  it('staff, agency users and a signed-in account without a profile still read it', async () => {
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('admin-uid').firestore(), 'agencies', 'pcso')))
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('aadmin-pcso').firestore(), 'agencies', 'pcso')))
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('anon-signup').firestore(), 'agencies', 'pcso')))
  })
})
