import { loadRules } from './helpers/rules.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { fileRequest } from './helpers/marketplace.js'

// Phase 2A (2026-11-16): outpatient requests at the hospital's own units, and
// the cap on what agencies together commit to one outpatient charge.
const A = 'hospital-1'
let testEnv
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-outpatient',
    firestore: { rules: loadRules(), host: 'localhost', port: 8080 },
  })
})
afterAll(async () => testEnv?.cleanup())

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const put = (p, d) => setDoc(doc(db, ...p.split('/')), d)
    await Promise.all([
      put('hospitals/hospital-1', { accessCodePrefix: 'MAPA', enabled: true }),
      put('users/pat', { role: 'patient', agencyId: null, rank: null, active: true, name: 'Pat', tenantId: A, tenantIds: [A], hospitalId: 'MAPA-2026-00001' }),
      put('hospitalIds/MAPA-2026-00001', { status: 'used', patId: 'pat', tenantId: A }),
      put('users/coord', { role: 'agency', agencyId: 'dswd' }),
      put('requests/out', { patientId: 'pat', tenantId: A, status: 'partially_funded', agencyIds: ['dswd'],
        careSetting: 'outpatient', careUnit: 'dialysis', amountNeeded: 5000, amountCommitted: 3000 }),
      put('requests/theirs', { patientId: 'someoneElse', tenantId: A, status: 'endorsed', agencyIds: ['dswd'], amountNeeded: 1000, amountCommitted: 0 }),
      put('requests/inp', { patientId: 'pat', tenantId: A, status: 'partially_funded', agencyIds: ['dswd'],
        amountNeeded: 5000, amountCommitted: 3000 }),
    ])
  })
})
const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const base = { patientId: 'pat', status: 'submitted', agencyIds: [], amountCommitted: 0, tenantId: A, submittedAt: serverTimestamp() }
const file = (data) => fileRequest(as('pat'), { reqId: 'rNew', code: 'MAPA-2026-00001', data: { ...base, ...data } })

describe('filing an outpatient request', () => {
  it('an outpatient at one of the hospital units can file', async () => {
    await assertSucceeds(file({ careSetting: 'outpatient', careUnit: 'dialysis', assistanceType: 'Dialysis', philhealthSessionsUsed: 40 }))
  })
  it('an admitted patient (or the older site, with no setting) can file as before', async () => {
    await assertSucceeds(file({ careSetting: 'inpatient' }))
  })
  it('an outpatient must name a hospital unit, and the setting must be known', async () => {
    await assertFails(file({ careSetting: 'outpatient' }))
    await assertFails(file({ careSetting: 'outpatient', careUnit: 'outside-pharmacy' }))
    await assertFails(file({ careSetting: 'home' }))
  })
  it('dialysis sessions must be a whole number in range', async () => {
    await assertFails(file({ careSetting: 'outpatient', careUnit: 'dialysis', philhealthSessionsUsed: 1.5 }))
    await assertFails(file({ careSetting: 'outpatient', careUnit: 'dialysis', philhealthSessionsUsed: 400 }))
  })
})

describe('outpatient funding cap', () => {
  it('agencies write no request totals from the browser (decideSlice checks the outpatient cap)', async () => {
    // Phase 2 PR 2.3: agency decisions, letters and budgets run in Cloud Functions (decideSlice / settleLetter, tests/functions/sliceActions.test.js).
    await assertFails(updateDoc(doc(as('coord'), 'requests', 'out'), { amountCommitted: 6000, status: 'fully_funded' }))
    await assertFails(updateDoc(doc(as('coord'), 'requests', 'out'), { amountCommitted: 5000, status: 'fully_funded' }))
    await assertFails(updateDoc(doc(as('coord'), 'requests', 'inp'), { amountCommitted: 6000, status: 'fully_funded' }))
  })
})

describe('documents added after filing (Phase 2C)', () => {
  const upload = (requestId) => setDoc(doc(as('pat'), 'documents', 'late-' + requestId),
    { patientId: 'pat', tenantId: A, status: 'pending', name: 'Medical Certificate', requestId, addedAfterFiling: true })
  it('a patient links an upload to their own request only', async () => {
    await assertSucceeds(upload('out'))
    await assertFails(upload('theirs'))
  })
})
