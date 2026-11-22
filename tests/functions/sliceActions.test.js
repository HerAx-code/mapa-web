/**
 * sliceActions — decideSlice and settleLetter on the server (Phase 2 PR 2.3).
 * Gaps I2 (approve out of order / twice), M3 (budget maths differs between
 * paths), M13 (a partnership ended), N1 (slot back by the server's date), N2
 * (outpatient cap), R2 (one expiry path).
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

let handleDecideSlice, handleSettleLetter, handleGLExpirySweep
beforeAll(() => {
  ;({ handleDecideSlice, handleSettleLetter } = require('../../functions/src/sliceActions'))
  ;({ handleGLExpirySweep } = require('../../functions/src/glExpirySweep'))
})

const H = 'hosp-a'
const DAY = 86400000
const NOW = Date.UTC(2026, 10, 22, 4, 0)            // 2026-11-22, 12:00 Manila
const TODAY = '2026-11-22'
const ts = (ms) => ({ toMillis: () => ms })
const deps = {
  now: () => NOW,
  serverTimestamp: () => 'TS',
  increment: (n) => ({ inc: n }),
  fromMillis: (ms) => ts(ms),
}

const slice = (x = {}) => ({
  requestId: 'r1', agencyId: 'dswd', agencyName: 'DSWD', patientId: 'pat', patientName: 'Pat',
  tenantId: H, status: 'reviewing', amountRequested: 10000, amountApproved: 0,
  endorsedById: 'sw1', endorsedAt: ts(NOW - 3 * DAY), ...x,
})
const base = (x = {}) => ({
  'users/co': { role: 'agency', agencyId: 'dswd', name: 'Cora' },
  'users/coAdmin': { role: 'agency_admin', agencyId: 'dswd', name: 'Ada' },
  'users/coX': { role: 'agency', agencyId: 'pcso', name: 'Other' },
  'users/sw1': { role: 'staff_admin', tenantId: H },
  'requests/r1': { patientId: 'pat', tenantId: H, status: 'endorsed', amountNeeded: 10000, amountCommitted: 0, agencyIds: ['dswd', 'pcso'], watchers: ['coX'], assistanceType: 'Medicines' },
  'agencies/dswd': { name: 'DSWD', enabled: true, partnerHospitalIds: [H], budget: { allocated: 0, committed: 0, disbursed: 0 }, slots: { total: 5, remaining: 2 }, lastResetDate: TODAY },
  'applications/s1': slice(),
  'applications/s2': slice({ agencyId: 'pcso', agencyName: 'PCSO', status: 'reviewing' }),
  ...x,
})
const approveData = (x = {}) => ({ sliceId: 's1', action: 'approve', amount: 6000, purposeOfAssistance: ['Medicines'], payableTo: 'Hospital Pharmacy', ...x })
const decide = (db, callerUid, data) => handleDecideSlice({ callerUid, data, db, ...deps })
const settle = (db, callerUid, data) => handleSettleLetter({ callerUid, data, db, ...deps })
const codeOf = async (p) => { try { await p; return null } catch (e) { return e.code } }
const notesFor = (db, uid) => [...db.store.entries()].filter(([k]) => k.startsWith(`notifications/${uid}/items/`)).map(([, v]) => v)
const audits = (db) => [...db.store.entries()].filter(([k]) => k.startsWith('auditLog/')).map(([, v]) => v)

describe('decideSlice: approve', () => {
  it('approves: the letter, the mark, the budget counted (no allocation), the request totals, audit and notices', async () => {
    const db = memDb(base())
    expect(await decide(db, 'co', approveData())).toEqual({ status: 'approved' })
    const s = db.store.get('applications/s1')
    expect(s).toMatchObject({ status: 'approved', amountApproved: 6000, glStatus: 'issued', approvedByUid: 'co', payableTo: 'Hospital Pharmacy', repeatOverride: null })
    expect(s.glExpiresAt.toMillis()).toBe(require('../../functions/src/generated/shared.cjs').glExpiresAtFor(NOW))  // 10 days, end of the Manila day
    expect(s).not.toHaveProperty('approvedAmount')                        // R7: one field
    // P2-C: counted although no allocation is set.
    expect(db.store.get('agencies/dswd')['budget.committed']).toEqual({ inc: 6000 })
    expect(db.store.get('requests/r1')).toMatchObject({ status: 'partially_funded', amountCommitted: 6000, openLetters: 1 })
    expect(db.store.get('approvalMarks/dswd__pat')).toMatchObject({ requestId: 'r1', sliceId: 's1', byType: { Medicines: { requestId: 'r1' } } })
    expect(audits(db)[0]).toMatchObject({ action: 'app_approved', actorId: 'co', requestId: 'r1', tenantId: H })
    expect(notesFor(db, 'pat')[0]).toMatchObject({ title: 'Application approved', fromUid: 'co' })
    expect(notesFor(db, 'sw1')).toHaveLength(1)
    expect(notesFor(db, 'coX')).toHaveLength(1)                            // sibling watcher
  })

  it('only from "reviewing": a second approval is refused and the money counted once (I2)', async () => {
    const db = memDb(base())
    await decide(db, 'co', approveData())
    expect(await codeOf(decide(db, 'co', approveData({ amount: 4000 })))).toBe('failed-precondition')
    expect(db.store.get('applications/s1').amountApproved).toBe(6000)
    expect(await codeOf(decide(memDb(base({ 'applications/s1': slice({ status: 'endorsed' }) })), 'co', approveData()))).toBe('failed-precondition')
  })

  it("refuses another agency's staff and a hospital account", async () => {
    expect(await codeOf(decide(memDb(base()), 'coX', approveData()))).toBe('permission-denied')
    expect(await codeOf(decide(memDb(base()), 'sw1', approveData()))).toBe('permission-denied')
  })

  it('refuses a closed request and a partnership that ended (M13)', async () => {
    const closed = base({ 'requests/r1': { ...base()['requests/r1'], status: 'closed' } })
    expect(await codeOf(decide(memDb(closed), 'co', approveData()))).toBe('failed-precondition')
    const ended = base({ 'agencies/dswd': { ...base()['agencies/dswd'], partnerHospitalIds: ['elsewhere'] } })
    expect(await codeOf(decide(memDb(ended), 'co', approveData()))).toBe('failed-precondition')
  })

  it('caps: the endorsed amount, the maximum per approval, the budget headroom', async () => {
    expect(await codeOf(decide(memDb(base()), 'co', approveData({ amount: 10001 })))).toBe('failed-precondition')
    const capped = base({ 'agencies/dswd': { ...base()['agencies/dswd'], maxPerApplicant: 5000 } })
    expect(await codeOf(decide(memDb(capped), 'co', approveData()))).toBe('failed-precondition')
    const tight = base({ 'agencies/dswd': { ...base()['agencies/dswd'], budget: { allocated: 10000, committed: 5000 } } })
    expect(await codeOf(decide(memDb(tight), 'co', approveData()))).toBe('failed-precondition')
    expect(await codeOf(decide(memDb(tight), 'co', approveData({ amount: 5000 })))).toBeNull()
  })

  it('outpatient: at most what the other agencies leave of the charge (N2)', async () => {
    const out = base({
      'requests/r1': { ...base()['requests/r1'], careSetting: 'outpatient' },
      'applications/s2': slice({ agencyId: 'pcso', status: 'approved', glStatus: 'issued', amountApproved: 7000 }),
    })
    expect(await codeOf(decide(memDb(out), 'co', approveData({ amount: 3001 })))).toBe('failed-precondition')
    expect(await codeOf(decide(memDb(out), 'co', approveData({ amount: 3000 })))).toBeNull()
  })

  it('repeat limit: inside it only with a written reason, recorded on the slice', async () => {
    const recent = base({ 'approvalMarks/dswd__pat': { agencyId: 'dswd', patientId: 'pat', requestId: 'r0', sliceId: 's0', lastApprovedAt: ts(NOW - 10 * DAY) } })
    expect(await codeOf(decide(memDb(recent), 'co', approveData()))).toBe('failed-precondition')
    expect(await codeOf(decide(memDb(recent), 'co', approveData({ repeatOverrideReason: 'short' })))).toBe('failed-precondition')
    const db = memDb(recent)
    expect(await codeOf(decide(db, 'co', approveData({ repeatOverrideReason: 'Second admission, new bill' })))).toBeNull()
    expect(db.store.get('applications/s1').repeatOverride).toMatchObject({ reason: 'Second admission, new bill', byUid: 'co' })
    const old = base({ 'approvalMarks/dswd__pat': { agencyId: 'dswd', patientId: 'pat', requestId: 'r0', sliceId: 's0', lastApprovedAt: ts(NOW - 31 * DAY) } })
    expect(await codeOf(decide(memDb(old), 'co', approveData()))).toBeNull()
  })

  it('needs an amount, a purpose and a provider', async () => {
    expect(await codeOf(decide(memDb(base()), 'co', approveData({ amount: 0 })))).toBe('invalid-argument')
    expect(await codeOf(decide(memDb(base()), 'co', approveData({ purposeOfAssistance: [] })))).toBe('invalid-argument')
    expect(await codeOf(decide(memDb(base()), 'co', approveData({ payableTo: ' ' })))).toBe('invalid-argument')
  })
})

describe('decideSlice: info, resume, reject', () => {
  it('request info and resume', async () => {
    const db = memDb(base())
    expect(await codeOf(decide(db, 'co', { sliceId: 's1', action: 'request_info' }))).toBe('invalid-argument')
    await decide(db, 'co', { sliceId: 's1', action: 'request_info', message: 'Upload the updated bill' })
    expect(db.store.get('applications/s1')).toMatchObject({ status: 'awaiting_info', awaitingInfoMessage: 'Upload the updated bill', awaitingInfoRequestedBy: 'Cora' })
    expect(notesFor(db, 'pat')[0].body).toContain('Upload the updated bill')
    await decide(db, 'co', { sliceId: 's1', action: 'resume' })
    expect(db.store.get('applications/s1')).toMatchObject({ status: 'reviewing', awaitingInfoMessage: null })
  })

  it('reject: a slot endorsed today comes back to its hospital; an older one does not (N1)', async () => {
    const today = base({
      'applications/s1': slice({ endorsedAt: ts(NOW - 3600e3) }),
      'agencies/dswd': { ...base()['agencies/dswd'], hospitalSlots: { [H]: { total: 3, remaining: 1, lastResetDate: TODAY } } },
    })
    const db = memDb(today)
    await decide(db, 'co', { sliceId: 's1', action: 'reject', reason: 'Not within our program' })
    expect(db.store.get('applications/s1')).toMatchObject({ status: 'rejected', rejectionReason: 'Not within our program' })
    expect(db.store.get('agencies/dswd')[`hospitalSlots.${H}.remaining`]).toBe(2)
    const older = memDb(base())
    await decide(older, 'co', { sliceId: 's1', action: 'reject', reason: 'Not within our program' })
    expect(Object.keys(older.store.get('agencies/dswd'))).not.toContain('slots.remaining')
  })

  it('reject needs a reason and an open slice', async () => {
    expect(await codeOf(decide(memDb(base()), 'co', { sliceId: 's1', action: 'reject' }))).toBe('invalid-argument')
    const approved = base({ 'applications/s1': slice({ status: 'approved', glStatus: 'issued', amountApproved: 5000 }) })
    expect(await codeOf(decide(memDb(approved), 'co', { sliceId: 's1', action: 'reject', reason: 'Changed our mind' }))).toBe('failed-precondition')
  })
})

describe('settleLetter', () => {
  const open = (x = {}) => base({
    'applications/s1': slice({ status: 'approved', glStatus: 'issued', amountApproved: 6000, glExpiresAt: ts(NOW + 5 * DAY), ...x }),
    'requests/r1': { ...base()['requests/r1'], status: 'partially_funded', amountCommitted: 6000, openLetters: 1 },
  })

  it('mark issued, then redeem for less: committed −approved, disbursed +billed, letter settled', async () => {
    const db = memDb(open())
    await settle(db, 'co', { sliceId: 's1', action: 'mark_issued' })
    expect(db.store.get('applications/s1').status).toBe('certificate')
    expect(notesFor(db, 'pat')[0].title).toBe('Your Guarantee Letter has been issued')
    expect(await codeOf(settle(db, 'co', { sliceId: 's1', action: 'redeem', redeemedAmount: 6001 }))).toBe('invalid-argument')
    await settle(db, 'co', { sliceId: 's1', action: 'redeem', redeemedAmount: 5500 })
    expect(db.store.get('applications/s1')).toMatchObject({ glStatus: 'redeemed', redeemedAmount: 5500 })
    expect(db.store.get('agencies/dswd')).toMatchObject({ 'budget.committed': { inc: -6000 }, 'budget.disbursed': { inc: 5500 } })
    expect(db.store.get('requests/r1')).toMatchObject({ openLetters: 0, amountCommitted: 6000 })
  })

  it('undo a redemption puts the money back', async () => {
    const db = memDb(open({ status: 'certificate', glStatus: 'redeemed', redeemedAmount: 5500 }))
    await settle(db, 'co', { sliceId: 's1', action: 'undo_redeem' })
    expect(db.store.get('applications/s1')).toMatchObject({ glStatus: 'issued', redeemedAmount: null })
    expect(db.store.get('agencies/dswd')).toMatchObject({ 'budget.committed': { inc: 6000 }, 'budget.disbursed': { inc: -5500 } })
  })

  it('expire only past validity; a valid letter is reversed instead', async () => {
    expect(await codeOf(settle(memDb(open()), 'co', { sliceId: 's1', action: 'expire' }))).toBe('failed-precondition')
    const db = memDb(open({ glExpiresAt: ts(NOW - DAY) }))
    await settle(db, 'co', { sliceId: 's1', action: 'expire' })
    expect(db.store.get('applications/s1')).toMatchObject({ glStatus: 'expired', glExpiredBy: 'co' })
    expect(db.store.get('agencies/dswd')['budget.committed']).toEqual({ inc: -6000 })
    expect(await codeOf(settle(memDb(open({ glExpiresAt: ts(NOW - DAY) })), 'co', { sliceId: 's1', action: 'redeem', redeemedAmount: 100 }))).toBe('failed-precondition')
  })

  it('reverse: back to review, budget released, the repeat-limit mark kept', async () => {
    const db = memDb(open())
    db.store.set('approvalMarks/dswd__pat', { requestId: 'r1', lastApprovedAt: ts(NOW - DAY) })
    await settle(db, 'co', { sliceId: 's1', action: 'reverse' })
    expect(db.store.get('applications/s1')).toMatchObject({ status: 'reviewing', glStatus: null, reversedByUid: 'co' })
    expect(db.store.get('agencies/dswd')['budget.committed']).toEqual({ inc: -6000 })
    expect(db.store.get('requests/r1')).toMatchObject({ status: 'endorsed', amountCommitted: 0, openLetters: 0 })
    expect(db.store.get('approvalMarks/dswd__pat')).toBeTruthy()
    expect(await codeOf(settle(memDb(open({ glStatus: 'redeemed' })), 'co', { sliceId: 's1', action: 'reverse' }))).toBe('failed-precondition')
  })

  it("refuses another agency's letter", async () => {
    expect(await codeOf(settle(memDb(open()), 'coX', { sliceId: 's1', action: 'mark_issued' }))).toBe('permission-denied')
  })

  it('the sweep and a person cannot both release the same letter (M3)', async () => {
    // Redeemed first: the sweep finds it no longer issued and releases nothing.
    const db = memDb(open({ glExpiresAt: ts(NOW + DAY), approvedAt: ts(NOW - 9 * DAY) }))
    await settle(db, 'co', { sliceId: 's1', action: 'redeem', redeemedAmount: 6000 })
    const before = { ...db.store.get('agencies/dswd') }
    // The sweep's query still saw the letter as issued; its transaction re-reads it.
    const stale = { id: 's1', ref: db.doc('applications/s1'), data: () => ({ ...db.store.get('applications/s1'), glStatus: 'issued' }) }
    const sweepDb = { ...db, collection: () => ({ where: () => ({ where: () => ({ get: async () => ({ docs: [stale], size: 1 }) }) }) }) }
    const r = await handleGLExpirySweep({ db: sweepDb, cutoff: 'C', serverTimestamp: deps.serverTimestamp, increment: deps.increment })
    expect(r.skippedRaced).toBe(1)
    expect(r.releasedTotal).toBe(0)
    expect(db.store.get('agencies/dswd')).toEqual(before)
    expect(db.store.get('applications/s1').glStatus).toBe('redeemed')
  })
})

// Phase 4 PR 4.1: an open slice ended by the system.
describe('closeSliceCore', () => {
  let closeSliceCore
  beforeAll(() => { ;({ closeSliceCore } = require('../../functions/src/sliceActions')) })
  const system = { uid: 'system', name: 'MAPA (automatic)', role: 'system', system: 'slice_not_accepted' }
  const call = (db, from = ['endorsed']) => closeSliceCore({
    db, sliceRef: db.doc('applications/s1'), from, reason: 'Not accepted by the patient within 3 days.',
    closedAs: 'not_accepted', actor: system, auditAction: 'slice_not_accepted',
    patient: { type: 'app_advanced', title: 'Endorsement closed', body: 'x' }, overrides: deps,
  })

  it('closes an endorsed slice, recomputes the request, audits as the system, and sends as the server', async () => {
    const db = memDb(base({ 'applications/s1': slice({ status: 'endorsed' }) }))
    expect(await call(db)).toBeTruthy()
    expect(db.store.get('applications/s1')).toMatchObject({ status: 'closed', closedAs: 'not_accepted', closedBy: 'system:slice_not_accepted' })
    expect(db.store.get('requests/r1')).toMatchObject({ amountCommitted: 0 })
    expect(audits(db)[0]).toMatchObject({ action: 'slice_not_accepted', actorId: 'system' })
    expect(notesFor(db, 'pat')[0].fromUid).toBeNull()
  })

  it('leaves a slice that moved on meanwhile (the patient proceeded a minute before)', async () => {
    const db = memDb(base({ 'applications/s1': slice({ status: 'reviewing' }) }))
    expect(await call(db)).toBeNull()
    expect(db.store.get('applications/s1').status).toBe('reviewing')
  })

  it('gives the slot back only on the day it was endorsed', async () => {
    const today = memDb(base({ 'applications/s1': slice({ status: 'endorsed', endorsedAt: ts(NOW - 3600e3) }) }))
    await call(today)
    expect(today.store.get('agencies/dswd')['slots.remaining']).toBe(3)
    const older = memDb(base({ 'applications/s1': slice({ status: 'endorsed', endorsedAt: ts(NOW - 3 * DAY) }) }))
    await call(older)
    expect(Object.keys(older.store.get('agencies/dswd'))).not.toContain('slots.remaining')
  })
})
