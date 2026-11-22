import { loadRules } from './helpers/rules.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, updateDoc, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore'
import { approveWithMark } from './helpers/approval.js'
import { fileRequest, claimCode } from './helpers/marketplace.js'

// Process consistency (2026-11-15):
//  - the 30-day approval cooldown is enforced by the rules, per agency
//    (approvalMarks/{agencyId}__{patientId});
//  - a patient on a holding period (users.cooldown > 0) can't file a request
//    or move to another hospital, and only the current hospital sets it.
const A = 'hospital-1'
const B = 'bgh'
const DAY = 86400000
let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-cooldown',
    firestore: { rules: loadRules(), host: 'localhost', port: 8080 },
  })
})
afterAll(async () => testEnv?.cleanup())

const slice = (requestId, extra = {}) => ({
  patientId: 'pat', agencyId: 'dswd', requestId, tenantId: A, status: 'reviewing', amountRequested: 20000, ...extra,
})
const pat = (extra = {}) => ({ role: 'patient', agencyId: null, rank: null, active: true, name: 'Pat', ...extra })
const daysAgo = (n) => Timestamp.fromMillis(Date.now() - n * DAY)

async function seed(extra = []) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const put = (p, d) => setDoc(doc(db, ...p.split('/')), d)
    await Promise.all([
      put('hospitals/hospital-1', { accessCodePrefix: 'MAPA', enabled: true }),
      put('hospitals/bgh', { accessCodePrefix: 'BGH', enabled: true }),
      put('users/adminA', { role: 'staff_admin', tenantId: A }),
      put('users/adminB', { role: 'staff_admin', tenantId: B }),
      put('users/coord', { role: 'agency', agencyId: 'dswd' }),
      put('users/coordX', { role: 'agency', agencyId: 'pcso' }),
      put('users/pat', pat({ tenantId: A, tenantIds: [A, B], hospitalId: 'MAPA-2026-00001' })),
      put('hospitalIds/MAPA-2026-00001', { status: 'used', patId: 'pat', tenantId: A }),
      put('hospitalIds/BGH-2026-00001', { status: 'available', patId: null, tenantId: B }),
      put('requests/r1', { patientId: 'pat', tenantId: A, status: 'endorsed', agencyIds: ['dswd', 'pcso'], amountNeeded: 20000, amountCommitted: 0 }),
      put('requests/r2', { patientId: 'pat', tenantId: A, status: 'endorsed', agencyIds: ['dswd'], amountNeeded: 20000, amountCommitted: 0 }),
      // Repeat limit lives on the agency (Phase 1); no repeatLimit = 30 days.
      put('agencies/dswd', { name: 'DSWD', enabled: true }),
      put('agencies/pcso', { name: 'PCSO', enabled: true }),
      put('applications/s1', slice('r1')),
      put('applications/s2', slice('r2')),
      put('applications/sX', slice('r1', { agencyId: 'pcso' })),
      ...extra.map(([p, d]) => put(p, d)),
    ])
  })
}
beforeEach(async () => testEnv.clearFirestore())

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const approve = { status: 'approved', amountApproved: 10000, approvedAt: serverTimestamp() }
const mark = (requestId, at, sliceId = 's1', agencyId = 'dswd') =>
  ['approvalMarks/' + agencyId + '__pat', { agencyId, patientId: 'pat', requestId, sliceId, lastApprovedAt: at }]

