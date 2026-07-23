import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-reports',
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

// The exact payload the patient-facing report modal sends
// (src/components/ProfileModals.jsx handleSend).
const patientReport = (uid) => ({
  category:      'Bug',
  description:   'The upload button does nothing on my phone.',
  reportedBy:    uid,
  reporterName:  'Test Patient',
  reporterEmail: 'patient@example.com',
  reporterRole:  'patient',
  createdAt:     serverTimestamp(),
  status:        'open',
})

// ── Phase 1.3 — forged/partial report writes ────────────────────────────
// Original bug: every guarded field was optional (`!('x' in data) || ok`),
// so omitting a field skipped its validation entirely. A forged report
// needed only {category, reportedBy, description}. The 2026-06-01
// injection incident planted 6,481 such docs under a single uid; they
// stayed invisible because the admin Reports view filters on `status`,
// which they omitted. Fix: the guarded fields are now required, and
// createdAt is pinned to request.time.
describe('reports.create — Phase 1.3 forged-report fix', () => {
  it('allows the real patient report path', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(
      addDoc(collection(ctx.firestore(), 'reports'), patientReport('patient-1'))
    )
  })

  it('allows the agency budget-request path (extra fields are fine)', async () => {
    await seedUser('agency-1', 'agency', 'malasakit')
    const ctx = testEnv.authenticatedContext('agency-1')
    await assertSucceeds(
      addDoc(collection(ctx.firestore(), 'reports'), {
        ...patientReport('agency-1'),
        category:        'Budget Request',
        description:     'Requesting P25,000 top-up. Reason: exhausted allocation.',
        amountRequested: 25000,
        agencyId:        'malasakit',
        agencyName:      'Malasakit Center',
        reporterRole:    'agency',
      })
    )
  })

  it('REGRESSION GUARD: rejects the incident payload {category, reportedBy, description}', async () => {
    // The exact shape of all 6,481 planted records -- no status, no
    // createdAt. Pre-fix this passed because both were optional.
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(
      addDoc(collection(ctx.firestore(), 'reports'), {
        category:    's',
        reportedBy:  'patient-1',
        description: 'x'.repeat(600),
      })
    )
  })

  it('REGRESSION GUARD: rejects a report with no status', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    const { status, ...noStatus } = patientReport('patient-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'reports'), noStatus))
  })

  it('REGRESSION GUARD: rejects a report with no createdAt', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    const { createdAt, ...noCreatedAt } = patientReport('patient-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'reports'), noCreatedAt))
  })

  it('rejects a backdated createdAt (must equal request.time)', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(
      addDoc(collection(ctx.firestore(), 'reports'), {
        ...patientReport('patient-1'),
        createdAt: new Date('2020-01-01T00:00:00Z'),
      })
    )
  })

  it('rejects a status other than open (no self-resolving reports)', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(
      addDoc(collection(ctx.firestore(), 'reports'), {
        ...patientReport('patient-1'), status: 'resolved',
      })
    )
  })

  it('rejects impersonating another user via reportedBy', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(
      addDoc(collection(ctx.firestore(), 'reports'), patientReport('someone-else'))
    )
  })

  it('rejects an empty description', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(
      addDoc(collection(ctx.firestore(), 'reports'), {
        ...patientReport('patient-1'), description: '',
      })
    )
  })

  it('rejects an oversize description (> 5000 chars)', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(
      addDoc(collection(ctx.firestore(), 'reports'), {
        ...patientReport('patient-1'), description: 'x'.repeat(5001),
      })
    )
  })

  it('rejects an unauthenticated write', async () => {
    const ctx = testEnv.unauthenticatedContext()
    await assertFails(
      addDoc(collection(ctx.firestore(), 'reports'), patientReport('patient-1'))
    )
  })
})

// Read scoping is unchanged by Phase 1.3, but it was previously untested.
describe('reports.read — admin and agency-admin scoping', () => {
  async function seedReport(id, data) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reports', id), data)
    })
  }

  it('allows an admin to read any report', async () => {
    await seedUser('admin-1', 'super_admin')
    await seedReport('r1', { reportedBy: 'patient-1', status: 'open' })
    const ctx = testEnv.authenticatedContext('admin-1')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'reports', 'r1')))
  })

  it('allows an agency admin to read their own agency report', async () => {
    await seedUser('aadmin-1', 'agency_admin', 'malasakit')
    await seedReport('r2', { reportedBy: 'x', agencyId: 'malasakit', status: 'open' })
    const ctx = testEnv.authenticatedContext('aadmin-1')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'reports', 'r2')))
  })

  it("rejects an agency admin reading another agency's report", async () => {
    await seedUser('aadmin-1', 'agency_admin', 'malasakit')
    await seedReport('r3', { reportedBy: 'x', agencyId: 'other-agency', status: 'open' })
    const ctx = testEnv.authenticatedContext('aadmin-1')
    await assertFails(getDoc(doc(ctx.firestore(), 'reports', 'r3')))
  })

  it('rejects a patient reading reports at all (even their own)', async () => {
    await seedUser('patient-1', 'patient')
    await seedReport('r4', { reportedBy: 'patient-1', status: 'open' })
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(getDoc(doc(ctx.firestore(), 'reports', 'r4')))
  })
})
