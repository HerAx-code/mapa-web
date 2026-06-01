import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-users',
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

// users.create from Item 1 seed refactor: only patient self-create OR
// admin / agency_admin elevated create. Closes the documented residual
// where any authenticated user could write /users/{X} with any role.
describe('users.create — patient self-create only with role=patient', () => {
  it('allows a patient self-create with role=patient', async () => {
    const ctx = testEnv.authenticatedContext('new-user-1')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'users', 'new-user-1'), {
      role: 'patient',
      agencyId: null,
      name: 'Juan Dela Cruz',
      email: 'juan@example.com',
    }))
  })

  it("rejects a self-create with role='super_admin' (the privilege-escalation vector)", async () => {
    const ctx = testEnv.authenticatedContext('attacker-1')
    await assertFails(setDoc(doc(ctx.firestore(), 'users', 'attacker-1'), {
      role: 'super_admin',
      agencyId: null,
      name: 'Pwned',
      email: 'pwn@example.com',
    }))
  })

  it("rejects a self-create with role='agency_admin'", async () => {
    const ctx = testEnv.authenticatedContext('attacker-1')
    await assertFails(setDoc(doc(ctx.firestore(), 'users', 'attacker-1'), {
      role: 'agency_admin',
      agencyId: 'malasakit',
      name: 'Pwned',
    }))
  })

  it("rejects writing another user's doc (no cross-user pre-creation)", async () => {
    const ctx = testEnv.authenticatedContext('attacker-1')
    await assertFails(setDoc(doc(ctx.firestore(), 'users', 'victim-1'), {
      role: 'patient',
      agencyId: null,
      name: 'Forged',
    }))
  })
})

describe('users.create — admin-elevated create', () => {
  it('allows a super_admin to create any user with any role', async () => {
    await seedUser('admin-1', 'super_admin')
    const ctx = testEnv.authenticatedContext('admin-1')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'users', 'new-staff-1'), {
      role: 'staff_admin',
      agencyId: null,
      name: 'New Staff',
    }))
  })

  it('allows a super_admin to create an agency coordinator', async () => {
    await seedUser('admin-1', 'super_admin')
    const ctx = testEnv.authenticatedContext('admin-1')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'users', 'new-coord-1'), {
      role: 'agency',
      agencyId: 'malasakit',
      name: 'New Coordinator',
    }))
  })

  it('allows an agency_admin to create a coordinator within their own agency', async () => {
    await seedUser('agency-admin-1', 'agency_admin', 'malasakit')
    const ctx = testEnv.authenticatedContext('agency-admin-1')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'users', 'new-coord-malasakit'), {
      role: 'agency',
      agencyId: 'malasakit',
      name: 'New Coordinator',
    }))
  })

  it("rejects an agency_admin creating a coordinator in another agency", async () => {
    await seedUser('agency-admin-1', 'agency_admin', 'malasakit')
    const ctx = testEnv.authenticatedContext('agency-admin-1')
    await assertFails(setDoc(doc(ctx.firestore(), 'users', 'new-coord-pcso'), {
      role: 'agency',
      agencyId: 'pcso',
      name: 'Hijacked Coordinator',
    }))
  })

  it("rejects an agency_admin creating a super_admin", async () => {
    await seedUser('agency-admin-1', 'agency_admin', 'malasakit')
    const ctx = testEnv.authenticatedContext('agency-admin-1')
    await assertFails(setDoc(doc(ctx.firestore(), 'users', 'fake-admin'), {
      role: 'super_admin',
      agencyId: null,
      name: 'Pwned',
    }))
  })
})