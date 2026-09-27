import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, collection, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import fs from 'node:fs'
import path from 'node:path'

let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-messages',
    firestore: {
      rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  })
})

afterAll(async () => testEnv?.cleanup())
beforeEach(async () => testEnv.clearFirestore())

async function seedUser(uid, role, agencyId = null) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { role, agencyId })
  })
}

async function seedConversation(convId, participants) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'conversations', convId), { participants })
  })
}

// conversations.create: caller must list themselves in participants, AND
// (abuse hardening #2, reply-only) the caller must NOT be a patient — only
// staff/agency start conversations; patients reply.
describe('conversations.create — reply-only (patients cannot start)', () => {
  it('allows a staff/agency participant to create a conversation', async () => {
    await seedUser('agency-1', 'agency')
    const ctx = testEnv.authenticatedContext('agency-1')
    await assertSucceeds(addDoc(collection(ctx.firestore(), 'conversations'), {
      participants: ['agency-1', 'patient-1'],
    }))
  })

  it('rejects a PATIENT starting a conversation (reply-only)', async () => {
    await seedUser('patient-1', 'patient')
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'conversations'), {
      participants: ['patient-1', 'agency-1'],
    }))
  })

  it('rejects creating a conversation that excludes the caller', async () => {
    await seedUser('agency-1', 'agency')
    const ctx = testEnv.authenticatedContext('agency-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'conversations'), {
      participants: ['user-bob', 'agency-2'],
    }))
  })
})

// Abuse hardening #2: reply-flood cooldown — a patient's message must be >= 5s
// after the thread's last message; staff are uncapped.
describe('messages.create — patient reply cooldown', () => {
  async function seedConvWithLastAt(convId, participants, lastAt) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'conversations', convId), { participants, lastAt })
    })
  }
  const msg = (from) => ({ from, text: 'hi', createdAt: serverTimestamp() })

  it('rejects a patient reply within 5s of the last message', async () => {
    await seedUser('patient-1', 'patient')
    await seedConvWithLastAt('c1', ['patient-1', 'admin-1'], Timestamp.fromMillis(Date.now()))
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertFails(addDoc(collection(ctx.firestore(), 'conversations', 'c1', 'messages'), msg('patient-1')))
  })

  it('allows a patient reply once the cooldown has elapsed', async () => {
    await seedUser('patient-1', 'patient')
    await seedConvWithLastAt('c1', ['patient-1', 'admin-1'], Timestamp.fromMillis(Date.now() - 10_000))
    const ctx = testEnv.authenticatedContext('patient-1')
    await assertSucceeds(addDoc(collection(ctx.firestore(), 'conversations', 'c1', 'messages'), msg('patient-1')))
  })

  it('does NOT rate-limit staff (uncapped)', async () => {
    await seedUser('admin-1', 'super_admin')
    await seedConvWithLastAt('c1', ['patient-1', 'admin-1'], Timestamp.fromMillis(Date.now()))
    const ctx = testEnv.authenticatedContext('admin-1')
    await assertSucceeds(addDoc(collection(ctx.firestore(), 'conversations', 'c1', 'messages'), msg('admin-1')))
  })
})

// messages.create from security pass 3 (commit 9a596d4): from must == uid,
// text capped at 5000 chars.
describe('messages.create — sender attribution + size cap', () => {
  beforeEach(async () => {
    await seedConversation('conv-1', ['user-alice', 'user-bob'])
  })

  it('allows a participant to send a message attributed to themselves', async () => {
    await seedUser('user-alice', 'patient')
    const ctx = testEnv.authenticatedContext('user-alice')
    await assertSucceeds(addDoc(
      collection(ctx.firestore(), 'conversations', 'conv-1', 'messages'),
      { from: 'user-alice', text: 'Hello', createdAt: serverTimestamp() },
    ))
  })

  it('rejects a participant sending a message attributed to another user', async () => {
    await seedUser('user-alice', 'patient')
    const ctx = testEnv.authenticatedContext('user-alice')
    await assertFails(addDoc(
      collection(ctx.firestore(), 'conversations', 'conv-1', 'messages'),
      { from: 'user-bob', text: 'Forged', createdAt: serverTimestamp() },
    ))
  })

  it('rejects a non-participant from sending', async () => {
    await seedUser('user-mallory', 'patient')
    const ctx = testEnv.authenticatedContext('user-mallory')
    await assertFails(addDoc(
      collection(ctx.firestore(), 'conversations', 'conv-1', 'messages'),
      { from: 'user-mallory', text: 'I should not be here', createdAt: serverTimestamp() },
    ))
  })

  it('rejects messages over the 5000-char size cap', async () => {
    await seedUser('user-alice', 'patient')
    const ctx = testEnv.authenticatedContext('user-alice')
    await assertFails(addDoc(
      collection(ctx.firestore(), 'conversations', 'conv-1', 'messages'),
      { from: 'user-alice', text: 'a'.repeat(5001), createdAt: serverTimestamp() },
    ))
  })
})

// notifications/{userId}/items/{notifId} create from security pass 2:
// title <= 200, body <= 2000.
describe('notifications.create — title/body size caps', () => {
  // Phase 1.4: cross-role notification writes still work, but now require
  // a fromUid matching the caller. The unattributed variant this test used
  // to send is covered as a regression guard in writeSinks.rules.test.js.
  it('allows a small notification to a different user', async () => {
    await seedUser('user-alice', 'agency')
    const ctx = testEnv.authenticatedContext('user-alice')
    await assertSucceeds(addDoc(
      collection(ctx.firestore(), 'notifications', 'user-bob', 'items'),
      { title: 'Hi', body: 'Hello', type: 'info', read: false,
        fromUid: 'user-alice', createdAt: serverTimestamp() },
    ))
  })

  it('rejects an oversized title (>200 chars)', async () => {
    await seedUser('user-alice', 'agency')
    const ctx = testEnv.authenticatedContext('user-alice')
    await assertFails(addDoc(
      collection(ctx.firestore(), 'notifications', 'user-bob', 'items'),
      { title: 'a'.repeat(201), body: 'short', type: 'info', read: false, createdAt: serverTimestamp() },
    ))
  })

  it('rejects an oversized body (>2000 chars)', async () => {
    await seedUser('user-alice', 'agency')
    const ctx = testEnv.authenticatedContext('user-alice')
    await assertFails(addDoc(
      collection(ctx.firestore(), 'notifications', 'user-bob', 'items'),
      { title: 'ok', body: 'a'.repeat(2001), type: 'info', read: false, createdAt: serverTimestamp() },
    ))
  })
})