describe('approvals run only on the server (Phase 2 PR 2.3)', () => {
  // Phase 2 PR 2.3: agency decisions, letters and budgets run in Cloud Functions (decideSlice / settleLetter, tests/functions/sliceActions.test.js).
  // The repeat limit itself is checked by decideSlice (sliceActions.test.js).
  it('an agency can no longer approve from the browser, with or without its mark', async () => {
    await seed()
    await assertFails(approveWithMark(as('coord'), 's1', slice('r1'), approve))
    await assertFails(updateDoc(doc(as('coord'), 'applications', 's1'), approve))
  })

  it('no browser writes a mark, not even for its own agency', async () => {
    await seed()
    await assertFails(setDoc(doc(as('coord'), 'approvalMarks', 'dswd__pat'),
      { agencyId: 'dswd', patientId: 'pat', requestId: 'r1', sliceId: 's1', lastApprovedAt: serverTimestamp() }))
  })

  it('a mark is never changed or deleted, and only its agency reads it', async () => {
    await seed([mark('r1', daysAgo(10))])
    await assertSucceeds(getDoc(doc(as('coord'), 'approvalMarks', 'dswd__pat')))
    await assertSucceeds(getDoc(doc(as('coord'), 'approvalMarks', 'dswd__nobody')))
    await assertFails(getDoc(doc(as('coordX'), 'approvalMarks', 'dswd__pat')))
    await assertFails(getDoc(doc(as('pat'), 'approvalMarks', 'dswd__pat')))
    await assertFails(updateDoc(doc(as('coord'), 'approvalMarks', 'dswd__pat'), { lastApprovedAt: daysAgo(40) }))
  })

  it('reversing, issuing and redeeming a letter are refused from the browser too', async () => {
    await seed([
      ['applications/sA', slice('r1', { status: 'approved', amountApproved: 10000, glStatus: 'issued' })],
      ['applications/sB', slice('r2', { status: 'certificate', amountApproved: 10000, glStatus: 'issued' })],
    ])
    await assertFails(updateDoc(doc(as('coord'), 'applications', 'sA'), { status: 'reviewing', approvedAt: null }))
    await assertFails(updateDoc(doc(as('coord'), 'applications', 'sA'), { status: 'certificate' }))
    await assertFails(updateDoc(doc(as('coord'), 'applications', 'sB'), { glStatus: 'redeemed', redeemedAmount: 8500 }))
  })

  it('the agency still writes notes on its own slice, not on another agency\'s', async () => {
    await seed()
    const note = { caseNotes: [{ text: 'Called the patient', author: 'Coord', authorUid: 'coord', createdAt: '2026-11-22' }], updatedAt: serverTimestamp() }
    await assertSucceeds(updateDoc(doc(as('coord'), 'applications', 's1'), note))
    await assertFails(updateDoc(doc(as('coordX'), 'applications', 's1'), note))
    await assertFails(updateDoc(doc(as('coord'), 'applications', 's1'), { ...note, amountApproved: 1 }))
  })
})

describe('holding period', () => {
  const newReq = { patientId: 'pat', status: 'submitted', agencyIds: [], amountCommitted: 0, tenantId: A, submittedAt: serverTimestamp() }

  it('a patient on hold cannot file a request; without one they can', async () => {
    await seed([['users/pat', pat({ tenantId: A, tenantIds: [A], hospitalId: 'MAPA-2026-00001', cooldown: 1 })]])
    await assertFails(fileRequest(as('pat'), { reqId: 'rNew', code: 'MAPA-2026-00001', data: newReq }))
    await testEnv.withSecurityRulesDisabled(async (ctx) =>
      updateDoc(doc(ctx.firestore(), 'users', 'pat'), { cooldown: 0 }))
    await assertSucceeds(fileRequest(as('pat'), { reqId: 'rNew', code: 'MAPA-2026-00001', data: newReq }))
  })

  it("a patient on hold can't move to another hospital or lift it themselves", async () => {
    await seed([['users/pat', pat({ tenantId: A, tenantIds: [A], hospitalId: 'MAPA-2026-00001', cooldown: 1 })]])
    await assertFails(claimCode(as('pat'), { uid: 'pat', code: 'BGH-2026-00001', tenantId: B, tenantIds: [A, B] }))
    await assertFails(updateDoc(doc(as('pat'), 'users', 'pat'), { cooldown: 0 }))
  })

  it('only the current hospital sets or lifts it', async () => {
    await seed()
    await assertFails(updateDoc(doc(as('adminB'), 'users', 'pat'), { cooldown: 1 }))
    await assertSucceeds(updateDoc(doc(as('adminA'), 'users', 'pat'), { cooldown: 1 }))
    await assertSucceeds(updateDoc(doc(as('adminA'), 'users', 'pat'), { cooldown: 0 }))
  })
})
