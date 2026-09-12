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

// ── agenciesPublic projection — world-readable, client-write denied ───────
// Maintained only by the onAgencyWritten Cloud Function (Admin SDK, bypasses
// rules). No client — not even an admin — may write it directly.
describe('agenciesPublic — public read, no client write', () => {
  beforeEach(async () => {
    await seed('agenciesPublic', 'pcso', {
      name: 'PCSO', enabled: true, slots: { total: 10, remaining: 4 },
    })
  })

  it('allows an unauthenticated client to read the public projection (Landing)', async () => {
    const ctx = testEnv.unauthenticatedContext()
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'agenciesPublic', 'pcso')))
  })

  it('denies a client write, even authenticated', async () => {
    const ctx = testEnv.authenticatedContext('admin-uid')
    await assertFails(setDoc(
      doc(ctx.firestore(), 'agenciesPublic', 'pcso'),
      { name: 'PCSO', enabled: true, slots: { total: 10, remaining: 9 } },
    ))
  })

  it('the public projection carries no sensitive fields (documents the contract)', async () => {
    // Not a rules assertion — a guard that the seeded shape (mirroring the
    // function's projection) never includes budget/fundSource/contacts.
    const ctx = testEnv.unauthenticatedContext()
    const snap = await getDoc(doc(ctx.firestore(), 'agenciesPublic', 'pcso'))
    const data = snap.data()
    if (data.budget || data.fundSource || data.contact) {
      throw new Error('agenciesPublic must not carry sensitive fields')
    }
  })
})
