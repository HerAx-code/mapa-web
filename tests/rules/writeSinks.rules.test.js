import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, addDoc, updateDoc, deleteDoc, collection, serverTimestamp } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-writesinks',
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

// ── Phase 1.4 — applications.create ─────────────────────────────────────
// Was `isPatient() || isAdmin()` with zero field validation. A patient
// could forge a slice for any patient, any agency, any amount, status
// 'approved'. The isPatient() branch was dead: the only write to
// applications in src/ is the admin endorsement transaction.
describe('applications.create — Phase 1.4 forged funding slice', () => {
  const slice = (over = {}) => ({
    requestId: 'req-1', patientId: 'patient-1', agencyId: 'malasakit',
    amountRequested: 25000, amountApproved: 0, status: 'endorsed',
    submittedAt: serverTimestamp(), ...over,
  })

  it('allows CRMC admin to create an endorsement slice', async () => {
    await seedUser('admin-1', 'staff_admin')
    const ctx = testEnv.authenticatedContext('admin-1')
    await assertSucceeds(addDoc(collection(ctx.firestore(), 'applications'), slice()))
  })

  it('REGRESSION GUARD: rejects a patient forging an APPROVED slice for themselves', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'applications'),
      slice({ status: 'approved', amountApproved: 25000 })))
  })

  it("REGRESSION GUARD: rejects a patient creating a slice for ANOTHER patient", async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'applications'),
      slice({ patientId: 'patient-2' })))
  })

  it('rejects a patient creating even a well-formed pending slice (admin-only now)', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'applications'),
      slice({ status: 'pending' })))
  })

  it('rejects an agency creating a slice for itself', async () => {
    await seedUser('agency-1', 'agency', 'malasakit')
    const ctx = testEnv.authenticatedContext('agency-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'applications'), slice()))
  })
})

// ── Phase 1.4 — requests.create ─────────────────────────────────────────
// Ownership was enforced, entry state was not: a patient could submit a
// request pre-advanced past CRMC verification, or pre-loaded with agencies.
describe('requests.create — Phase 1.4 self-endorsement', () => {
  const req = (over = {}) => ({
    requestId: 'CRMC-2026-00001', patientId: 'patient-1',
    assistanceType: 'Hospital Bills', amountNeeded: 25000,
    amountCommitted: 0, agencyIds: [], status: 'submitted',
    submittedAt: serverTimestamp(), ...over,
  })

  it('allows the real submit path', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(addDoc(collection(ctx.firestore(), 'requests'), req()))
  })

  it('REGRESSION GUARD: rejects a request created as fully_funded', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'requests'),
      req({ status: 'fully_funded' })))
  })

  it('REGRESSION GUARD: rejects a request pre-loaded with agencyIds', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'requests'),
      req({ status: 'endorsed', agencyIds: ['malasakit'] })))
  })

  it('rejects a request pre-loaded with amountCommitted', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'requests'),
      req({ amountCommitted: 25000 })))
  })

  it('rejects a request attributed to another patient', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'requests'),
      req({ patientId: 'patient-2' })))
  })
})

// ── Phase 1.4 — notifications.create ────────────────────────────────────
// read/update/delete checked uid() == userId; create checked only
// isAuth(), so any patient could write into a super_admin's feed with no
// sender field. Cross-role writes must stay open, so the fix is mandatory
// attribution rather than recipient-matching.
describe('notifications.create — Phase 1.4 unattributed spoofing', () => {
  const notif = (over = {}) => ({
    type: 'app_submitted', title: 'New assistance request',
    body: 'A patient submitted a request.', read: false,
    createdAt: serverTimestamp(), fromUid: 'patient-1', ...over,
  })

  it('allows the real cross-role write: patient notifies an admin', async () => {
    await seedUser('patient-1', 'patient')
    await seedUser('admin-1', 'super_admin')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(
      addDoc(collection(ctx.firestore(), 'notifications', 'admin-1', 'items'), notif())
    )
  })

  it('REGRESSION GUARD: rejects an unattributed notification into an admin feed', async () => {
    await seedUser('patient-1', 'patient')
    await seedUser('admin-1', 'super_admin')
    const ctx = testEnv.authenticatedContext('patient-1')
    const { fromUid, ...noSender } = notif()
    await assertFails(
      addDoc(collection(ctx.firestore(), 'notifications', 'admin-1', 'items'), noSender)
    )
  })

  it('REGRESSION GUARD: rejects a spoofed fromUid (impersonating an admin)', async () => {
    await seedUser('patient-1', 'patient')
    await seedUser('admin-1', 'super_admin')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(
      addDoc(collection(ctx.firestore(), 'notifications', 'admin-1', 'items'),
        notif({ fromUid: 'admin-1' }))
    )
  })

  it('still enforces the body size cap', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(
      addDoc(collection(ctx.firestore(), 'notifications', 'admin-1', 'items'),
        notif({ body: 'x'.repeat(2001) }))
    )
  })
})

