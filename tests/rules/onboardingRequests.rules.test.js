import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, updateDoc, deleteDoc, getDocs, collection, serverTimestamp } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

// The public "For hospitals" page: a hospital asks to join the network. A
// public write surface, so: one request per (anonymous) session, pinned shape,
// platform-admin-only reads and pipeline.
let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-onboarding',
    firestore: {
      rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  })
})
afterAll(async () => testEnv?.cleanup())

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', 'plat'), { role: 'platform_admin' })
    await setDoc(doc(db, 'users', 'superA'), { role: 'super_admin', tenantId: 'hospital-1' })
    await setDoc(doc(db, 'onboardingRequests', 'old'), { hospitalName: 'Davao Regional', status: 'new' })
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const req = (over = {}) => ({
  hospitalName: 'Davao Regional Medical Center', hospitalType: 'DOH-retained', region: 'Region XI',
  contactName: 'Dr. Ana Reyes', email: 'mss@drmc.example', message: 'We run a Malasakit Center.',
  status: 'new', createdAt: serverTimestamp(), ...over,
})

describe('onboardingRequests — public create, locked down', () => {
  it('a signed-in (anonymous) visitor files one request under their own uid', async () => {
    await assertSucceeds(setDoc(doc(as('anon1'), 'onboardingRequests', 'anon1'), req()))
  })

  it('signed-out visitors cannot write', async () => {
    await assertFails(setDoc(doc(testEnv.unauthenticatedContext().firestore(), 'onboardingRequests', 'x'), req()))
  })

  it("can't file under another id, or overwrite their own", async () => {
    await assertFails(setDoc(doc(as('anon1'), 'onboardingRequests', 'someone-else'), req()))
    await assertSucceeds(setDoc(doc(as('anon2'), 'onboardingRequests', 'anon2'), req()))
    await assertFails(setDoc(doc(as('anon2'), 'onboardingRequests', 'anon2'), req({ hospitalName: 'Changed name here' })))
  })

  it('pins the shape: status, extra fields, sizes, type, email', async () => {
    const db = as('anon3')
    const at = doc(db, 'onboardingRequests', 'anon3')
    await assertFails(setDoc(at, req({ status: 'onboarded' })))
    await assertFails(setDoc(at, req({ tenantId: 'hospital-1' })))
    await assertFails(setDoc(at, req({ hospitalName: 'X' })))
    await assertFails(setDoc(at, req({ message: 'x'.repeat(2001) })))
    await assertFails(setDoc(at, req({ hospitalType: 'Casino' })))
    await assertFails(setDoc(at, req({ email: 'not-an-email' })))
    await assertFails(setDoc(at, req({ createdAt: new Date('2020-01-01') })))
  })

  it('senders and hospital admins cannot read requests', async () => {
    await assertFails(getDoc(doc(as('anon1'), 'onboardingRequests', 'old')))
    await assertFails(getDocs(collection(as('superA'), 'onboardingRequests')))
  })
})

describe('onboardingRequests — the platform admin works the queue', () => {
  it('lists, moves status, links the created hospital, deletes', async () => {
    const db = as('plat')
    await assertSucceeds(getDocs(collection(db, 'onboardingRequests')))
    await assertSucceeds(updateDoc(doc(db, 'onboardingRequests', 'old'), { status: 'contacted', statusUpdatedAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(doc(db, 'onboardingRequests', 'old'), { status: 'onboarded', hospitalId: 'drmc' }))
    await assertSucceeds(deleteDoc(doc(db, 'onboardingRequests', 'old')))
  })

  it("can't rewrite what the hospital sent, or set an unknown status", async () => {
    const db = as('plat')
    await assertFails(updateDoc(doc(db, 'onboardingRequests', 'old'), { hospitalName: 'Edited' }))
    await assertFails(updateDoc(doc(db, 'onboardingRequests', 'old'), { status: 'approved-ish' }))
  })
})

// Hospital onboarding (2026-11-15): richer expression of interest, the Super
// Admin's stages/verification/agreement/documents, and the go-live gate.
describe('onboarding — expression of interest and stages', () => {
  it('accepts the NHFR code, phone, positions and signatory; BARMM MOH type', async () => {
    await assertSucceeds(setDoc(doc(as('anon5'), 'onboardingRequests', 'anon5'), req({
      hospitalType: 'BARMM MOH', nhfrCode: 'DOH000000000012345', officialPhone: '(064) 421-0000',
      contactPosition: 'Head, Medical Social Work', signatoryName: 'Dr. B. Cruz', signatoryPosition: 'Chief of Hospital',
    })))
    await assertFails(setDoc(doc(as('anon6'), 'onboardingRequests', 'anon6'), req({ nhfrCode: 'x'.repeat(31) })))
  })

  it('the Super Admin records verification, agreement, documents and stages', async () => {
    const db = as('plat')
    const at = doc(db, 'onboardingRequests', 'old')
    await assertSucceeds(updateDoc(at, {
      stage: 'verification', verification: { nhfrCode: 'X', nhfrChecked: true },
      'documents.loi': { name: 'loi.pdf', path: 'onboarding/old/loi-1.pdf' }, notes: 'Called MSS', updatedAt: serverTimestamp(),
    }))
    await assertSucceeds(updateDoc(at, { stage: 'live', status: 'onboarded', liveAt: serverTimestamp() }))
    await assertFails(updateDoc(at, { stage: 'approved' }))
  })

  it('nobody else can move a hospital through onboarding', async () => {
    await assertFails(updateDoc(doc(as('superA'), 'onboardingRequests', 'old'), { stage: 'live' }))
    await assertFails(updateDoc(doc(as('anon1'), 'onboardingRequests', 'old'), { stage: 'live' }))
  })
})

describe('hospitals — onboarding status is the Super Admin\'s', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'hospitals', 'hospital-1'), {
        facilityName: 'A', accessCodePrefix: 'MAPA', enabled: false, onboarding: { stage: 'setup', requestId: 'old' },
      }))
  })

  it('the Super Admin opens registration at go-live', async () => {
    await assertSucceeds(updateDoc(doc(as('plat'), 'hospitals', 'hospital-1'), {
      enabled: true, liveAt: serverTimestamp(), onboarding: { stage: 'live', requestId: 'old', planTier: 'pilot' },
    }))
  })

  it("the hospital's own admin can't open registration or mark itself live", async () => {
    const at = doc(as('superA'), 'hospitals', 'hospital-1')
    await assertFails(updateDoc(at, { enabled: true }))
    await assertFails(updateDoc(at, { onboarding: { stage: 'live', requestId: 'old' } }))
    await assertFails(updateDoc(at, { liveAt: serverTimestamp() }))
    await assertSucceeds(updateDoc(at, { facilityName: 'A Hospital' }))
  })
})
