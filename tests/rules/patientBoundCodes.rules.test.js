import { loadRules } from './helpers/rules.js'
import { issueCode, issuedRecord } from './helpers/codes.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { codeProof } from '../../src/utils/codeIssue.js'

// Patient-bound access codes (2026-11-15): a code is issued to one named
// patient; only that patient's last name + birthdate can claim it, and the
// account then carries the name the hospital recorded.
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

// Register the way Register.jsx does, with a given proof / name / birthdate.
function register(uid, { lastName = 'Dela Cruz', birthdate = '1990-05-01', name = ANA.name, profileBirthdate = birthdate } = {}) {
  const db = as(uid)
  const b = writeBatch(db)
  b.update(doc(db, 'hospitalIds', CODE), { status: 'used', patId: uid, date: 'Nov 15, 2026', time: '' })
  b.set(doc(db, 'hospitalIds', CODE, 'privateInfo', 'details'), {
    usedBy: name, usedById: uid, createdAt: serverTimestamp(), proof: codeProof(lastName, birthdate),
  })
  b.set(doc(db, 'users', uid), {
    role: 'patient', agencyId: null, name, birthdate: profileBirthdate, hospitalId: CODE, tenantId: A, tenantIds: [A],
  })
  return b.commit()
}

describe('issuing', () => {
  it('the Hospital Admin issues a code with the patient record in one batch', async () => {
    await assertSucceeds(issueCode(as('superA'), 'AAA-2026-00002', { tenantId: A, issued: ANA }))
  })
  it('a Staff Admin may issue too (desk work, 2026-11-15), and the record must name who issued it', async () => {
    await assertSucceeds(issueCode(as('adminA'), 'AAA-2026-00007', { tenantId: A, issued: { ...ANA, issuedByUid: 'adminA' } }))
    await assertFails(issueCode(as('adminA'), 'AAA-2026-00008', { tenantId: A, issued: { ...ANA, issuedByUid: 'superA' } }))
  })
  it('a blank code, or one for another hospital, is refused', async () => {
    await assertFails(setDoc(doc(as('superA'), 'hospitalIds', 'AAA-2026-00003'), { status: 'available', patId: null, tenantId: A }))
    await assertFails(issueCode(as('superB'), 'AAA-2026-00004', { tenantId: A, issued: ANA }))
  })
  it('the issued record must have a well-formed proof for its birthdate', async () => {
    await assertFails(issueCode(as('superA'), 'AAA-2026-00005', { tenantId: A, issued: { ...ANA, proof: 'DELACRUZ|1999-01-01' } }))
    await assertFails(issueCode(as('superA'), 'AAA-2026-00006', { tenantId: A, issued: { ...ANA, birthdate: '05/01/1990' } }))
  })
  it("only the hospital's staff read who a code was issued to", async () => {
    await assertSucceeds(getDoc(doc(as('adminA'), 'hospitalIds', CODE, 'privateInfo', 'issued')))
    await assertFails(getDoc(doc(as('superB'), 'hospitalIds', CODE, 'privateInfo', 'issued')))
    await assertFails(getDoc(doc(as('existing'), 'hospitalIds', CODE, 'privateInfo', 'issued')))
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'hospitalIds', CODE, 'privateInfo', 'issued')))
  })
})

describe('registering with a patient-bound code', () => {
  it('works with the matching last name + birthdate and the recorded name', async () => {
    await assertSucceeds(register('newPat'))
  })
  it('the last name is compared on letters only', async () => {
    await assertSucceeds(register('newPat', { lastName: 'delacruz' }))
  })
  it('a different last name or birthdate cannot claim it', async () => {
    await assertFails(register('newPat', { lastName: 'Santos' }))
    await assertFails(register('newPat', { birthdate: '1991-05-01' }))
  })
  it('the account must carry the name and birthdate the hospital recorded', async () => {
    await assertFails(register('newPat', { name: 'Someone Else' }))
    await assertFails(register('newPat', { profileBirthdate: '1991-05-01' }))
  })
  it('the claimant still cannot read the issued record afterwards', async () => {
    await register('newPat')
    await assertFails(getDoc(doc(as('newPat'), 'hospitalIds', CODE, 'privateInfo', 'issued')))
  })
})

