import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-documents',
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

function docPayload(patientId, overrides = {}) {
  return {
    patientId,
    patientName: 'Test',
    name: 'Barangay Cert',
    fileName: 'cert.pdf',
    type: 'application/pdf',
    size: '50 KB',
    date: '2026-06-01',
    status: 'pending',
    createdAt: serverTimestamp(),
    ...overrides,
  }
}

// documents.create constraints from rules-3 (commit 9a596d4):
//   - patientId must == uid()
//   - status must == 'pending'
//   - agencyIds field cannot be present
//   - ocrText capped at 4000 chars
describe('documents.create — patient owns the write (rules-3)', () => {
  it('allows a patient to create a document attributed to themselves', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(addDoc(collection(ctx.firestore(), 'documents'), docPayload('patient-1')))
  })

  it('rejects a patient writing a document for another patient', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'documents'), docPayload('patient-2')))
  })

  it("rejects status='verified' on create (no pre-stamping CRMC verification)", async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(
      collection(ctx.firestore(), 'documents'),
      docPayload('patient-1', { status: 'verified' }),
    ))
  })

  it('rejects agencyIds pre-stamped on create (admins set this at endorse time)', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(
      collection(ctx.firestore(), 'documents'),
      docPayload('patient-1', { agencyIds: ['malasakit'] }),
    ))
  })

  it('rejects storagePath pre-stamped on create (Storage uploader stamps it AFTER upload via update)', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(
      collection(ctx.firestore(), 'documents'),
      docPayload('patient-1', { storagePath: 'documents/other-patient/secret/file.pdf' }),
    ))
  })

  it('rejects oversized ocrText payload (>4000 chars)', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(
      collection(ctx.firestore(), 'documents'),
      docPayload('patient-1', { ocrText: 'a'.repeat(4001) }),
    ))
  })

  it('accepts normal-sized ocrText (<= 4000 chars)', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(addDoc(
      collection(ctx.firestore(), 'documents'),
      docPayload('patient-1', { ocrText: 'a'.repeat(1500) }),
    ))
  })

  it('rejects writes from non-patient roles', async () => {
    await seedUser('agency-1', 'agency')
    const ctx = testEnv.authenticatedContext('agency-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'documents'), docPayload('agency-1')))
  })
})

// Advisory ID-verification fields (docs/id-verification-plan.md §3b): verdict
// enums, scores in [0,1], a short detected type — bounded so a hostile client
// can't write junk. null is always allowed ("could not check").
describe('documents — advisory ID-verification field bounds', () => {
  const VALID = {
    idTypeDetected: "Driver's License",
    faceMatch: 'pass', faceMatchScore: 0.83,
    liveness: 'unclear', livenessScore: 0.41,
    idVerifyMethod: 'ocr',
  }

  it('accepts valid face-match / liveness / idType fields on create', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(addDoc(collection(ctx.firestore(), 'documents'), docPayload('patient-1', VALID)))
  })

  it('accepts null verdicts + scores on create (could-not-check)', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(addDoc(collection(ctx.firestore(), 'documents'), docPayload('patient-1', {
      faceMatch: null, faceMatchScore: null, liveness: null, livenessScore: null, idVerifyMethod: 'ocr',
    })))
  })

  it('rejects a score outside [0,1]', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'documents'), docPayload('patient-1', { faceMatchScore: 1.5 })))
    await assertFails(addDoc(collection(ctx.firestore(), 'documents'), docPayload('patient-1', { livenessScore: -0.2 })))
  })

  it('rejects an out-of-enum verdict or method', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'documents'), docPayload('patient-1', { faceMatch: 'fail' })))
    await assertFails(addDoc(collection(ctx.firestore(), 'documents'), docPayload('patient-1', { idVerifyMethod: 'philsys_api' })))
  })

  it('rejects an oversized idTypeDetected (>100 chars)', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'documents'), docPayload('patient-1', { idTypeDetected: 'x'.repeat(101) })))
  })

  it('lets a patient refresh these fields on their own pending doc (re-upload)', async () => {
    await seedUser('patient-1', 'patient')
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'documents', 'doc-1'), docPayload('patient-1'))
    })
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(updateDoc(doc(ctx.firestore(), 'documents', 'doc-1'), {
      status: 'pending', faceMatch: 'pass', faceMatchScore: 0.9, idVerifyMethod: 'ocr',
    }))
  })

  it('rejects a patient update with an out-of-range score', async () => {
    await seedUser('patient-1', 'patient')
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'documents', 'doc-1'), docPayload('patient-1'))
    })
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(updateDoc(doc(ctx.firestore(), 'documents', 'doc-1'), {
      status: 'pending', faceMatchScore: 9,
    }))
  })
})

// documentContents/create from rules-3
describe('documentContents.create — patient owns the content', () => {
  // Phase 1.3: creating content now also requires the parent
  // documents/{docId} to exist and belong to the same patient, so these
  // tests seed it first. That mirrors uploadPatientDocument, which does
  // addDoc(documents) BEFORE setDoc(documentContents). The orphan case
  // this used to allow is now covered as a regression guard in
  // tests/rules/documentContents.rules.test.js.
  async function seedParent(docId, patientId) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'documents', docId), docPayload(patientId))
    })
  }

  it('allows a patient to write content attributed to themselves', async () => {
    await seedUser('patient-1', 'patient')
    await seedParent('doc-1', 'patient-1')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'documentContents', 'doc-1'), {
      patientId: 'patient-1',
      documentId: 'doc-1',
      content: 'data:image/jpeg;base64,...',
    }))
  })

  it('rejects content attributed to a different patient', async () => {
    await seedUser('patient-1', 'patient')
    await seedParent('doc-1', 'patient-1')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(setDoc(doc(ctx.firestore(), 'documentContents', 'doc-1'), {
      patientId: 'patient-2',
      documentId: 'doc-1',
      content: 'data:image/jpeg;base64,...',
    }))
  })
})