import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore'
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

// documentContents/create from rules-3
describe('documentContents.create — patient owns the content', () => {
  it('allows a patient to write content attributed to themselves', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'documentContents', 'doc-1'), {
      patientId: 'patient-1',
      documentId: 'doc-1',
      content: 'data:image/jpeg;base64,...',
    }))
  })

  it('rejects content attributed to a different patient', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(setDoc(doc(ctx.firestore(), 'documentContents', 'doc-1'), {
      patientId: 'patient-2',
      documentId: 'doc-1',
      content: 'data:image/jpeg;base64,...',
    }))
  })
})