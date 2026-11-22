import { loadRules } from './helpers/rules.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'

// Phase 3 PR 3.1 (P3-A, gaps I7, M4): a document a social worker verified, or
// one sent to an agency, is evidence. A patient may change a document's file
// only while it is pending or rejected and was never endorsed; a correction
// after that is a new document. Staff no longer write a request's document
// list (syncDocumentStatus keeps it).
const A = 'hospital-1'
let testEnv
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-documents-evidence',
    firestore: { rules: loadRules(), host: 'localhost', port: 8080 },
  })
})
afterAll(async () => testEnv?.cleanup())

const docMeta = (status, extra = {}) => ({ patientId: 'pat', tenantId: A, name: 'Billing Statement', status, ...extra })
const content = { content: 'data:image/png;base64,AAAA', documentId: 'x', patientId: 'pat', tenantId: A }

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const put = (p, d) => setDoc(doc(db, ...p.split('/')), d)
    await Promise.all([
      put('hospitals/hospital-1', { accessCodePrefix: 'MAPA', enabled: true }),
      put('users/pat', { role: 'patient', agencyId: null, rank: null, active: true, name: 'Pat', tenantId: A, tenantIds: [A] }),
      put('users/sw', { role: 'staff_admin', tenantId: A, name: 'SW' }),
      put('documents/dPending', docMeta('pending')),
      put('documents/dRejected', docMeta('rejected')),
      put('documents/dVerified', docMeta('verified')),
      put('documents/dEndorsed', docMeta('rejected', { agencyIds: ['dswd'] })),
      ...['dPending', 'dRejected', 'dVerified', 'dEndorsed'].map((id) => put(`documentContents/${id}`, { ...content, documentId: id })),
      put('requests/r1', { patientId: 'pat', tenantId: A, status: 'under_review', agencyIds: [], amountCommitted: 0,
        attachedDocuments: [{ documentId: 'dVerified', name: 'Billing Statement', status: 'verified' }] }),
    ])
  })
})
const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const reupload = { status: 'pending', fileName: 'new.jpg', reviewedBy: null, reviewedAt: null }

describe('a patient replaces a file only before anyone relied on it', () => {
  it('pending and rejected documents, never endorsed: re-upload allowed', async () => {
    for (const id of ['dPending', 'dRejected']) {
      await assertSucceeds(updateDoc(doc(as('pat'), 'documents', id), reupload))
      await assertSucceeds(setDoc(doc(as('pat'), 'documentContents', id), { ...content, documentId: id }))
    }
  })

  it('a verified document is locked: file, status and content (I7)', async () => {
    await assertFails(updateDoc(doc(as('pat'), 'documents', 'dVerified'), reupload))
    await assertFails(setDoc(doc(as('pat'), 'documentContents', 'dVerified'), { ...content, documentId: 'dVerified' }))
    await assertFails(deleteDoc(doc(as('pat'), 'documentContents', 'dVerified')))
    await assertFails(deleteDoc(doc(as('pat'), 'documents', 'dVerified')))
  })

  it('a document sent to an agency is locked even if rejected', async () => {
    await assertFails(updateDoc(doc(as('pat'), 'documents', 'dEndorsed'), reupload))
    await assertFails(setDoc(doc(as('pat'), 'documentContents', 'dEndorsed'), { ...content, documentId: 'dEndorsed' }))
  })

  it('the upload rollback still works: a pending, never-endorsed document and its content can be deleted', async () => {
    await assertSucceeds(deleteDoc(doc(as('pat'), 'documentContents', 'dPending')))
    await assertSucceeds(deleteDoc(doc(as('pat'), 'documents', 'dPending')))
  })

  it('a correction is a new document that names what it supersedes', async () => {
    await assertSucceeds(setDoc(doc(as('pat'), 'documents', 'dNew'), docMeta('pending', { supersedes: 'dVerified' })))
  })
})

describe("the request's document list follows the documents (M4)", () => {
  it('staff review the document, not the request copy', async () => {
    await assertSucceeds(updateDoc(doc(as('sw'), 'documents', 'dPending'), { status: 'verified' }))
    await assertFails(updateDoc(doc(as('sw'), 'requests', 'r1'), {
      attachedDocuments: [{ documentId: 'dVerified', name: 'Billing Statement', status: 'rejected' }],
    }))
  })
})
