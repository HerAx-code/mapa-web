/**
 * interviewReminders — pure-handler unit tests.
 *
 * Fires two in-app reminders per upcoming interview (~24h and ~1–2h before),
 * each exactly once via the reminderSent24h/1h flags. These pin:
 *   - the 24h reminder fires once, then is suppressed
 *   - the final reminder fires inside 2h and also marks 24h sent (no late 24h)
 *   - concluded interviews and past times are skipped
 *   - copy is mode-aware (office vs Google Meet), pro-social framing
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

vi.mock('firebase-admin', () => ({ default: { firestore: () => ({}) }, firestore: () => ({}) }))
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (opts, fn) => fn }))

let handleInterviewReminders, reminderCopy
beforeAll(() => {
  const m = require('../../functions/src/interviewReminders')
  handleInterviewReminders = m.handleInterviewReminders
  reminderCopy = m.reminderCopy
})

const NOW = Date.parse('2026-09-01T08:00:00+08:00')
const serverTimestamp = () => 'TS'
const timestampFromMs = (ms) => ({ _ms: ms })
const at = (hoursFromNow) => ({ toMillis: () => NOW + hoursFromNow * 3600000 })

const baseReq = (o = {}) => ({
  id: 'req1', patientId: 'p1', interviewDate: '2026-09-02', interviewTime: '10:00 AM',
  interviewMode: 'in_person', interviewAt: at(23), ...o,
})

function makeDb(requests) {
  const captured = []
  const docs = requests.map((r, i) => ({
    id: r.id ?? `req${i}`,
    data: () => r,
    ref: { update: async (u) => captured.push({ id: r.id ?? `req${i}`, u }) },
  }))
  const db = { collection: () => ({ where: () => ({ where: () => ({ get: async () => ({ docs, size: docs.length }) }) }) }) }
  return { db, captured }
}

async function run(requests) {
  const sent = []
  const { db, captured } = makeDb(requests)
  const res = await handleInterviewReminders({
    db, nowMs: NOW, timestampFromMs, serverTimestamp,
    sendNotification: async (n) => sent.push(n),
  })
  return { res, sent, captured }
}

describe('handleInterviewReminders', () => {
  it('sends the 24h reminder once and marks it sent', async () => {
    const { res, sent, captured } = await run([baseReq({ interviewAt: at(23) })])
    expect(res.sent24h).toBe(1)
    expect(sent[0].type).toBe('interview_reminder')
    expect(sent[0].title).toMatch(/tomorrow/i)
    expect(captured[0].u.reminderSent24h).toBe(true)
  })

  it('does not re-send the 24h reminder once flagged', async () => {
    const { res, sent } = await run([baseReq({ interviewAt: at(23), reminderSent24h: true })])
    expect(res.sent24h).toBe(0)
    expect(sent).toHaveLength(0)
  })

  it('sends the final reminder inside 2h and also marks 24h sent', async () => {
    const { res, sent, captured } = await run([baseReq({ interviewAt: at(1.5) })])
    expect(res.sentFinal).toBe(1)
    expect(sent[0].title).toMatch(/couple of hours/i)
    expect(captured[0].u.reminderSent1h).toBe(true)
    expect(captured[0].u.reminderSent24h).toBe(true)
  })

  it('does not re-send the final reminder once flagged', async () => {
    const { res, sent } = await run([baseReq({ interviewAt: at(1.5), reminderSent1h: true })])
    expect(res.sentFinal).toBe(0)
    expect(sent).toHaveLength(0)
  })

  it('skips concluded interviews and past times', async () => {
    const { res, sent } = await run([
      baseReq({ id: 'done', interviewAt: at(1), interviewOutcome: 'completed' }),
      baseReq({ id: 'past', interviewAt: at(-1) }),
    ])
    expect(res.sent24h + res.sentFinal).toBe(0)
    expect(sent).toHaveLength(0)
  })
})

describe('reminderCopy — mode-aware, pro-social', () => {
  it('in-person copy names the office and the reschedule ask', () => {
    const c = reminderCopy('24h', baseReq())
    expect(c.body).toMatch(/Malasakit/i)
    expect(c.body).toMatch(/reschedule/i)
    expect(c.body).toMatch(/another patient/i)
  })
  it('online copy names Google Meet', () => {
    const c = reminderCopy('24h', baseReq({ interviewMode: 'online' }))
    expect(c.body).toMatch(/Google Meet/i)
  })
})
