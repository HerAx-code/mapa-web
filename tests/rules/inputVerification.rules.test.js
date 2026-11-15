import { loadRules } from './helpers/rules.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, deleteDoc, runTransaction } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

// Input verification Phase 1 (reports/Patient input verification.md):
// duplicate-account flags are read only by the patient's own hospital and
// written only by the server; bill-number keys stay inside one hospital and
// moving one to another request needs a written reason.
const A = 'hospital-a'
const B = 'hospital-b'
let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-input-verification',
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
      put('users/adminA', { role: 'staff_admin', tenantId: A }),
      put('users/adminB', { role: 'staff_admin', tenantId: B }),
      put('users/coord', { role: 'agency', agencyId: 'dswd' }),
      put('users/pat', { role: 'patient', tenantId: A, tenantIds: [A] }),
      put('users/plat', { role: 'platform_admin' }),
      put(`identityFlags/${A}__pat`, { uid: 'pat', tenantId: A, matches: [] }),
      put('identityIndex/h1', { kind: 'phone', uids: ['pat'] }),
      put(`billKeys/${A}__SOA1`, { tenantId: A, billNumber: 'SOA1', requestId: 'r1', requestRef: 'REQ-1', by: 'A', byUid: 'adminA' }),
    ])
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const key = (billNumber, requestId, extra = {}) => ({
  tenantId: A, billNumber, requestId, requestRef: 'REQ', by: 'Admin A', byUid: 'adminA', ...extra,
})

describe('identityFlags', () => {
  it('the patient’s own hospital reads its flag; a missing flag is readable too (not "checked yet")', async () => {
    await assertSucceeds(getDoc(doc(as('adminA'), 'identityFlags', `${A}__pat`)))
    await assertSucceeds(getDoc(doc(as('adminA'), 'identityFlags', `${A}__nobody`)))
  })
  it('another hospital, agencies, the patient and the platform admin cannot read it', async () => {
    await assertFails(getDoc(doc(as('adminB'), 'identityFlags', `${A}__pat`)))
    await assertFails(getDoc(doc(as('coord'), 'identityFlags', `${A}__pat`)))
    await assertFails(getDoc(doc(as('pat'), 'identityFlags', `${A}__pat`)))
    await assertFails(getDoc(doc(as('plat'), 'identityFlags', `${A}__pat`)))
  })
  it('no client writes flags or reads the hash index', async () => {
    await assertFails(setDoc(doc(as('adminA'), 'identityFlags', `${A}__pat`), { uid: 'pat', tenantId: A, matches: [] }))
    await assertFails(getDoc(doc(as('adminA'), 'identityIndex', 'h1')))
    await assertFails(getDoc(doc(as('adminA'), 'identityIndexByUser', 'pat')))
  })
})

describe('hospitalSettings (verification-call policy)', () => {
  const policy = (extra = {}) => ({ tenantId: A, interviewAboveAmount: 50000, interviewOnDuplicate: true, updatedBy: 'S', ...extra })
  it('the Hospital Admin sets it; its own staff read it', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'users', 'superA'), { role: 'super_admin', tenantId: A }))
    await assertSucceeds(setDoc(doc(as('superA'), 'hospitalSettings', A), policy()))
    await assertSucceeds(setDoc(doc(as('superA'), 'hospitalSettings', A), policy({ interviewAboveAmount: null })))
    await assertSucceeds(setDoc(doc(as('superA'), 'hospitalSettings', A), policy({ secondPersonAboveAmount: 100000 })))
    await assertSucceeds(setDoc(doc(as('superA'), 'hospitalSettings', A), policy({ secondPersonAboveAmount: null })))
    await assertSucceeds(getDoc(doc(as('adminA'), 'hospitalSettings', A)))
  })
  it('patients, agencies and other hospitals cannot read it', async () => {
    await assertFails(getDoc(doc(as('pat'), 'hospitalSettings', A)))
    await assertFails(getDoc(doc(as('coord'), 'hospitalSettings', A)))
    await assertFails(getDoc(doc(as('adminB'), 'hospitalSettings', A)))
  })
  it('staff admins, other hospitals and bad values cannot write it', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'users', 'superA'), { role: 'super_admin', tenantId: A }))
    await assertFails(setDoc(doc(as('adminA'), 'hospitalSettings', A), policy()))
    await assertFails(setDoc(doc(as('adminB'), 'hospitalSettings', A), policy()))
    await assertFails(setDoc(doc(as('superA'), 'hospitalSettings', A), policy({ interviewAboveAmount: 0 })))
    await assertFails(setDoc(doc(as('superA'), 'hospitalSettings', A), policy({ interviewAboveAmount: '5000' })))
    await assertFails(setDoc(doc(as('superA'), 'hospitalSettings', A), policy({ extra: 1 })))
    await assertFails(setDoc(doc(as('superA'), 'hospitalSettings', A), policy({ secondPersonAboveAmount: -5 })))
  })
})