describe('filing at another hospital (marketplace claim)', () => {
  const claim = (proof) => {
    const db = as('existing')
    const b = writeBatch(db)
    b.update(doc(db, 'hospitalIds', CODE), { status: 'used', patId: 'existing', date: 'x', time: '' })
    b.set(doc(db, 'hospitalIds', CODE, 'privateInfo', 'details'), { usedBy: 'Ana Dela Cruz', usedById: 'existing', createdAt: serverTimestamp(), ...(proof ? { proof } : {}) })
    b.update(doc(db, 'users', 'existing'), { tenantId: A, tenantIds: [B, A], hospitalId: CODE })
    return b.commit()
  }
  it('needs the matching proof', async () => {
    await assertFails(claim(null))
    await assertFails(claim(codeProof('Santos', '1990-05-01')))
    await assertSucceeds(claim(codeProof('Dela Cruz', '1990-05-01')))
  })
})

describe('correcting the record', () => {
  it('staff fix a typo while the code is unclaimed, not after', async () => {
    const ref = doc(as('superA'), 'hospitalIds', CODE, 'privateInfo', 'issued')
    await assertSucceeds(updateDoc(ref, { contact: '09171234567', updatedByUid: 'superA' }))
    await register('newPat')
    await assertFails(updateDoc(ref, { contact: '09998887777', updatedByUid: 'superA' }))
  })
})

describe('blank codes printed before patient-bound issuing', () => {
  const seedBlank = async (env) => env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'hospitalIds', 'AAA-2026-00009'), { status: 'available', patId: null, tenantId: A })
  })
  const claimBlank = (env) => {
    const db = env.authenticatedContext('blankPat').firestore()
    const b = writeBatch(db)
    b.update(doc(db, 'hospitalIds', 'AAA-2026-00009'), { status: 'used', patId: 'blankPat', date: 'x', time: '' })
    b.set(doc(db, 'hospitalIds', 'AAA-2026-00009', 'privateInfo', 'details'), { usedBy: 'Blank', usedById: 'blankPat', createdAt: serverTimestamp() })
    b.set(doc(db, 'users', 'blankPat'), { role: 'patient', agencyId: null, name: 'Blank', hospitalId: 'AAA-2026-00009', tenantId: A, tenantIds: [A] })
    return b.commit()
  }
  it('still work before the cutoff', async () => {
    await seedBlank(testEnv)
    await assertSucceeds(claimBlank(testEnv))
  })
  it('stop after the cutoff', async () => {
    const past = await initializeTestEnvironment({
      projectId: 'mapa-rules-test-bound-codes-past',
      firestore: { rules: loadRules({ cutoff: 'past' }), host: 'localhost', port: 8080 },
    })
    try {
      await past.clearFirestore()
      await past.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'hospitals', A), { accessCodePrefix: 'AAA', enabled: true })
      })
      await seedBlank(past)
      await assertFails(claimBlank(past))
    } finally { await past.cleanup() }
  })
})

// 2026-11-15 access-code review: staff could unbind, re-assign or rewrite a
// patient-bound code. Only revoke / delete by the Hospital Admin remain.
describe('staff cannot tamper with an issued code', () => {
  const codeRef = (u) => doc(as(u), 'hospitalIds', CODE)
  const issuedRef = (u) => doc(as(u), 'hospitalIds', CODE, 'privateInfo', 'issued')

  it('nobody on staff can unbind it or hand it to an account', async () => {
    for (const u of ['adminA', 'superA']) {
      await assertFails(updateDoc(codeRef(u), { bound: false }))
      await assertFails(updateDoc(codeRef(u), { status: 'used', patId: 'someUid' }))
      await assertFails(updateDoc(codeRef(u), { tenantId: B }))
    }
  })
  it('a Staff Admin cannot rewrite or delete who it was issued to', async () => {
    await assertFails(updateDoc(issuedRef('adminA'), { name: 'Other Person', updatedByUid: 'adminA' }))
    await assertFails(deleteDoc(issuedRef('adminA')))
  })
  it('the Hospital Admin may correct it only with their name on the change, and cannot leave it dangling', async () => {
    await assertFails(updateDoc(issuedRef('superA'), { contact: '09171234567' }))
    await assertSucceeds(updateDoc(issuedRef('superA'), { contact: '09171234567', updatedByUid: 'superA', updatedBy: 'Super A' }))
    await assertFails(deleteDoc(issuedRef('superA')))
  })
  it('the Hospital Admin can still revoke a claimed code and delete an unused one', async () => {
    await register('newPat')
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
    await register('newPat')
    await assertFails(updateDoc(codeRef('adminA'), { status: 'available', patId: null, date: '', time: '', revokedAt: serverTimestamp() }))
  })
})
