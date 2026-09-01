import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, getDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-slots',
    firestore: {
      rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  })
})

afterAll(async () => { await testEnv?.cleanup() })
beforeEach(async () => { await testEnv.clearFirestore() })

async function seedUser(uid, role, agencyId = null) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { role, agencyId })
  })
}

// Seed a request owned by `patientId` (the book rule get()-checks ownership).
async function seedRequest(reqId, patientId) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'requests', reqId), {
      patientId, status: 'assessment', agencyIds: [], amountCommitted: 0,
    })
  })
}

async function seedSlot(slotId, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'interviewSlots', slotId), {
      date: '2026-09-01', time: '9:00 AM', startMin: 540, durationMin: 30,
      status: 'open', patientId: null, requestId: null, ...data,
    })
  })
}

const openSlot = () => ({ date: '2026-09-01', time: '9:00 AM', startMin: 540, durationMin: 30, status: 'open', patientId: null, requestId: null })

describe('interviewSlots rules', () => {
  beforeEach(async () => {
    await seedUser('admin1', 'super_admin')
    await seedUser('pat1', 'patient')
    await seedUser('pat2', 'patient')
    await seedRequest('req1', 'pat1')
    await seedRequest('req2', 'pat2')
  })

  it('admin publishes a slot; a patient cannot', async () => {
    const admin = testEnv.authenticatedContext('admin1').firestore()
    const pat = testEnv.authenticatedContext('pat1').firestore()
    await assertSucceeds(setDoc(doc(admin, 'interviewSlots', 's1'), openSlot()))
    await assertFails(setDoc(doc(pat, 'interviewSlots', 's2'), openSlot()))
  })

  it('a patient can read an open slot but not another patient\'s booked slot', async () => {
    await seedSlot('sOpen', {})
    await seedSlot('sMine', { status: 'booked', patientId: 'pat1', requestId: 'req1' })
    await seedSlot('sOther', { status: 'booked', patientId: 'pat2', requestId: 'req2' })
    const pat = testEnv.authenticatedContext('pat1').firestore()
    await assertSucceeds(getDoc(doc(pat, 'interviewSlots', 'sOpen')))
    await assertSucceeds(getDoc(doc(pat, 'interviewSlots', 'sMine')))
    await assertFails(getDoc(doc(pat, 'interviewSlots', 'sOther')))
  })

  it('a patient books an open slot for their own request', async () => {
    await seedSlot('s1', {})
    const pat = testEnv.authenticatedContext('pat1').firestore()
    await assertSucceeds(updateDoc(doc(pat, 'interviewSlots', 's1'), {
      status: 'booked', patientId: 'pat1', requestId: 'req1', bookedAt: serverTimestamp(),
    }))
  })

  it('rejects double-booking (slot no longer open)', async () => {
    await seedSlot('s1', { status: 'booked', patientId: 'pat1', requestId: 'req1' })
    const pat2 = testEnv.authenticatedContext('pat2').firestore()
    await assertFails(updateDoc(doc(pat2, 'interviewSlots', 's1'), {
      status: 'booked', patientId: 'pat2', requestId: 'req2', bookedAt: serverTimestamp(),
    }))
  })

  it('rejects booking pinned to a request the patient does not own', async () => {
    await seedSlot('s1', {})
    const pat1 = testEnv.authenticatedContext('pat1').firestore()
    // pat1 tries to attach pat2's request → get() ownership check fails.
    await assertFails(updateDoc(doc(pat1, 'interviewSlots', 's1'), {
      status: 'booked', patientId: 'pat1', requestId: 'req2', bookedAt: serverTimestamp(),
    }))
  })

  it('rejects stamping another patient\'s uid on a booking', async () => {
    await seedSlot('s1', {})
    const pat1 = testEnv.authenticatedContext('pat1').firestore()
    await assertFails(updateDoc(doc(pat1, 'interviewSlots', 's1'), {
      status: 'booked', patientId: 'pat2', requestId: 'req2', bookedAt: serverTimestamp(),
    }))
  })

  it('rejects a booking that also mutates a non-booking field', async () => {
    await seedSlot('s1', {})
    const pat1 = testEnv.authenticatedContext('pat1').firestore()
    await assertFails(updateDoc(doc(pat1, 'interviewSlots', 's1'), {
      status: 'booked', patientId: 'pat1', requestId: 'req1', bookedAt: serverTimestamp(),
      durationMin: 999, // tampering outside the allowed booking fields
    }))
  })

  it('a patient cancels their own booked slot (booked → open)', async () => {
    await seedSlot('s1', { status: 'booked', patientId: 'pat1', requestId: 'req1' })
    const pat1 = testEnv.authenticatedContext('pat1').firestore()
    await assertSucceeds(updateDoc(doc(pat1, 'interviewSlots', 's1'), {
      status: 'open', patientId: null, requestId: null, updatedAt: serverTimestamp(),
    }))
  })

  it('a patient cannot cancel another patient\'s booked slot', async () => {
    await seedSlot('s1', { status: 'booked', patientId: 'pat1', requestId: 'req1' })
    const pat2 = testEnv.authenticatedContext('pat2').firestore()
    await assertFails(updateDoc(doc(pat2, 'interviewSlots', 's1'), {
      status: 'open', patientId: null, requestId: null, updatedAt: serverTimestamp(),
    }))
  })

  it('admin can delete a slot; a patient cannot', async () => {
    await seedSlot('s1', {})
    const pat1 = testEnv.authenticatedContext('pat1').firestore()
    const admin = testEnv.authenticatedContext('admin1').firestore()
    await assertFails(deleteDoc(doc(pat1, 'interviewSlots', 's1')))
    await assertSucceeds(deleteDoc(doc(admin, 'interviewSlots', 's1')))
  })
})
