/**
 * onInterviewSlotWritten — pure-handler unit tests.
 *
 * The trigger keeps a request's interview fields in sync with the patient's
 * booked slot (server-authoritative — the patient never writes the request).
 * These pin the behaviour that matters:
 *   - book (open → booked) stamps the slot's facts onto the request and
 *     advances to 'assessment' only from a pre-assessment state
 *   - in-person booking assigns a booking-order queue number (A-00N) onto
 *     both the slot and the request; online does not
 *   - cancel (booked → open) clears the fields ONLY if the request still
 *     points at this slot (a re-book to another slot is not clobbered)
 *   - non-transitions and missing request / requestId degrade quietly
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

vi.mock('firebase-admin', () => ({
  default: { firestore: () => ({}) },
  firestore: () => ({}),
}))
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (opts, fn) => fn }))

let handleInterviewSlotWritten
beforeAll(() => {
  handleInterviewSlotWritten = require('../../functions/src/onInterviewSlotWritten').handleInterviewSlotWritten
})

const serverTimestamp = () => 'MOCK_TS'

// Minimal Firestore double. Captures the request + slot update payloads and
// serves a configurable request doc and a day booked-slot count for the queue.
function makeDb({ request, dayBookedCount = 0 }) {
  const captured = { reqUpdate: null, slotUpdate: null }
  const reqRef = {
    get: async () => ({ exists: request != null, data: () => request }),
    update: async (u) => { captured.reqUpdate = u },
  }
  const slotDoc = { update: async (u) => { captured.slotUpdate = u } }
  const whereChain = { get: async () => ({ size: dayBookedCount }) }
  const nestedWhere = { where: () => ({ where: () => whereChain }) }
  const db = {
    collection: (name) => {
      if (name === 'requests') return { doc: () => reqRef }
      if (name === 'interviewSlots') return { doc: () => slotDoc, where: () => nestedWhere }
      return { doc: () => ({}) }
    },
  }
  return { db, captured }
}

const openSlot   = (o = {}) => ({ status: 'open', requestId: 'req1', ...o })
const bookedSlot = (o = {}) => ({
  status: 'booked', requestId: 'req1', date: '2026-09-01', time: '10:00 AM',
  mode: 'in_person', start: 'SLOT_TS', meetLink: '', queueNo: null, ...o,
})

describe('handleInterviewSlotWritten — book (open → booked)', () => {
  it('syncs the slot onto the request and advances to assessment', async () => {
    const { db, captured } = makeDb({ request: { status: 'under_review', interviewSlotId: null }, dayBookedCount: 1 })
    const res = await handleInterviewSlotWritten({
      db, slotId: 'slot1', before: openSlot(), after: bookedSlot(), serverTimestamp,
    })
    expect(res.synced).toBe('booked')
    expect(captured.reqUpdate.interviewDate).toBe('2026-09-01')
    expect(captured.reqUpdate.interviewTime).toBe('10:00 AM')
    expect(captured.reqUpdate.interviewMode).toBe('in_person')
    expect(captured.reqUpdate.interviewSlotId).toBe('slot1')
    expect(captured.reqUpdate.status).toBe('assessment')
    // Re-arms the reminder cadence for the (possibly rescheduled) time.
    expect(captured.reqUpdate.reminderSent24h).toBe(false)
    expect(captured.reqUpdate.reminderSent1h).toBe(false)
  })

  it('assigns a booking-order queue number to slot and request (in-person)', async () => {
    const { db, captured } = makeDb({ request: { status: 'under_review' }, dayBookedCount: 3 })
    const res = await handleInterviewSlotWritten({
      db, slotId: 'slot1', before: openSlot(), after: bookedSlot(), serverTimestamp,
    })
    expect(res.queueNo).toBe('A-003')
    expect(captured.slotUpdate.queueNo).toBe('A-003')
    expect(captured.reqUpdate.interviewQueueNo).toBe('A-003')
  })

  it('online booking carries the Meet link and assigns no queue number', async () => {
    const { db, captured } = makeDb({ request: { status: 'submitted' } })
    const res = await handleInterviewSlotWritten({
      db, slotId: 'slot1', before: openSlot(),
      after: bookedSlot({ mode: 'online', meetLink: 'meet.google.com/abc' }),
      serverTimestamp,
    })
    expect(res.mode).toBe('online')
    expect(captured.slotUpdate).toBeNull()
    expect(captured.reqUpdate.meetLink).toBe('meet.google.com/abc')
    expect(captured.reqUpdate.interviewQueueNo).toBeNull()
    expect(captured.reqUpdate.status).toBe('assessment')
  })

  it('never regresses a request already past the interview (keeps its status)', async () => {
    const { db, captured } = makeDb({ request: { status: 'endorsed' }, dayBookedCount: 1 })
    await handleInterviewSlotWritten({
      db, slotId: 'slot1', before: openSlot(), after: bookedSlot(), serverTimestamp,
    })
    expect(captured.reqUpdate.interviewDate).toBe('2026-09-01') // facts still sync
    expect('status' in captured.reqUpdate).toBe(false)          // lifecycle untouched
  })

  it('skips when the slot has no requestId', async () => {
    const { db, captured } = makeDb({ request: { status: 'under_review' } })
    const res = await handleInterviewSlotWritten({
      db, slotId: 'slot1', before: openSlot({ requestId: null }),
      after: bookedSlot({ requestId: null }), serverTimestamp,
    })
    expect(res.skipped).toBe('no-request-id')
    expect(captured.reqUpdate).toBeNull()
  })
})

describe('handleInterviewSlotWritten — cancel (booked → open)', () => {
  it('clears the interview fields and rolls assessment back to under_review', async () => {
    const { db, captured } = makeDb({ request: { status: 'assessment', interviewSlotId: 'slot1' } })
    const res = await handleInterviewSlotWritten({
      db, slotId: 'slot1', before: bookedSlot(), after: openSlot(), serverTimestamp,
    })
    expect(res.synced).toBe('cancelled')
    expect(captured.reqUpdate.interviewDate).toBeNull()
    expect(captured.reqUpdate.interviewSlotId).toBeNull()
    expect(captured.reqUpdate.status).toBe('under_review')
  })

  it('does NOT clobber a request that already re-booked a different slot', async () => {
    const { db, captured } = makeDb({ request: { status: 'assessment', interviewSlotId: 'otherSlot' } })
    const res = await handleInterviewSlotWritten({
      db, slotId: 'slot1', before: bookedSlot(), after: openSlot(), serverTimestamp,
    })
    expect(res.skipped).toBe('reassigned')
    expect(captured.reqUpdate).toBeNull()
  })
})

describe('handleInterviewSlotWritten — non-transitions', () => {
  it('ignores a write that is not a book/cancel transition', async () => {
    const { db, captured } = makeDb({ request: { status: 'assessment' } })
    const res = await handleInterviewSlotWritten({
      db, slotId: 'slot1', before: bookedSlot(), after: bookedSlot({ meetLink: 'x' }), serverTimestamp,
    })
    expect(res.skipped).toBe('no-transition')
    expect(captured.reqUpdate).toBeNull()
  })

  it('degrades quietly when the request is missing', async () => {
    const { db } = makeDb({ request: null })
    const res = await handleInterviewSlotWritten({
      db, slotId: 'slot1', before: openSlot(), after: bookedSlot(), serverTimestamp,
    })
    expect(res.skipped).toBe('request-missing')
  })
})
