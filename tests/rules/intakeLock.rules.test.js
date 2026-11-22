import { loadRules } from './helpers/rules.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc } from 'firebase/firestore'

// Phase 3 PR 3.2 (P3-B / D6, gap M7): the intake sheet locks at endorsement,
// like coverage. After that it changes only through the amendAssessment
// function; no browser — staff or patient — writes it. Amendments are recorded
// only by the function.
const A = 'hospital-1'
let testEnv
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-intake-lock',
    firestore: { rules: loadRules(), host: 'localhost', port: 8080 },
  })
})
afterAll(async () => testEnv?.cleanup())

const sheet = { householdSize: 3, monthlyIncome: 5000, diagnosis: 'CKD', recommendation: 'Assist', meansTestCategory: 'indigent_c3' }
beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const put = (p, d) => setDoc(doc(db, ...p.split('/')), d)
    await Promise.all([
      put('users/sw', { role: 'staff_admin', tenantId: A, name: 'SW' }),
      put('users/pat', { role: 'patient', agencyId: null, rank: null, active: true, name: 'Pat', tenantId: A, tenantIds: [A] }),
      put('requests/open', { patientId: 'pat', tenantId: A, status: 'under_review', agencyIds: [], amountCommitted: 0, intakeSheet: sheet }),
      put('requests/endorsed', { patientId: 'pat', tenantId: A, status: 'endorsed', agencyIds: ['dswd'], amountCommitted: 0, intakeSheet: sheet }),
    ])
  })
})
const as = (uid) => testEnv.authenticatedContext(uid).firestore()

describe('the intake sheet locks at endorsement', () => {
  it('before endorsement staff edit the assessment and the patient their facts', async () => {
    await assertSucceeds(updateDoc(doc(as('sw'), 'requests', 'open'), { 'intakeSheet.recommendation': 'Assist with medicines' }))
    await assertSucceeds(updateDoc(doc(as('pat'), 'requests', 'open'), { 'intakeSheet.diagnosis': 'CKD stage 5' }))
  })

  it('after endorsement neither can (amendAssessment only)', async () => {
    await assertFails(updateDoc(doc(as('sw'), 'requests', 'endorsed'), { 'intakeSheet.recommendation': 'Changed quietly' }))
    await assertFails(updateDoc(doc(as('sw'), 'requests', 'endorsed'), { 'intakeSheet.meansTestCategory': 'capable' }))
    await assertFails(updateDoc(doc(as('pat'), 'requests', 'endorsed'), { 'intakeSheet.monthlyIncome': 1 }))
  })

  it('staff can still write other case fields after endorsement (the certificate pointer)', async () => {
    await assertSucceeds(updateDoc(doc(as('sw'), 'requests', 'endorsed'), { eligibilityCert: { id: 'c1', status: 'generated' } }))
  })

  it('no browser writes the amendment record, even before endorsement', async () => {
    await assertFails(updateDoc(doc(as('sw'), 'requests', 'open'), { 'intakeSheet.amendments': [{ reason: 'forged' }] }))
  })
})