describe('billKeys', () => {
  it('staff claim a new bill number in their own hospital', async () => {
    await assertSucceeds(setDoc(doc(as('adminA'), 'billKeys', `${A}__SOA2`), key('SOA2', 'r2')))
  })
  it('the key must name the writer’s hospital and match its id', async () => {
    await assertFails(setDoc(doc(as('adminB'), 'billKeys', `${A}__SOA2`), { ...key('SOA2', 'r2'), tenantId: A, byUid: 'adminB' }))
    await assertFails(setDoc(doc(as('adminA'), 'billKeys', `${A}__SOA2`), key('OTHER', 'r2')))
    await assertFails(setDoc(doc(as('adminA'), 'billKeys', `${A}__SOA2`), key('SOA2', 'r2', { byUid: 'someoneElse' })))
    await assertFails(setDoc(doc(as('adminA'), 'billKeys', `${A}__SOA2`), key('SOA2', 'r2', { patientName: 'x' })))
  })
  it('another hospital cannot read or probe a hospital’s bill numbers', async () => {
    await assertFails(getDoc(doc(as('adminB'), 'billKeys', `${A}__SOA1`)))
    await assertFails(getDoc(doc(as('adminB'), 'billKeys', `${A}__NOPE`)))
    await assertFails(getDoc(doc(as('coord'), 'billKeys', `${A}__SOA1`)))
  })
  it('re-confirming on the same request is fine; moving to another request needs a reason', async () => {
    await assertSucceeds(setDoc(doc(as('adminA'), 'billKeys', `${A}__SOA1`), key('SOA1', 'r1')))
    await assertFails(setDoc(doc(as('adminA'), 'billKeys', `${A}__SOA1`), key('SOA1', 'r9')))
    await assertFails(setDoc(doc(as('adminA'), 'billKeys', `${A}__SOA1`), key('SOA1', 'r9', { overrideReason: 'x', previousRequestId: 'r1' })))
    await assertFails(setDoc(doc(as('adminA'), 'billKeys', `${A}__SOA1`), key('SOA1', 'r9', { overrideReason: 'refiled after close', previousRequestId: 'rX' })))
    await assertSucceeds(setDoc(doc(as('adminA'), 'billKeys', `${A}__SOA1`), key('SOA1', 'r9', { overrideReason: 'refiled after close', previousRequestId: 'r1' })))
  })
  it('works inside the confirmation transaction', async () => {
    const db = as('adminA')
    await assertSucceeds(runTransaction(db, async (tx) => {
      const ref = doc(db, 'billKeys', `${A}__SOA3`)
      await tx.get(ref)
      tx.set(ref, key('SOA3', 'r3'))
    }))
  })
  it('a key is never deleted', async () => {
    await assertFails(deleteDoc(doc(as('adminA'), 'billKeys', `${A}__SOA1`)))
  })
})
