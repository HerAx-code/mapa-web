import { loadRules } from './helpers/rules.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc } from 'firebase/firestore'
import { approveWithMark } from './helpers/approval.js'
import fs from 'node:fs'
import path from 'node:path'

// Logic review 2026-11-14: a request the hospital ended can't take new
// commitments; reject only before money is committed; withdraw until endorsed.
const A = 'hospital-1'
let testEnv
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-lifecycle',
    firestore: { rules: loadRules(), host: 'localhost', port: 8080 },
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
  it('an agency approves on neither from the browser (decideSlice refuses a closed request)', async () => {
    // Phase 2 PR 2.3: agency decisions, letters and budgets run in Cloud Functions (decideSlice / settleLetter, tests/functions/sliceActions.test.js).
    await assertFails(approveWithMark(as('coord'), 'sOpen', slice('open'), { status: 'approved', amountApproved: 20000 }))
    await assertFails(approveWithMark(as('coord'), 'sRej', slice('rej'), { status: 'approved', amountApproved: 20000 }))
  })

  it('a slice closed by the hospital is final for the agency', async () => {
    await assertFails(updateDoc(ref('coord', 'applications/sClosed'), { status: 'reviewing' }))
  })

  it("the patient can't proceed on a rejected request", async () => {
    await assertFails(updateDoc(ref('pat', 'applications/sEndorsedRej'), { status: 'reviewing' }))
  })

  it("an agency writes no request at all (the totals are recomputed on the server)", async () => {
    await assertFails(updateDoc(ref('coord', 'requests/rej'), { status: 'partially_funded', amountCommitted: 5000 }))
    await assertFails(updateDoc(ref('coord', 'requests/open'), { status: 'under_review', amountCommitted: 0 }))
    await assertFails(updateDoc(ref('coord', 'requests/open'), { status: 'submitted', amountCommitted: 0 }))
  })
})

describe('reject vs close', () => {
  it('the hospital no longer rejects, closes or touches slices from the browser', async () => {
    // Phase 2 PR 2.2: endorsing, closing and slots run in Cloud Functions (endorseRequest / closeRequest, tests/functions/caseActions.test.js).
    await assertFails(updateDoc(ref('admin', 'requests/open'), { status: 'rejected' }))
    await assertFails(updateDoc(ref('admin', 'requests/funded'), { status: 'closed' }))
    await assertFails(updateDoc(ref('admin', 'applications/sOpen'), { status: 'closed', closedReason: 'x' }))
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

describe('what hospital staff may still write on a request (Phase 2 PR 2.2)', () => {
  it('move a new request to under review, correct the bill before endorsement, nothing about money', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'requests', 'fresh'), { patientId: 'pat', status: 'submitted', agencyIds: [], amountCommitted: 0, tenantId: A, totalBill: 5000, amountNeeded: 5000 })
    })
    await assertSucceeds(updateDoc(ref('admin', 'requests/fresh'), { status: 'under_review' }))
    await assertSucceeds(updateDoc(ref('admin', 'requests/fresh'), { totalBill: 6000, amountNeeded: 6000 }))
    await assertFails(updateDoc(ref('admin', 'requests/fresh'), { status: 'endorsed' }))
    await assertFails(updateDoc(ref('admin', 'requests/fresh'), { agencyIds: ['dswd'] }))
    await assertFails(updateDoc(ref('admin', 'requests/fresh'), { amountCommitted: 100 }))
  })
  it('the bill and coverage lock once endorsed', async () => {
    await assertFails(updateDoc(ref('admin', 'requests/open'), { amountNeeded: 1 }))
  })
})
