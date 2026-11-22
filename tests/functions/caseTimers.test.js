/**
 * caseTimers — Phase 4 PR 4.2 (docs/phase4-case-endings-plan.md): reminders
 * and automatic endings, idempotent, through the same cores as a person.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { memDb } from './helpers/memDb.js'

const require = createRequire(import.meta.url)
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (o, fn) => fn }))
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (o, fn) => fn,
  HttpsError: class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code } },
}))

let handleCaseTimers
beforeAll(() => { ;({ handleCaseTimers } = require('../../functions/src/caseTimers')) })

const H = 'hosp-a'
const HOUR = 3600e3, DAY = 24 * HOUR
const NOW = Date.UTC(2026, 10, 25, 22, 0)          // 06:00 Manila
const ts = (ms) => ({ toMillis: () => ms })
const run = (db, nowMs = NOW) => handleCaseTimers({
  db, nowMs, serverTimestamp: () => 'TS',
  sliceOverrides: { increment: (n) => ({ inc: n }), fromMillis: (ms) => ts(ms) },
})
const notes = (db, uid) => [...db.store.entries()].filter(([k]) => k.startsWith(`notifications/${uid}/items/`)).map(([, v]) => v)

const base = (x = {}) => ({
  'users/sw1': { role: 'staff_admin', tenantId: H, name: 'Ana SW' },
  'users/co': { role: 'agency', agencyId: 'dswd' },
  'agencies/dswd': { name: 'DSWD', enabled: true, partnerHospitalIds: [H], slots: { total: 5, remaining: 2 }, lastResetDate: '2026-11-25' },
  'requests/r1': { requestId: 'REQ-1', patientId: 'pat', patientName: 'Pat', tenantId: H, status: 'endorsed', amountNeeded: 10000, amountCommitted: 0 },
  ...x,
})
const slice = (x = {}) => ({ requestId: 'r1', agencyId: 'dswd', agencyName: 'DSWD', patientId: 'pat', patientName: 'Pat', tenantId: H, amountRequested: 10000, endorsedById: 'sw1', ...x })

describe('slices the patient never proceeded on (P4-B)', () => {
  it('reminds at 24 h, again at 48 h, once each', async () => {
    const db = memDb(base({ 'applications/s1': slice({ status: 'endorsed', endorsedAt: ts(NOW - 25 * HOUR) }) }))
    expect((await run(db)).proceedReminded).toBe(1)
    expect((await run(db)).proceedReminded).toBe(0)                       // same day: no second reminder
    expect(db.store.get('applications/s1').proceedReminders).toBe(1)
    expect((await run(db, NOW + DAY)).proceedReminded).toBe(1)             // 49 h
    expect(notes(db, 'pat')).toHaveLength(2)
  })

  it("closes at the hospital's limit as not accepted; the hospital and the patient are told", async () => {
    const db = memDb(base({ 'applications/s1': slice({ status: 'endorsed', endorsedAt: ts(NOW - 3 * DAY - HOUR), proceedReminders: 2 }) }))
    expect((await run(db)).notAccepted).toBe(1)
    expect(db.store.get('applications/s1')).toMatchObject({ status: 'closed', closedAs: 'not_accepted', closedBy: 'system:slice_not_accepted' })
    expect(notes(db, 'pat').at(-1).title).toBe('Endorsement closed')
    expect(notes(db, 'sw1')).toHaveLength(1)
  })

  it("follows the hospital's own limit", async () => {
    const db = memDb(base({
      'hospitalSettings/hosp-a': { sliceProceedDays: 5 },
      'applications/s1': slice({ status: 'endorsed', endorsedAt: ts(NOW - 4 * DAY), proceedReminders: 2 }),
    }))
    expect((await run(db)).notAccepted).toBe(0)
  })
})

describe('"Needs info" the patient has not answered (P4-E)', () => {
  it('reminds the patient at 3 days, tells the agency at 7, never closes', async () => {
    const db = memDb(base({ 'applications/s1': slice({ status: 'awaiting_info', awaitingInfoMessage: 'Upload the bill', awaitingInfoRequestedAt: ts(NOW - 3 * DAY - HOUR) }) }))
    expect((await run(db)).infoReminded).toBe(1)
    expect((await run(db)).infoReminded).toBe(0)
    expect((await run(db, NOW + 4 * DAY)).infoAgencyTold).toBe(1)
    expect(notes(db, 'co')).toHaveLength(1)
    expect((await run(db, NOW + 30 * DAY)).infoAgencyTold).toBe(0)
    expect(db.store.get('applications/s1').status).toBe('awaiting_info')
  })
})

describe('nothing pending at any agency (P4-A)', () => {
  const idle = (daysAgo, x = {}) => base({
    'requests/r1': { ...base()['requests/r1'], status: 'under_review', nothingPendingSince: ts(NOW - daysAgo * DAY), ...x },
    'applications/s1': slice({ status: 'rejected' }),
  })

  it('warns the hospital a day before, once', async () => {
    const db = memDb(idle(6.5))
    expect((await run(db)).warned).toBe(1)
    expect((await run(db)).warned).toBe(0)
    expect(notes(db, 'sw1')[0].title).toBe('A case closes itself tomorrow')
  })

  it('closes at the limit — "no agency could fund" — and tells the patient they can file again', async () => {
    const db = memDb(idle(7.5))
    expect((await run(db)).autoClosed).toBe(1)
    expect(db.store.get('requests/r1')).toMatchObject({ status: 'closed', closedAs: 'no_funding', closedBy: 'system:nothing_pending' })
    expect(notes(db, 'pat').at(-1).body).toContain('To apply again')
  })

  it('a partially funded case closes as such; its letter is untouched', async () => {
    const db = memDb(base({
      'requests/r1': { ...base()['requests/r1'], status: 'partially_funded', nothingPendingSince: ts(NOW - 8 * DAY) },
      'applications/s1': slice({ status: 'approved', glStatus: 'issued', amountApproved: 4000 }),
      'applications/s2': slice({ agencyId: 'pcso', status: 'rejected' }),
    }))
    await run(db)
    expect(db.store.get('requests/r1')).toMatchObject({ status: 'closed', closedAs: 'partially_funded' })
    expect(db.store.get('applications/s1')).toMatchObject({ status: 'approved', glStatus: 'issued' })
  })

  it('leaves a case that got a new endorsement before the run', async () => {
    const db = memDb(base({
      'requests/r1': { ...base()['requests/r1'], status: 'endorsed', nothingPendingSince: ts(NOW - 9 * DAY) },
      'applications/s1': slice({ status: 'rejected' }),
      'applications/s2': slice({ agencyId: 'pcso', status: 'endorsed', endorsedAt: ts(NOW - HOUR) }),
    }))
    expect((await run(db)).autoClosed).toBe(0)
    expect(db.store.get('requests/r1').status).toBe('endorsed')
  })
})

describe('slices held at a disabled agency (P4-D)', () => {
  it('close after the limit as agency unavailable; not before', async () => {
    const seed = (daysAgo) => memDb(base({
      'agencies/dswd': { ...base()['agencies/dswd'], enabled: false, disabledAt: ts(NOW - daysAgo * DAY) },
      'applications/s1': slice({ status: 'reviewing' }),
    }))
    const early = seed(3)
    expect((await run(early)).agencyUnavailable).toBe(0)
    const late = seed(8)
    expect((await run(late)).agencyUnavailable).toBe(1)
    expect(late.store.get('applications/s1')).toMatchObject({ status: 'closed', closedAs: 'agency_unavailable' })
  })
})