// ── Phase 1.4 — notificationErrors.create ───────────────────────────────
describe('notificationErrors.create — Phase 1.4 anonymous write sink', () => {
  const errDoc = (over = {}) => ({
    recipientUid: 'admin-1', reportedByUid: 'patient-1', type: 'app_submitted',
    error: 'permission-denied', at: serverTimestamp(), ...over,
  })

  it('allows the real best-effort log write from notify()', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(addDoc(collection(ctx.firestore(), 'notificationErrors'), errDoc()))
  })

  it('REGRESSION GUARD: rejects an unattributed log entry', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    const { reportedByUid, ...anon } = errDoc()
    await assertFails(addDoc(collection(ctx.firestore(), 'notificationErrors'), anon))
  })

  it('rejects an entry with no error string', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    const { error, ...noErr } = errDoc()
    await assertFails(addDoc(collection(ctx.firestore(), 'notificationErrors'), noErr))
  })

  it('rejects an empty error string', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'notificationErrors'),
      errDoc({ error: '' })))
  })
})

// ── Phase 1.5 — documents.update / delete ───────────────────────────────
// documents.create pins status 'pending' and blocklists agencyIds +
// storagePath, but update had NO field constraints, so all three guards
// were bypassable with a follow-up write: self-verify, self-endorse, or
// point storagePath at an attacker-chosen Storage object.
describe('documents.update — Phase 1.5 create-guard bypass', () => {
  async function seedDoc(docId, patientId, over = {}) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'documents', docId), {
        patientId, name: 'Valid ID', fileName: 'id.jpg', type: 'image/jpeg',
        size: '50 KB', date: '2026-07-23', status: 'pending', ...over,
      })
    })
  }

  it('allows the real re-upload path (replacePatientDocument)', async () => {
    await seedUser('patient-1', 'patient')
    await seedDoc('doc-1', 'patient-1', { status: 'rejected' })
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(updateDoc(doc(ctx.firestore(), 'documents', 'doc-1'), {
      status: 'pending', fileName: 'id2.jpg', type: 'image/jpeg',
      size: '48 KB', date: '2026-07-23', reviewedBy: null, reviewedAt: null,
    }))
  })

  it('REGRESSION GUARD: rejects a patient self-verifying their own document', async () => {
    await seedUser('patient-1', 'patient')
    await seedDoc('doc-1', 'patient-1')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(updateDoc(doc(ctx.firestore(), 'documents', 'doc-1'), {
      status: 'verified',
    }))
  })

  it('REGRESSION GUARD: rejects a patient stamping storagePath', async () => {
    await seedUser('patient-1', 'patient')
    await seedDoc('doc-1', 'patient-1')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(updateDoc(doc(ctx.firestore(), 'documents', 'doc-1'), {
      status: 'pending', storagePath: 'documents/other-patient/secret/file.jpg',
    }))
  })

  it('REGRESSION GUARD: rejects a patient self-endorsing via agencyIds', async () => {
    await seedUser('patient-1', 'patient')
    await seedDoc('doc-1', 'patient-1')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(updateDoc(doc(ctx.firestore(), 'documents', 'doc-1'), {
      status: 'pending', agencyIds: ['malasakit'],
    }))
  })

  it('still lets an admin verify a document', async () => {
    await seedUser('admin-1', 'staff_admin')
    await seedDoc('doc-1', 'patient-1')
    const ctx = testEnv.authenticatedContext('admin-1')
    await assertSucceeds(updateDoc(doc(ctx.firestore(), 'documents', 'doc-1'), {
      status: 'verified', reviewedBy: 'CRMC', reviewedAt: serverTimestamp(),
    }))
  })

  it("rejects a patient updating another patient's document", async () => {
    await seedUser('patient-1', 'patient')
    await seedDoc('doc-1', 'patient-2')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(updateDoc(doc(ctx.firestore(), 'documents', 'doc-1'), {
      status: 'pending', fileName: 'x.jpg',
    }))
  })

  it('allows the rollback delete of a fresh pending document', async () => {
    await seedUser('patient-1', 'patient')
    await seedDoc('doc-1', 'patient-1')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(deleteDoc(doc(ctx.firestore(), 'documents', 'doc-1')))
  })

  it('REGRESSION GUARD: rejects deleting an already-verified document', async () => {
    await seedUser('patient-1', 'patient')
    await seedDoc('doc-1', 'patient-1', { status: 'verified' })
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(deleteDoc(doc(ctx.firestore(), 'documents', 'doc-1')))
  })

  it('REGRESSION GUARD: rejects deleting an endorsed document', async () => {
    await seedUser('patient-1', 'patient')
    await seedDoc('doc-1', 'patient-1', { agencyIds: ['malasakit'] })
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(deleteDoc(doc(ctx.firestore(), 'documents', 'doc-1')))
  })
})

