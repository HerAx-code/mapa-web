/**
 * Case conversations — Phase 3 PR 3.3 (P3-C / D11, gaps M16, N13).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { memDb } from './helpers/memDb.js'

const require = createRequire(import.meta.url)
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (o, fn) => fn,
  HttpsError: class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code } },
}))
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: (o, fn) => fn }))

let handleOpenCaseConversation, handleConversationMessage
beforeAll(() => { ;({ handleOpenCaseConversation, handleConversationMessage } = require('../../functions/src/caseConversations')) })

const H = 'hosp-a'
// memDb stores dotted keys literally and has no arrayUnion; model both.
const deps = { serverTimestamp: () => 'TS', arrayUnion: (...v) => ({ union: v }) }
const base = (x = {}) => ({
  'users/sw1': { role: 'staff_admin', tenantId: H, name: 'Ana SW' },
  'users/sw2': { role: 'staff_admin', tenantId: H, name: 'Ben SW' },
  'users/swB': { role: 'staff_admin', tenantId: 'hosp-b', name: 'Other' },
  'users/co': { role: 'agency', agencyId: 'dswd' },
  'requests/r1': { requestId: 'REQ-1', patientId: 'pat', patientName: 'Pat', tenantId: H, status: 'under_review' },
  ...x,
})
const open = (db, uid, requestId = 'r1') => handleOpenCaseConversation({ callerUid: uid, data: { requestId }, db, ...deps })
const codeOf = async (p) => { try { await p; return null } catch (e) { return e.code } }

describe('openCaseConversation', () => {
  it('creates the case conversation once, tagged with the case and hospital', async () => {
    const db = memDb(base())
    const r = await open(db, 'sw1')
    expect(r.created).toBe(true)
    const conv = db.store.get(`conversations/${r.conversationId}`)
    expect(conv).toMatchObject({ kind: 'case', tenantId: H, requestId: 'r1', participants: ['sw1', 'pat'] })
    expect(db.store.get('requests/r1').caseConversationId).toBe(r.conversationId)
    expect((await open(db, 'sw1')).conversationId).toBe(r.conversationId)          // same thread, not a new one
  })

  it("another social worker joins the same thread; the patient's access log says so", async () => {
    const db = memDb(base())
    const first = await open(db, 'sw1')
    const second = await open(db, 'sw2')
    expect(second).toMatchObject({ conversationId: first.conversationId, joined: true })
    const conv = db.store.get(`conversations/${first.conversationId}`)
    expect(conv.participants).toEqual({ union: ['sw2'] })
    expect(conv['names.sw2']).toBe('Ben SW')
    const audit = [...db.store.entries()].find(([k]) => k.startsWith('auditLog/'))[1]
    expect(audit).toMatchObject({ action: 'case_conversation_opened', patientId: 'pat', actorId: 'sw2' })
  })

  it("refuses another hospital, agencies, and a pointer into a thread that isn't the case's", async () => {
    expect(await codeOf(open(memDb(base()), 'swB'))).toBe('permission-denied')
    expect(await codeOf(open(memDb(base()), 'co'))).toBe('permission-denied')
    const db = memDb(base({
      'requests/r1': { ...base()['requests/r1'], caseConversationId: 'foreign' },
      'conversations/foreign': { participants: ['x', 'y'], requestId: 'other', tenantId: 'hosp-b' },
    }))
    const r = await open(db, 'sw1')
    expect(r.conversationId).not.toBe('foreign')
    expect(db.store.get('conversations/foreign').participants).toEqual(['x', 'y'])
  })
})

describe('onConversationMessage', () => {
  it('writes lastAt, the preview and unread for every other participant', async () => {
    const db = memDb({ 'conversations/c1': { participants: ['sw1', 'sw2', 'pat'] } })
    const r = await handleConversationMessage({
      db, conversationId: 'c1', message: { from: 'pat', text: 'x'.repeat(300), createdAt: 'T1' },
      increment: (n) => ({ inc: n }), serverTimestamp: () => 'TS',
    })
    expect(r.notified).toBe(2)
    const c = db.store.get('conversations/c1')
    expect(c).toMatchObject({ lastFrom: 'pat', lastAt: 'T1', 'unread.pat': 0, 'unread.sw1': { inc: 1 }, 'unread.sw2': { inc: 1 } })
    expect(c.lastMessage).toHaveLength(200)
  })
})
