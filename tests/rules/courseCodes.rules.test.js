import { loadRules } from './helpers/rules.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { fileRequest } from './helpers/marketplace.js'
import { issueCode } from './helpers/codes.js'

// Phase 3A (2026-11-16): one access code per course of treatment. A code
// issued with courseUntil backs the patient's requests in turn until then.
const A = 'hospital-1'
const DAY = 86400000
const at = (days) => Timestamp.fromMillis(Date.now() + days * DAY)
let testEnv
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-course-codes',
    firestore: { rules: loadRules(), host: 'localhost', port: 8080 },
  })
})
afterAll(async () => testEnv?.cleanup())

async function seed(code = {}) {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const put = (p, d) => setDoc(doc(db, ...p.split('/')), d)
    await Promise.all([
      put('hospitals/hospital-1', { accessCodePrefix: 'MAPA', enabled: true }),
      put('users/staff', { role: 'staff_admin', tenantId: A }),
      put('users/pat', { role: 'patient', agencyId: null, rank: null, active: true, name: 'Pat', tenantId: A, tenantIds: [A], hospitalId: 'MAPA-2026-00001' }),
      put('requests/r1', { patientId: 'pat', tenantId: A, status: 'closed', agencyIds: [], patientHospitalId: 'MAPA-2026-00001' }),
      put('hospitalIds/MAPA-2026-00001', { status: 'used', patId: 'pat', tenantId: A, bound: true, requestId: 'r1', ...code }),
    ])
  })
}
beforeEach(async () => testEnv.clearFirestore())
const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const next = () => fileRequest(as('pat'), { reqId: 'r2', code: 'MAPA-2026-00001',
  data: { patientId: 'pat', status: 'submitted', agencyIds: [], amountCommitted: 0, tenantId: A, submittedAt: serverTimestamp() } })

describe('course-of-treatment codes', () => {
  it('a course code backs the next request while the course runs', async () => {
    await seed({ courseUntil: at(30) })
    await assertSucceeds(next())
  })
  it('an ordinary code backs only one request', async () => {
    await seed()
    await assertFails(next())
  })
  it('an ended course backs no more requests', async () => {
    await seed({ courseUntil: at(-1) })
    await assertFails(next())
  })
  it('issuing a course code runs on the server now (PR 3.4); the length limit is server-checked', async () => {
    await seed()
    // Browsers no longer issue codes at all — the ~3-month course cap now lives
    // in issueAccessCode (tests/functions/codeActions.test.js).
    await assertFails(issueCode(as('staff'), 'MAPA-2026-00010', { tenantId: A, extra: { courseUntil: at(60) } }))
  })
  it('staff can end a course early but not extend it', async () => {
    await seed({ courseUntil: at(30) })
    const ref = doc(as('staff'), 'hospitalIds', 'MAPA-2026-00001')
    await assertFails(updateDoc(ref, { courseUntil: at(60) }))
    await assertSucceeds(updateDoc(ref, { courseUntil: Timestamp.now(), courseEndedAt: serverTimestamp(), courseEndedBy: 'Staff' }))
  })
})
