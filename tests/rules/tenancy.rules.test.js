import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { fileRequest } from './helpers/marketplace.js'
import fs from 'node:fs'
import path from 'node:path'

// Multi-hospital Phase 2 — new docs carry tenantId (docs/multi-hospital-network-plan.md).
// Phase 2 only WRITES the field; the cross-hospital denial suite lands with
// Phase 5. What must hold now: every create path accepts tenantId, and a user
// can't re-point their own tenant.
let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-tenancy',
    firestore: {
      rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  })
})

afterAll(async () => testEnv?.cleanup())
beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', 'admin-1'),   { role: 'staff_admin', tenantId: 'hospital-1' })
    await setDoc(doc(db, 'users', 'agadm-1'),   { role: 'agency_admin', agencyId: 'dswd' })
    await setDoc(doc(db, 'users', 'coord-1'),   { role: 'agency', agencyId: 'dswd' })
    await setDoc(doc(db, 'users', 'super-1'),   { role: 'super_admin', tenantId: 'hospital-1' })
    await setDoc(doc(db, 'hospitalIds', 'MAPA-2026-00009'), { status: 'available', patId: null, tenantId: 'hospital-1' })
    await setDoc(doc(db, 'agencies', 'dswd'), { name: 'DSWD', partnerHospitalIds: ['hospital-1'] })
    await setDoc(doc(db, 'hospitals', 'hospital-1'), { gatewayName: 'MSS', accessCodePrefix: 'MAPA', enabled: true })
    // Real patient profiles carry agencyId/rank/active (Register.jsx); the
    // self-update rule compares them, so the fixture must too.
    const patient = { role: 'patient', agencyId: null, rank: null, active: true }
    await setDoc(doc(db, 'users', 'patient-1'), { ...patient, name: 'Ana', hospitalId: 'MAPA-2026-00001', tenantId: 'hospital-1' })
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()

describe('users.tenantId', () => {
  // Marketplace: registration is network-level — no code, no hospital.
  it('a patient registers with no hospital; a tenantId at sign-up is refused', async () => {
    await assertFails(setDoc(doc(as('patient-2'), 'users', 'patient-2'), { role: 'patient', hospitalId: 'MAPA-2026-00009', tenantId: 'hospital-1' }))
    await assertSucceeds(setDoc(doc(as('patient-2'), 'users', 'patient-2'), { role: 'patient', name: 'Ana' }))
  })

  it('a patient may NOT change their own tenantId', async () => {
    await assertFails(updateDoc(doc(as('patient-1'), 'users', 'patient-1'), { tenantId: 'bgh' }))
  })

  it('a patient may NOT add a tenantId to a pre-backfill profile', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'users', 'patient-3'), { role: 'patient', agencyId: null, rank: null, active: true, name: 'Old' }))
    await assertFails(updateDoc(doc(as('patient-3'), 'users', 'patient-3'), { tenantId: 'bgh' }))
  })

  it('a patient can still edit their own profile fields', async () => {
    await assertSucceeds(updateDoc(doc(as('patient-1'), 'users', 'patient-1'), { contact: '09170000000' }))
  })

  // Phase 5: a hospital admin can't move anyone to another hospital — a
  // transfer becomes a platform_admin action (Phase 6).
  it('gateway admins may NOT move a patient to another hospital', async () => {
    await assertFails(updateDoc(doc(as('admin-1'), 'users', 'patient-1'), { tenantId: 'bgh' }))
  })

  it('gateway admins create staff in their own hospital', async () => {
    await assertSucceeds(setDoc(doc(as('admin-1'), 'users', 'staff-2'), { role: 'staff_admin', tenantId: 'hospital-1' }))
  })

  it('an agency admin may NOT give a coordinator a tenant', async () => {
    await assertFails(updateDoc(doc(as('agadm-1'), 'users', 'coord-1'), { tenantId: 'hospital-1' }))
  })
})

describe('create paths accept tenantId', () => {
  it('patient request', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'hospitalIds', 'MAPA-2026-00001'), { status: 'used', patId: 'patient-1', tenantId: 'hospital-1' }))
    await assertSucceeds(fileRequest(as('patient-1'), { reqId: 'r1', code: 'MAPA-2026-00001', data: {
      patientId: 'patient-1', status: 'submitted', agencyIds: [], amountCommitted: 0, tenantId: 'hospital-1',
    } }))
  })

  it('patient document', async () => {
    await assertSucceeds(setDoc(doc(as('patient-1'), 'documents', 'd1'), {
      patientId: 'patient-1', status: 'pending', tenantId: 'hospital-1',
    }))
  })

  it('admin slice, access code (super_admin only), audit entry', async () => {
    await assertSucceeds(setDoc(doc(as('admin-1'), 'applications', 'a1'), { patientId: 'patient-1', agencyId: 'dswd', status: 'endorsed', tenantId: 'hospital-1' }))
    await assertSucceeds(setDoc(doc(as('super-1'), 'hospitalIds', 'MAPA-2026-00002'), { status: 'available', patId: null, tenantId: 'hospital-1' }))
    await assertSucceeds(setDoc(doc(as('admin-1'), 'auditLog', 'l1'), { actorId: 'admin-1', details: 'x', tenantId: 'hospital-1' }))
  })

  it('patient report', async () => {
    await assertSucceeds(setDoc(doc(as('patient-1'), 'reports', 'rep1'), {
      reportedBy: 'patient-1', status: 'open', createdAt: serverTimestamp(),
      category: 'bug', description: 'Broken button', tenantId: 'hospital-1',
    }))
  })
})
