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

describe('30-day approval cooldown (per agency)', () => {
  it('a first approval, written with its mark, succeeds', async () => {
    await seed()
    await assertSucceeds(approveWithMark(as('coord'), 's1', slice('r1'), approve))
  })

  it('an approval without the mark is refused', async () => {
    await seed()
    await assertFails(updateDoc(doc(as('coord'), 'applications', 's1'), approve))
  })

  it('a second approval for ANOTHER request within 30 days is refused', async () => {
    await seed([mark('r1', daysAgo(10))])
    await assertFails(approveWithMark(as('coord'), 's2', slice('r2'), approve))
  })

  it('after 30 days the agency may approve again', async () => {
    await seed([mark('r1', daysAgo(31))])
    await assertSucceeds(approveWithMark(as('coord'), 's2', slice('r2'), approve))
  })

  it('re-approving the SAME request (after a reversal) is allowed', async () => {
    await seed([mark('r1', daysAgo(2))])
    await assertSucceeds(approveWithMark(as('coord'), 's1', slice('r1'), approve))
  })

  it("another agency's recent approval does not block this agency", async () => {
    await seed([mark('r9', daysAgo(2), 'sOld', 'pcso')])
    await assertSucceeds(approveWithMark(as('coord'), 's1', slice('r1'), approve))
  })

  it("the mark can't be backdated or pointed at another request to dodge the check", async () => {
    await seed([mark('r1', daysAgo(10))])
    await assertFails(approveWithMark(as('coord'), 's2', slice('r2'), approve, { lastApprovedAt: daysAgo(40) }))
    await assertFails(approveWithMark(as('coord'), 's2', slice('r2'), approve, { requestId: 'r1' }))
  })

  it("a mark can't be written without a real approval, or for another agency", async () => {
    await seed()
    await assertFails(setDoc(doc(as('coord'), 'approvalMarks', 'dswd__pat'),
      { agencyId: 'dswd', patientId: 'pat', requestId: 'r1', sliceId: 's1', lastApprovedAt: serverTimestamp() }))
    await assertFails(approveWithMark(as('coordX'), 'sX', slice('r1', { agencyId: 'pcso' }), approve, { agencyId: 'dswd' }))
  })

  it('a mark is never deleted, and only its agency reads it', async () => {
    await seed([mark('r1', daysAgo(10))])
    await assertSucceeds(getDoc(doc(as('coord'), 'approvalMarks', 'dswd__pat')))
    await assertSucceeds(getDoc(doc(as('coord'), 'approvalMarks', 'dswd__nobody')))
    await assertFails(getDoc(doc(as('coordX'), 'approvalMarks', 'dswd__pat')))
    await assertFails(getDoc(doc(as('pat'), 'approvalMarks', 'dswd__pat')))
    await assertFails(updateDoc(doc(as('coord'), 'approvalMarks', 'dswd__pat'), { lastApprovedAt: daysAgo(40) }))
  })

  it('reversing, and certificate issue after approval, need no mark', async () => {
    await seed([
      ['applications/sA', slice('r1', { status: 'approved' })],
      ['applications/sB', slice('r2', { status: 'approved' })],
    ])
    await assertSucceeds(updateDoc(doc(as('coord'), 'applications', 'sA'), { status: 'reviewing', approvedAt: null }))
    await assertSucceeds(updateDoc(doc(as('coord'), 'applications', 'sB'), { status: 'certificate' }))
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

describe('Phase 1: repeat limit per agency, override with a reason', () => {
  const override = (reason, byUid = 'coord') => ({ ...approve, repeatOverride: { reason, byUid, at: serverTimestamp() } })
  const setAgency = (id, data) => testEnv.withSecurityRulesDisabled(async (ctx) =>
    updateDoc(doc(ctx.firestore(), 'agencies', id), data))
  const setType = (reqId, assistanceType) => testEnv.withSecurityRulesDisabled(async (ctx) =>
    updateDoc(doc(ctx.firestore(), 'requests', reqId), { assistanceType }))

  it('inside the limit, an approval with a written reason goes through', async () => {
    await seed([mark('r1', daysAgo(10))])
    await assertSucceeds(approveWithMark(as('coord'), 's2', slice('r2'), override('Second admission, new bill')))
  })

  it('the reason must be real, recent and the approver\'s own', async () => {
    await seed([mark('r1', daysAgo(10))])
    await assertFails(approveWithMark(as('coord'), 's2', slice('r2'), override('short')))
    await assertFails(approveWithMark(as('coord'), 's2', slice('r2'), override('Someone else approved this', 'other')))
    await assertFails(approveWithMark(as('coord'), 's2', slice('r2'),
      { ...approve, repeatOverride: { reason: 'Old reason reused here', byUid: 'coord', at: daysAgo(1) } }))
  })

  it('the agency sets its own number of days (0 = no limit)', async () => {
    await seed([mark('r1', daysAgo(40))])
    await setAgency('dswd', { repeatLimit: { days: 90, perType: false } })
    await assertFails(approveWithMark(as('coord'), 's2', slice('r2'), approve))
    await setAgency('dswd', { repeatLimit: { days: 0, perType: false } })
    await assertSucceeds(approveWithMark(as('coord'), 's2', slice('r2'), approve))
  })

  it('per assistance type: another type is free, the same type is limited', async () => {
    const medAt = daysAgo(10)
    await seed([['approvalMarks/dswd__pat', { agencyId: 'dswd', patientId: 'pat', requestId: 'r1', sliceId: 's1',
      lastApprovedAt: daysAgo(10), byType: { Medicines: { at: medAt, requestId: 'r1' } } }]])
    await setAgency('dswd', { repeatLimit: { days: 90, perType: true } })
    await setType('r2', 'Laboratory Tests')
    await assertSucceeds(approveWithMark(as('coord'), 's2', slice('r2'), approve,
      { byType: { Medicines: { at: medAt, requestId: 'r1' }, 'Laboratory Tests': { at: serverTimestamp(), requestId: 'r2' } } }))
  })

  it('per assistance type: the same type inside the limit is refused', async () => {
    await seed([['approvalMarks/dswd__pat', { agencyId: 'dswd', patientId: 'pat', requestId: 'r1', sliceId: 's1',
      lastApprovedAt: daysAgo(10), byType: { Medicines: { at: daysAgo(10), requestId: 'r1' } } }]])
    await setAgency('dswd', { repeatLimit: { days: 90, perType: true } })
    await setType('r2', 'Medicines')
    await assertFails(approveWithMark(as('coord'), 's2', slice('r2'), approve,
      { byType: { Medicines: { at: serverTimestamp(), requestId: 'r2' } } }))
  })

  it("byType can't be back-dated or written for another type", async () => {
    await seed([['approvalMarks/dswd__pat', { agencyId: 'dswd', patientId: 'pat', requestId: 'r1', sliceId: 's1',
      lastApprovedAt: daysAgo(100), byType: { Medicines: { at: daysAgo(10), requestId: 'r1' } } }]])
    await setType('r2', 'Laboratory Tests')
    await assertFails(approveWithMark(as('coord'), 's2', slice('r2'), approve,
      { byType: { Medicines: { at: daysAgo(200), requestId: 'r1' }, 'Laboratory Tests': { at: serverTimestamp(), requestId: 'r2' } } }))
  })
})

describe('Phase 1: redeemed amount', () => {
  it('an agency records what was actually billed, never more than approved', async () => {
    await seed([['applications/sA', slice('r1', { status: 'certificate', amountApproved: 10000, glStatus: 'issued' })]])
    const ref = doc(as('coord'), 'applications', 'sA')
    await assertFails(updateDoc(ref, { glStatus: 'redeemed', redeemedAmount: 12000 }))
    await assertFails(updateDoc(ref, { glStatus: 'redeemed', redeemedAmount: -1 }))
    await assertSucceeds(updateDoc(ref, { glStatus: 'redeemed', redeemedAmount: 8500 }))
  })
})