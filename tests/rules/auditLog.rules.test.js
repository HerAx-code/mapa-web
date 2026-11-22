import { loadRules } from './helpers/rules.js'
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
      rules: loadRules(),
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
async function seedUser(uid, role, agencyId = null, name = 'Test User') {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    // Phase 3 PR 3.5: the audit create rule pins actorName/actorRole to the
    // writer's profile, so the seeded profile carries the name the payload uses.
    await setDoc(doc(ctx.firestore(), 'users', uid), { role, agencyId, name })
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

// Phase 3 PR 3.5 (M11): the earlier rule pinned only actorId, so a patient
// could append an entry reading actorRole "Hospital Admin" / action
// "app_approved" against any case. These pin the actor to their own profile,
// bar patients, refuse server-only actions, and scope the case.
describe('auditLog.create — M11 forgery lockdown (PR 3.5)', () => {
  const H = 'hospital-1'
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      const put = (p, d) => setDoc(doc(db, ...p.split('/')), d)
      await Promise.all([
        put('users/superA', { role: 'super_admin', tenantId: H, name: 'Ana Admin', agencyId: null }),
        put('users/staffA', { role: 'staff_admin', tenantId: H, name: 'Ben Staff', agencyId: null }),
        put('users/coord', { role: 'agency', agencyId: 'dswd', name: 'Dee Coord' }),
        put('users/pat', { role: 'patient', name: 'Pat Ient', tenantId: H, tenantIds: [H] }),
        put('users/patElsewhere', { role: 'patient', name: 'Elsa', tenantId: 'bgh', tenantIds: ['bgh'] }),
        put('requests/rA', { patientId: 'pat', tenantId: H, agencyIds: ['dswd'] }),
        put('requests/rB', { patientId: 'patElsewhere', tenantId: 'bgh', agencyIds: [] }),
      ])
    })
  })
  const add = (uid, data) => addDoc(collection(testEnv.authenticatedContext(uid).firestore(), 'auditLog'), data)
  const base = (over) => ({ action: 'doc_verified', actorAgencyId: null, details: 'x', createdAt: serverTimestamp(), ...over })
  // A staff entry tagged with the writer's own hospital.
  const mine = (uid, name, role, over = {}) => base({ actorId: uid, actorName: name, actorRole: role, tenantId: H, ...over })

  it('a patient cannot write any audit entry — not even posing as an approving admin', async () => {
    await assertFails(add('pat', base({ actorId: 'pat', actorName: 'Pat Ient', actorRole: 'patient' })))
    await assertFails(add('pat', base({ actorId: 'pat', actorName: 'Hospital Admin', actorRole: 'super_admin', action: 'app_approved', tenantId: H })))
  })

  it('a staffer cannot forge another role or another name', async () => {
    await assertFails(add('staffA', mine('staffA', 'Ben Staff', 'super_admin')))   // not their role
    await assertFails(add('staffA', mine('staffA', 'Someone Else', 'staff_admin'))) // not their name
  })

  it('server-only actions are refused from a browser, even a super admin', async () => {
    for (const action of ['app_approved', 'request_endorsed', 'request_closed', 'gl_issued', 'account_erased', 'mfa_reset', 'assessment_amended', 'identity_flag_cleared', 'case_conversation_opened']) {
      await assertFails(add('superA', mine('superA', 'Ana Admin', 'super_admin', { action })))
    }
  })

  it("a staff entry must name the writer's own hospital's case and patient", async () => {
    await assertSucceeds(add('superA', mine('superA', 'Ana Admin', 'super_admin', { requestId: 'rA', patientId: 'pat' })))
    await assertFails(add('superA', mine('superA', 'Ana Admin', 'super_admin', { requestId: 'rB', patientId: 'patElsewhere' })))
    await assertFails(add('superA', mine('superA', 'Ana Admin', 'super_admin', { patientId: 'patElsewhere' }))) // patient at another hospital
  })

  it('an agency may write about a case it holds a slice in, not others', async () => {
    const ag = (over) => base({ actorId: 'coord', actorName: 'Dee Coord', actorRole: 'agency', actorAgencyId: 'dswd', action: 'docs_requested', ...over })
    await assertSucceeds(add('coord', ag({ requestId: 'rA' })))  // dswd ∈ rA.agencyIds
    await assertFails(add('coord', ag({ requestId: 'rB' })))     // not in rB.agencyIds
  })

  it('a kept staff entry (own identity, in-scope case) is still allowed', async () => {
    await assertSucceeds(add('staffA', mine('staffA', 'Ben Staff', 'staff_admin', { action: 'doc_verified', requestId: 'rA', patientId: 'pat' })))
    // An entry with no case at all (e.g. a settings change) is fine too.
    await assertSucceeds(add('superA', mine('superA', 'Ana Admin', 'super_admin', { action: 'hospital_updated' })))
  })
})

describe('auditLog.read — role scoping', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await addDoc(collection(ctx.firestore(), 'auditLog'), payload('user-alice', { actorAgencyId: 'malasakit', tenantId: 'hospital-1' }))
    })
  })

  // Multi-hospital Phase 5: a super_admin reads its own hospital's entries,
  // and must query by tenantId (rules are not filters).
  it("super_admin can read their hospital's entries", async () => {
    await seedUser('admin-1', 'super_admin')
    const ctx = testEnv.authenticatedContext('admin-1')
    const snap = await ctx.firestore().collection('auditLog').where('tenantId', '==', 'hospital-1').get()
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