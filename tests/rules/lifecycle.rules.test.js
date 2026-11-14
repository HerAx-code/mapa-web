import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

// Logic review 2026-11-14: a request the hospital ended can't take new
// commitments; reject only before money is committed; withdraw until endorsed.
const A = 'hospital-1'
let testEnv
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-lifecycle',
    firestore: { rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'), host: 'localhost', port: 8080 },
  })
})
afterAll(async () => testEnv?.cleanup())

const slice = (requestId, status) => ({
  patientId: 'pat', agencyId: 'dswd', requestId, tenantId: A, status, amountRequested: 20000,
})
beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const put = (p, d) => setDoc(doc(db, ...p.split('/')), d)
    await Promise.all([
      put('hospitals/hospital-1', { accessCodePrefix: 'MAPA', enabled: true }),
      put('users/admin', { role: 'super_admin', tenantId: A }),
      put('users/coord', { role: 'agency', agencyId: 'dswd' }),
      put('users/pat', { role: 'patient', tenantId: A, tenantIds: [A] }),
      put('requests/open', { patientId: 'pat', tenantId: A, status: 'endorsed', agencyIds: ['dswd'], amountNeeded: 20000, amountCommitted: 0 }),
      put('requests/rej', { patientId: 'pat', tenantId: A, status: 'rejected', agencyIds: ['dswd'], amountNeeded: 20000, amountCommitted: 0 }),
      put('requests/funded', { patientId: 'pat', tenantId: A, status: 'partially_funded', agencyIds: ['dswd'], amountNeeded: 20000, amountCommitted: 5000 }),
      put('requests/early', { patientId: 'pat', tenantId: A, status: 'under_review', agencyIds: [], amountNeeded: 20000, amountCommitted: 0 }),
      put('applications/sOpen', slice('open', 'reviewing')),
      put('applications/sRej', slice('rej', 'reviewing')),
      put('applications/sClosed', slice('open', 'closed')),
      put('applications/sEndorsedRej', slice('rej', 'endorsed')),
    ])
  })
})
const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const ref = (uid, p) => doc(as(uid), ...p.split('/'))

describe('no commitment on a request the hospital ended', () => {
  it('an agency approves on an open request, not on a rejected one', async () => {
    await assertSucceeds(updateDoc(ref('coord', 'applications/sOpen'), { status: 'approved', amountApproved: 20000 }))
    await assertFails(updateDoc(ref('coord', 'applications/sRej'), { status: 'approved', amountApproved: 20000 }))
  })

  it('a slice closed by the hospital is final for the agency', async () => {
    await assertFails(updateDoc(ref('coord', 'applications/sClosed'), { status: 'reviewing' }))
  })

  it("the patient can't proceed on a rejected request", async () => {
    await assertFails(updateDoc(ref('pat', 'applications/sEndorsedRej'), { status: 'reviewing' }))
  })

  it("an agency can't rewrite a rejected request's status; it may send one back to review", async () => {
    await assertFails(updateDoc(ref('coord', 'requests/rej'), { status: 'partially_funded', amountCommitted: 5000 }))
    await assertSucceeds(updateDoc(ref('coord', 'requests/open'), { status: 'under_review', amountCommitted: 0 }))
    await assertFails(updateDoc(ref('coord', 'requests/open'), { status: 'submitted', amountCommitted: 0 }))
  })
})

describe('reject vs close', () => {
  it('the hospital rejects only before money is committed; close is always allowed', async () => {
    await assertSucceeds(updateDoc(ref('admin', 'requests/open'), { status: 'rejected' }))
    await assertFails(updateDoc(ref('admin', 'requests/funded'), { status: 'rejected' }))
    await assertSucceeds(updateDoc(ref('admin', 'requests/funded'), { status: 'closed' }))
  })

  it('the hospital closes an open slice', async () => {
    await assertSucceeds(updateDoc(ref('admin', 'applications/sOpen'), { status: 'closed', closedReason: 'x' }))
  })
})

describe('patient withdrawal', () => {
  it('allowed under review while not yet endorsed; not once endorsed', async () => {
    await assertSucceeds(updateDoc(ref('pat', 'requests/early'), { status: 'closed', closeReason: 'Withdrawn by applicant.' }))
    await assertFails(updateDoc(ref('pat', 'requests/open'), { status: 'closed', closeReason: 'Withdrawn by applicant.' }))
  })

  it('a withdrawal changes nothing else', async () => {
    await assertFails(updateDoc(ref('pat', 'requests/early'), { status: 'closed', amountNeeded: 1 }))
  })
})
