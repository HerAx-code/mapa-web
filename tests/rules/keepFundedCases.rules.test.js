import { loadRules } from './helpers/rules.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, deleteDoc } from 'firebase/firestore'

// 2026-11-15 intake review: "permanently delete patient" used to erase
// endorsed and funded cases too. An endorsed/funded request, its slices and
// its Guarantee Letters are financial records and are never deleted; only
// the Hospital Admin may delete a request that never reached an agency.
const A = 'hosp-a'
let env

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-keep-funded',
    firestore: { rules: loadRules(), host: 'localhost', port: 8080 },
  })
})
afterAll(async () => env?.cleanup())
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const put = (p, d) => setDoc(doc(db, ...p.split('/')), d)
    await Promise.all([
      put('users/superA', { role: 'super_admin', tenantId: A }),
      put('users/staffA', { role: 'staff_admin', tenantId: A }),
      put('users/superB', { role: 'super_admin', tenantId: 'hosp-b' }),
      put('requests/draft', { patientId: 'p', status: 'under_review', agencyIds: [], amountCommitted: 0, tenantId: A }),
      put('requests/endorsed', { patientId: 'p', status: 'endorsed', agencyIds: ['dswd'], amountCommitted: 0, tenantId: A }),
      put('requests/funded', { patientId: 'p', status: 'closed', agencyIds: [], amountCommitted: 5000, tenantId: A }),
      put('applications/slice', { patientId: 'p', requestId: 'endorsed', agencyId: 'dswd', status: 'approved', tenantId: A }),
      put('certificates/slice', { patientId: 'p', agencyId: 'dswd', appId: 'slice', tenantId: A }),
    ])
  })
})
const del = (u, p) => deleteDoc(doc(env.authenticatedContext(u).firestore(), ...p.split('/')))

describe('keeping funded cases', () => {
  it('the Hospital Admin may delete a request that never reached an agency', async () => {
    await assertSucceeds(del('superA', 'requests/draft'))
  })
  it('an endorsed or funded request is never deleted', async () => {
    await assertFails(del('superA', 'requests/endorsed'))
    await assertFails(del('superA', 'requests/funded'))
  })
  it('a Staff Admin or another hospital cannot delete requests', async () => {
    await assertFails(del('staffA', 'requests/draft'))
    await assertFails(del('superB', 'requests/draft'))
  })
  it('slices and Guarantee Letters are never deleted', async () => {
    await assertFails(del('superA', 'applications/slice'))
    await assertFails(del('superA', 'certificates/slice'))
  })
})
