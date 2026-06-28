import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-documentcontents',
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

// Seed the parent documents metadata doc with a specific agencyIds[] —
// the documentContents read rule uses get() against this. Without it,
// the chain returns null and the rule denies (correctly).
async function seedDocumentMeta(docId, patientId, agencyIds = []) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'documents', docId), {
      patientId,
      patientName: 'Test Patient',
      name: 'Test Doc',
      status: 'verified',
      agencyIds,
    })
  })
}

async function seedDocumentContent(docId, patientId, content = 'data:text/plain;base64,SGVsbG8=') {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'documentContents', docId), {
      patientId,
      content,
    })
  })
}

// ── Phase 0.2 — cross-agency read leak ──────────────────────────────────
// Original bug: agency could read ANY patient's documentContents, even
// docs not endorsed to their agency. Fix: get() against the parent
// documents metadata's agencyIds[] must include userAgencyId().
describe('documentContents.read — Phase 0.2 cross-agency leak fix', () => {
  it('allows the patient who owns the content to read it', async () => {
    await seedUser('patient-1', 'patient')
    await seedDocumentMeta('doc-1', 'patient-1', [])
    await seedDocumentContent('doc-1', 'patient-1')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'documentContents', 'doc-1')))
  })

  it('allows an admin to read any content (admin bypass)', async () => {
    await seedUser('admin-1', 'super_admin')
    await seedDocumentMeta('doc-1', 'patient-1', [])
    await seedDocumentContent('doc-1', 'patient-1')
    const ctx = testEnv.authenticatedContext('admin-1')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'documentContents', 'doc-1')))
  })

  it('allows an agency to read content for a document endorsed to their agency', async () => {
    await seedUser('coord-malasakit', 'agency', 'malasakit')
    await seedDocumentMeta('doc-1', 'patient-1', ['malasakit', 'dswd'])
    await seedDocumentContent('doc-1', 'patient-1')
    const ctx = testEnv.authenticatedContext('coord-malasakit')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'documentContents', 'doc-1')))
  })

  it("REGRESSION GUARD: rejects an agency from reading content for a document NOT endorsed to their agency", async () => {
    // This is the exact leak that triggered Phase 0.2. Pre-fix, this
    // call would have SUCCEEDED -- a coordinator at PCSO could pull
    // a patient's confidential medical PDF from a request only ever
    // endorsed to Malasakit.
    await seedUser('coord-pcso', 'agency', 'pcso')
    await seedDocumentMeta('doc-1', 'patient-1', ['malasakit', 'dswd'])
    await seedDocumentContent('doc-1', 'patient-1')
    const ctx = testEnv.authenticatedContext('coord-pcso')
    await assertFails(getDoc(doc(ctx.firestore(), 'documentContents', 'doc-1')))
  })

  it('rejects an agency from reading content for a document with EMPTY agencyIds (pre-endorsement)', async () => {
    // Patient just uploaded, CRMC hasn't endorsed yet -- no agency
    // should see it.
    await seedUser('coord-malasakit', 'agency', 'malasakit')
    await seedDocumentMeta('doc-1', 'patient-1', [])
    await seedDocumentContent('doc-1', 'patient-1')
    const ctx = testEnv.authenticatedContext('coord-malasakit')
    await assertFails(getDoc(doc(ctx.firestore(), 'documentContents', 'doc-1')))
  })

  it('rejects a different patient from reading another patient\'s content', async () => {
    await seedUser('patient-1', 'patient')
    await seedUser('patient-2', 'patient')
    await seedDocumentMeta('doc-1', 'patient-1', [])
    await seedDocumentContent('doc-1', 'patient-1')
    const ctx = testEnv.authenticatedContext('patient-2')
    await assertFails(getDoc(doc(ctx.firestore(), 'documentContents', 'doc-1')))
  })
})

// ── Phase 1.2 — size cap on update ──────────────────────────────────────
// Patients can re-upload (replacing content). Admins can update any.
// Cap at 1MB so a malicious actor can't push 999KB blobs in a loop.
describe('documentContents.update — Phase 1.2 size cap', () => {
  beforeEach(async () => {
    await seedDocumentMeta('doc-1', 'patient-1', ['malasakit'])
    await seedDocumentContent('doc-1', 'patient-1')
  })

  it('allows a patient to update their own content under the size limit', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(updateDoc(doc(ctx.firestore(), 'documentContents', 'doc-1'), {
      content: 'data:text/plain;base64,' + 'A'.repeat(500),  // tiny
    }))
  })

  it("REGRESSION GUARD: rejects a patient writing oversize content (> 1MB)", async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(updateDoc(doc(ctx.firestore(), 'documentContents', 'doc-1'), {
      // Push past the 1MB cap. Pre-fix, only the 1MiB Firestore doc
      // cap caught this -- now the rule rejects explicitly.
      content: 'data:text/plain;base64,' + 'A'.repeat(1_020_000),
    }))
  })

  it('allows an admin to update content under the size limit', async () => {
    await seedUser('admin-1', 'super_admin')
    const ctx = testEnv.authenticatedContext('admin-1')
    await assertSucceeds(updateDoc(doc(ctx.firestore(), 'documentContents', 'doc-1'), {
      content: 'data:text/plain;base64,SGVsbG8gV29ybGQ=',
    }))
  })

  it('rejects an admin writing oversize content (cap is universal, not role-scoped)', async () => {
    await seedUser('admin-1', 'super_admin')
    const ctx = testEnv.authenticatedContext('admin-1')
    await assertFails(updateDoc(doc(ctx.firestore(), 'documentContents', 'doc-1'), {
      content: 'data:text/plain;base64,' + 'A'.repeat(1_020_000),
    }))
  })

  it('allows updates that do not touch the content field', async () => {
    // E.g. flipping a metadata flag without re-uploading.
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(updateDoc(doc(ctx.firestore(), 'documentContents', 'doc-1'), {
      reuploadedAt: 'whenever',
    }))
  })
})
