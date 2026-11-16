import { loadRules } from './helpers/rules.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, deleteDoc, getDocs, collection, query, where } from 'firebase/firestore'

// Owner decisions 2026-11-16:
//  - no one deletes a conversation or its messages (case record);
//  - Staff Admins see each case's timeline (auditLog entries of their own
//    hospital's requests), but not the full audit log.
const A = 'hospital-1'
const B = 'bgh'
let testEnv
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-role-decisions',
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
      put('users/superA', { role: 'super_admin', tenantId: A }),
      put('users/staffA', { role: 'staff_admin', tenantId: A }),
      put('users/staffB', { role: 'staff_admin', tenantId: B }),
      put('users/coord', { role: 'agency', agencyId: 'dswd' }),
      put('users/pat', { role: 'patient', tenantId: A, tenantIds: [A] }),
      put('conversations/c1', { participants: ['staffA', 'pat'], tenantId: A }),
      put('conversations/c1/messages/m1', { from: 'staffA', text: 'Hello' }),
      put('conversations/c2', { participants: ['coord', 'staffA'] }),
      put('requests/rA', { patientId: 'pat', tenantId: A, status: 'under_review', agencyIds: [] }),
      put('auditLog/onCase', { actorId: 'superA', details: 'verified', tenantId: A, requestId: 'rA' }),
      put('auditLog/agencyOnCase', { actorId: 'coord', details: 'approved', requestId: 'rA' }),
      put('auditLog/general', { actorId: 'superA', details: 'account created', tenantId: A }),
    ])
  })
})
const as = (uid) => testEnv.authenticatedContext(uid).firestore()

describe('conversations are never deleted', () => {
  it('no participant or hospital staff can delete a thread or a message', async () => {
    for (const uid of ['pat', 'staffA', 'superA']) {
      await assertFails(deleteDoc(doc(as(uid), 'conversations', 'c1')))
      await assertFails(deleteDoc(doc(as(uid), 'conversations', 'c1', 'messages', 'm1')))
    }
    await assertFails(deleteDoc(doc(as('coord'), 'conversations', 'c2')))
  })
})

describe('Case Timeline for Staff Admins', () => {
  const timeline = (uid) => getDocs(query(collection(as(uid), 'auditLog'), where('requestId', '==', 'rA')))
  it('a Staff Admin reads the timeline of their own hospital\'s request', async () => {
    await assertSucceeds(timeline('staffA'))
  })
  it('but not another hospital\'s, nor the full audit log', async () => {
    await assertFails(timeline('staffB'))
    await assertFails(getDocs(query(collection(as('staffA'), 'auditLog'), where('tenantId', '==', A))))
  })
})