// ── Phase 1.5 — requests.update value constraints ───────────────────────
describe('requests.update — Phase 1.5 agency value constraints', () => {
  async function seedRequest(id, over = {}) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'requests', id), {
        patientId: 'patient-1', amountNeeded: 25000, amountCommitted: 0,
        agencyIds: ['malasakit'], status: 'endorsed', ...over,
      })
    })
  }

  it('allows the real approval write (committed + derived status)', async () => {
    await seedUser('agency-1', 'agency', 'malasakit')
    await seedRequest('req-1')
    const ctx = testEnv.authenticatedContext('agency-1')
    await assertSucceeds(updateDoc(doc(ctx.firestore(), 'requests', 'req-1'), {
      amountCommitted: 10000, status: 'partially_funded', updatedAt: serverTimestamp(),
    }))
  })

  it('REGRESSION GUARD: rejects an agency writing a CRMC-only status', async () => {
    await seedUser('agency-1', 'agency', 'malasakit')
    await seedRequest('req-1')
    const ctx = testEnv.authenticatedContext('agency-1')
    await assertFails(updateDoc(doc(ctx.firestore(), 'requests', 'req-1'), {
      amountCommitted: 0, status: 'closed', updatedAt: serverTimestamp(),
    }))
  })

  it('rejects a negative amountCommitted', async () => {
    await seedUser('agency-1', 'agency', 'malasakit')
    await seedRequest('req-1')
    const ctx = testEnv.authenticatedContext('agency-1')
    await assertFails(updateDoc(doc(ctx.firestore(), 'requests', 'req-1'), {
      amountCommitted: -5000, status: 'partially_funded', updatedAt: serverTimestamp(),
    }))
  })

  it('rejects a non-numeric amountCommitted', async () => {
    await seedUser('agency-1', 'agency', 'malasakit')
    await seedRequest('req-1')
    const ctx = testEnv.authenticatedContext('agency-1')
    await assertFails(updateDoc(doc(ctx.firestore(), 'requests', 'req-1'), {
      amountCommitted: 'lots', status: 'partially_funded', updatedAt: serverTimestamp(),
    }))
  })

  it('still rejects an agency touching patient data', async () => {
    await seedUser('agency-1', 'agency', 'malasakit')
    await seedRequest('req-1')
    const ctx = testEnv.authenticatedContext('agency-1')
    await assertFails(updateDoc(doc(ctx.firestore(), 'requests', 'req-1'), {
      amountCommitted: 10000, status: 'partially_funded', amountNeeded: 1,
    }))
  })
})

