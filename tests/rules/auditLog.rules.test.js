import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

// Single shared test environment per file -- spinning one up per test
// adds ~2s overhead. Reset state between tests instead.
let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-auditlog',
    firestore: {
      rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
})

// Helper: seed a user doc via the admin-context (rules bypassed) so that
// our get(users/{uid}).data.role lookups in helper functions resolve.
async function seedUser(uid, role, agencyId = null) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { role, agencyId })
  })
}

function payload(actorId, overrides = {}) {
  return {
    action: 'doc_verified',
    actorId,
    actorName: 'Test User',
    actorRole: 'super_admin',
    actorAgencyId: null,
    targetType: 'document',
    targetId: 'doc-1',
    targetName: 'Barangay Cert',
    details: 'Verified',
    createdAt: serverTimestamp(),
    ...overrides,
  }
}

describe('auditLog.create — actorId enforcement (L13a)', () => {
  it('allows an authenticated user to write an entry attributed to themselves', async () => {
    await seedUser('user-alice', 'super_admin')
    const ctx = testEnv.authenticatedContext('user-alice')
    await assertSucceeds(addDoc(collection(ctx.firestore(), 'auditLog'), payload('user-alice')))
  })

  it("rejects an entry attributed to a different uid (the injection vector)", async () => {
    await seedUser('user-alice', 'patient')
    const ctx = testEnv.authenticatedContext('user-alice')
    await assertFails(addDoc(collection(ctx.firestore(), 'auditLog'), payload('user-bob')))
  })

  it("rejects an entry with actorId='system' (the pre-fix forgery shape)", async () => {
    await seedUser('user-alice', 'patient')
    const ctx = testEnv.authenticatedContext('user-alice')
    await assertFails(addDoc(collection(ctx.firestore(), 'auditLog'), payload('system')))
  })

  it('rejects writes from unauthenticated context', async () => {
    const ctx = testEnv.unauthenticatedContext()
    await assertFails(addDoc(collection(ctx.firestore(), 'auditLog'), payload('user-alice')))
  })
})

describe('auditLog.create — details size cap (L13a)', () => {
  it('accepts a normal-sized details string', async () => {
    await seedUser('user-alice', 'super_admin')
    const ctx = testEnv.authenticatedContext('user-alice')
    await assertSucceeds(addDoc(
      collection(ctx.firestore(), 'auditLog'),
      payload('user-alice', { details: 'a'.repeat(500) }),
    ))
  })

  it('rejects a payload right at the boundary + 1', async () => {
    await seedUser('user-alice', 'super_admin')
    const ctx = testEnv.authenticatedContext('user-alice')
    // 2001 chars: above the 2000-char cap from the rule.
    await assertFails(addDoc(
      collection(ctx.firestore(), 'auditLog'),
      payload('user-alice', { details: 'a'.repeat(2001) }),
    ))
  })

  it('accepts exactly 2000 chars (boundary inclusive)', async () => {
    await seedUser('user-alice', 'super_admin')
    const ctx = testEnv.authenticatedContext('user-alice')
    await assertSucceeds(addDoc(
      collection(ctx.firestore(), 'auditLog'),
      payload('user-alice', { details: 'a'.repeat(2000) }),
    ))
  })
})

describe('auditLog — immutability (L13a)', () => {
  it('rejects update of an existing entry, even by super_admin', async () => {
    await seedUser('user-alice', 'super_admin')
    // Seed an entry with rules bypassed
    let entryId
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const ref = await addDoc(collection(ctx.firestore(), 'auditLog'), payload('user-alice'))
      entryId = ref.id
    })
    const ctx = testEnv.authenticatedContext('user-alice')
    await assertFails(setDoc(doc(ctx.firestore(), 'auditLog', entryId), payload('user-alice', { details: 'tampered' })))
  })
})

describe('auditLog.read — role scoping', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await addDoc(collection(ctx.firestore(), 'auditLog'), payload('user-alice', { actorAgencyId: 'malasakit' }))
    })
  })

  it('super_admin can read any entry', async () => {
    await seedUser('admin-1', 'super_admin')
    const ctx = testEnv.authenticatedContext('admin-1')
    const snap = await ctx.firestore().collection('auditLog').get()
    expect(snap.size).toBeGreaterThan(0)
  })

  it("agency_admin can read entries for their own agency", async () => {
    await seedUser('agency-admin-1', 'agency_admin', 'malasakit')
    const ctx = testEnv.authenticatedContext('agency-admin-1')
    const snap = await ctx.firestore().collection('auditLog').where('actorAgencyId', '==', 'malasakit').get()
    expect(snap.size).toBeGreaterThan(0)
  })

  it("agency_admin cannot read entries for a different agency", async () => {
    await seedUser('agency-admin-2', 'agency_admin', 'pcso')
    const ctx = testEnv.authenticatedContext('agency-admin-2')
    await assertFails(ctx.firestore().collection('auditLog').where('actorAgencyId', '==', 'malasakit').get())
  })

  it('patient cannot read auditLog at all', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(ctx.firestore().collection('auditLog').get())
  })
})