import { loadRules } from './helpers/rules.js'
import { issueCode, issuedRecord } from './helpers/codes.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { codeProof } from '../../src/utils/codeIssue.js'

// Patient-bound access codes. Phase 3 PR 3.4: issuing and claiming run on the
// server (issueAccessCode / claimAccessCode). The rules here prove the browser
// can no longer issue, claim or write privateInfo; the positive paths (proof
// match, letters-only, blank-code cutoff, open-code warning, counter) live in
// tests/functions/codeActions.test.js. The rules still govern who READS the
// issued record and the Hospital Admin's revoke / delete.
const A = 'hosp-a'
const B = 'hosp-b'
const CODE = 'AAA-2026-00001'
const ANA = issuedRecord({ firstName: 'Ana', lastName: 'Dela Cruz', birthdate: '1990-05-01', issuedByUid: 'superA' })
let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-bound-codes',
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
      put('users/superA', { role: 'super_admin', tenantId: A }),
      put('users/adminA', { role: 'staff_admin', tenantId: A }),
      put('users/superB', { role: 'super_admin', tenantId: B }),
      put('users/existing', { role: 'patient', name: 'Ana Dela Cruz', tenantId: B, tenantIds: [B], hospitalId: 'BBB-2026-00001' }),
      put(`hospitals/${A}`, { accessCodePrefix: 'AAA', enabled: true }),
      put(`hospitals/${B}`, { accessCodePrefix: 'BBB', enabled: true }),
      put('accessCodePrefixes/AAA', { tenantId: A }),
      put(`hospitalIds/${CODE}`, { status: 'available', patId: null, bound: true, tenantId: A }),
      put(`hospitalIds/${CODE}/privateInfo/issued`, ANA),
    ])
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()

// Seed the code into a CLAIMED state (as claimAccessCode would, server-side), so
// the browser-side revoke / delete rules can be tested without a browser claim.
const seedClaimed = (uid = 'newPat') => testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'hospitalIds', CODE), { status: 'used', patId: uid, bound: true, tenantId: A })
  await setDoc(doc(db, 'hospitalIds', CODE, 'privateInfo', 'details'), { usedBy: ANA.name, usedById: uid, proof: ANA.proof })
  await setDoc(doc(db, 'users', uid), { role: 'patient', agencyId: null, name: ANA.name, birthdate: '1990-05-01', hospitalId: CODE, tenantId: A, tenantIds: [A] })
})

// The old browser registration batch (claim the code + create the profile) —
// now refused.
function register(uid) {
  const db = as(uid)
  const b = writeBatch(db)
  b.update(doc(db, 'hospitalIds', CODE), { status: 'used', patId: uid, date: 'Nov 15, 2026', time: '' })
  b.set(doc(db, 'hospitalIds', CODE, 'privateInfo', 'details'), {
    usedBy: ANA.name, usedById: uid, createdAt: serverTimestamp(), proof: codeProof('Dela Cruz', '1990-05-01'),
  })
  b.set(doc(db, 'users', uid), {
    role: 'patient', agencyId: null, name: ANA.name, birthdate: '1990-05-01', hospitalId: CODE, tenantId: A, tenantIds: [A],
  })
  return b.commit()
}

describe('issuing and claiming run on the server now (PR 3.4)', () => {
  it('a browser can no longer issue a code', async () => {
    await assertFails(issueCode(as('superA'), 'AAA-2026-00002', { tenantId: A, issued: ANA }))
    await assertFails(issueCode(as('adminA'), 'AAA-2026-00007', { tenantId: A, issued: { ...ANA, issuedByUid: 'adminA' } }))
  })
  it('a browser can no longer claim a code (status / patId) or write privateInfo', async () => {
    await assertFails(register('newPat'))
    await assertFails(updateDoc(doc(as('existing'), 'hospitalIds', CODE), { status: 'used', patId: 'existing' }))
    await assertFails(setDoc(doc(as('superA'), 'hospitalIds', 'AAA-2026-00002', 'privateInfo', 'issued'), { ...ANA }))
    await assertFails(setDoc(doc(as('newPat'), 'hospitalIds', CODE, 'privateInfo', 'details'), { usedBy: 'x', usedById: 'newPat' }))
  })
})

describe("only the hospital's staff read who a code was issued to", () => {
  it('its own gateway staff can; another hospital, the patient, and the public cannot', async () => {
    await assertSucceeds(getDoc(doc(as('adminA'), 'hospitalIds', CODE, 'privateInfo', 'issued')))
    await assertFails(getDoc(doc(as('superB'), 'hospitalIds', CODE, 'privateInfo', 'issued')))
    await assertFails(getDoc(doc(as('existing'), 'hospitalIds', CODE, 'privateInfo', 'issued')))
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'hospitalIds', CODE, 'privateInfo', 'issued')))
  })
})

// 2026-11-15 access-code review + PR 3.4: staff could unbind, re-assign or
// rewrite a patient-bound code; now only the Hospital Admin's revoke / delete
// remain, and the issued record is never edited from a browser.
describe('staff cannot tamper with an issued code', () => {
  const codeRef = (u) => doc(as(u), 'hospitalIds', CODE)
  const issuedRef = (u) => doc(as(u), 'hospitalIds', CODE, 'privateInfo', 'issued')

  it('nobody on staff can unbind it, hand it to an account, or move its hospital', async () => {
    for (const u of ['adminA', 'superA']) {
      await assertFails(updateDoc(codeRef(u), { bound: false }))
      await assertFails(updateDoc(codeRef(u), { status: 'used', patId: 'someUid' }))
      await assertFails(updateDoc(codeRef(u), { tenantId: B }))
    }
  })
  it('nobody — not even the Hospital Admin — edits or deletes the issued record on its own', async () => {
    await assertFails(updateDoc(issuedRef('adminA'), { name: 'Other Person' }))
    await assertFails(updateDoc(issuedRef('superA'), { contact: '09171234567', updatedByUid: 'superA', updatedBy: 'Super A' }))
    await assertFails(deleteDoc(issuedRef('adminA')))
    await assertFails(deleteDoc(issuedRef('superA')))
  })
  it('the Hospital Admin can still revoke a claimed code and delete it', async () => {
    await seedClaimed('newPat')
    const db = as('superA')
    const b = writeBatch(db)
    b.update(doc(db, 'hospitalIds', CODE), { status: 'available', patId: null, date: '', time: '', revokedAt: serverTimestamp() })
    b.delete(doc(db, 'hospitalIds', CODE, 'privateInfo', 'details'))
    await assertSucceeds(b.commit())
    const d = writeBatch(db)
    d.delete(doc(db, 'hospitalIds', CODE, 'privateInfo', 'issued'))
    d.delete(doc(db, 'hospitalIds', CODE))
    await assertSucceeds(d.commit())
  })
  it('a Staff Admin cannot revoke', async () => {
    await seedClaimed('newPat')
    await assertFails(updateDoc(codeRef('adminA'), { status: 'available', patId: null, date: '', time: '', revokedAt: serverTimestamp() }))
  })
})

describe('accessCodeCounters are server-only (PR 3.4)', () => {
  it('no browser, not even the Hospital Admin, can read or write the issuing counter', async () => {
    await assertFails(getDoc(doc(as('superA'), 'accessCodeCounters', 'AAA__2026')))
    await assertFails(setDoc(doc(as('superA'), 'accessCodeCounters', 'AAA__2026'), { next: 5 }))
  })
})