// ── Phase 1.5 — conversations.update participant tampering ──────────────
describe('conversations.update — Phase 1.5 participant tampering', () => {
  async function seedConv(id, participants) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'conversations', id), {
        participants, lastMessage: 'hi', unread: {},
      })
    })
  }

  it('allows the real unread/last-message denormalisation write', async () => {
    await seedUser('patient-1', 'patient')
    await seedConv('conv-1', ['patient-1', 'admin-1'])
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(updateDoc(doc(ctx.firestore(), 'conversations', 'conv-1'), {
      lastMessage: 'hello', lastFrom: 'patient-1', lastAt: serverTimestamp(),
      'unread.admin-1': 1,
    }))
  })

  it('REGRESSION GUARD: rejects adding a third party to the thread', async () => {
    await seedUser('patient-1', 'patient')
    await seedConv('conv-1', ['patient-1', 'admin-1'])
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(updateDoc(doc(ctx.firestore(), 'conversations', 'conv-1'), {
      participants: ['patient-1', 'admin-1', 'outsider-1'],
    }))
  })

  it('REGRESSION GUARD: rejects removing the other participant', async () => {
    await seedUser('patient-1', 'patient')
    await seedConv('conv-1', ['patient-1', 'admin-1'])
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(updateDoc(doc(ctx.firestore(), 'conversations', 'conv-1'), {
      participants: ['patient-1'],
    }))
  })
})

// ── Phase 1.5 — hospitalIds claim scope ─────────────────────────────────
describe('hospitalIds.update — Phase 1.5 claim write scope', () => {
  async function seedCode(id, over = {}) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'hospitalIds', id), {
        status: 'available', patId: null, note: 'issued at MSS window', ...over,
      })
    })
  }

  it('allows the real registration claim', async () => {
    await seedCode('CRMC-2026-00001')
    const ctx = testEnv.authenticatedContext('new-patient')
    await assertSucceeds(updateDoc(doc(ctx.firestore(), 'hospitalIds', 'CRMC-2026-00001'), {
      status: 'used', patId: 'new-patient', date: '2026-07-23', time: '10:00:00',
    }))
  })

  it('REGRESSION GUARD: rejects rewriting unrelated fields while claiming', async () => {
    await seedCode('CRMC-2026-00001')
    const ctx = testEnv.authenticatedContext('new-patient')
    await assertFails(updateDoc(doc(ctx.firestore(), 'hospitalIds', 'CRMC-2026-00001'), {
      status: 'used', patId: 'new-patient', date: '2026-07-23', time: '10:00:00',
      note: 'tampered',
    }))
  })

  it('still rejects claiming an already-used code', async () => {
    await seedCode('CRMC-2026-00001', { status: 'used', patId: 'someone-else' })
    const ctx = testEnv.authenticatedContext('new-patient')
    await assertFails(updateDoc(doc(ctx.firestore(), 'hospitalIds', 'CRMC-2026-00001'), {
      status: 'used', patId: 'new-patient', date: '2026-07-23', time: '10:00:00',
    }))
  })
})

// ── Phase 1.4 — conversations/messages.create ───────────────────────────
describe('messages.create — Phase 1.4 optional sender', () => {
  async function seedConversation(convId, participants) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'conversations', convId), { participants })
    })
  }

  it('allows a participant to send an attributed message', async () => {
    await seedUser('patient-1', 'patient')
    await seedConversation('conv-1', ['patient-1', 'admin-1'])
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(
      addDoc(collection(ctx.firestore(), 'conversations', 'conv-1', 'messages'), {
        from: 'patient-1', fromName: 'Test Patient', text: 'Hello',
        createdAt: serverTimestamp(),
      })
    )
  })

  it('REGRESSION GUARD: rejects a message with no `from`', async () => {
    await seedUser('patient-1', 'patient')
    await seedConversation('conv-1', ['patient-1', 'admin-1'])
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(
      addDoc(collection(ctx.firestore(), 'conversations', 'conv-1', 'messages'), {
        fromName: 'CRMC Social Worker', text: 'Your request was approved.',
        createdAt: serverTimestamp(),
      })
    )
  })

  it('rejects a message attributed to the other participant', async () => {
    await seedUser('patient-1', 'patient')
    await seedConversation('conv-1', ['patient-1', 'admin-1'])
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(
      addDoc(collection(ctx.firestore(), 'conversations', 'conv-1', 'messages'), {
        from: 'admin-1', text: 'Approved.', createdAt: serverTimestamp(),
      })
    )
  })

  it('rejects a non-participant posting into the thread', async () => {
    await seedUser('patient-2', 'patient')
    await seedConversation('conv-1', ['patient-1', 'admin-1'])
    const ctx = testEnv.authenticatedContext('patient-2')
    await assertFails(
      addDoc(collection(ctx.firestore(), 'conversations', 'conv-1', 'messages'), {
        from: 'patient-2', text: 'intruding', createdAt: serverTimestamp(),
      })
    )
  })
})
