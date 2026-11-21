/**
 * Announcement fan-out and reminders on the server — Phase 1 (M19, M20).
 * The audience picked on the form (targetRoles) at the announcement's own
 * hospital is notified, in-app only; the 24-hour reminder goes out once.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { memDb } from './helpers/memDb.js'

const require = createRequire(import.meta.url)
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: (o, fn) => fn }))
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (o, fn) => fn }))

let audienceUids, handleAnnouncementCreated, handleAnnouncementReminders
beforeAll(() => {
  ;({ audienceUids, handleAnnouncementCreated, handleAnnouncementReminders } = require('../../functions/src/announcements'))
})

const H = 'hosp-a', OTHER = 'hosp-b'
const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) })
const serverTimestamp = () => 'TS'

const people = () => ({
  'users/p1': { role: 'patient', tenantId: H, tenantIds: [H] },
  'users/p2': { role: 'patient', tenantId: OTHER, tenantIds: [H, OTHER] },   // filed here before
  'users/p3': { role: 'patient', tenantId: OTHER, tenantIds: [OTHER] },      // another hospital's
  'users/legacy': { role: 'patient', tenantId: H },                          // pre-marketplace
  'users/gone': { role: 'patient', tenantId: H, tenantIds: [H], active: false },
  'users/sw': { role: 'staff_admin', tenantId: H },
  'users/swB': { role: 'staff_admin', tenantId: OTHER },
  'users/co': { role: 'agency', agencyId: 'dswd' },
  'users/coX': { role: 'agency', agencyId: 'pcso' },
  'agencies/dswd': { partnerHospitalIds: [H] },
  'agencies/pcso': { partnerHospitalIds: [OTHER] },
})

const notified = (db) => [...db.store.keys()].filter((k) => k.startsWith('notifications/')).map((k) => k.split('/')[1]).sort()

describe('audienceUids', () => {
  it("patients = this hospital's patients (incl. marketplace and legacy), never another hospital's", async () => {
    const db = memDb(people())
    expect((await audienceUids({ db, ann: { tenantId: H, targetRoles: ['patient'] } })).sort()).toEqual(['legacy', 'p1', 'p2'])
  })
  it("'admin' = this hospital's staff only", async () => {
    const db = memDb(people())
    expect(await audienceUids({ db, ann: { tenantId: H, targetRoles: ['admin'] } })).toEqual(['sw'])
  })
  it('agency roles = staff of agencies that partner with this hospital', async () => {
    const db = memDb(people())
    expect(await audienceUids({ db, ann: { tenantId: H, targetRoles: ['agency'] } })).toEqual(['co'])
  })
  it('agency promotions notify nobody', async () => {
    const db = memDb(people())
    expect(await audienceUids({ db, ann: { tenantId: H, source: 'agency', targetRoles: ['patient'] } })).toEqual([])
  })
})

describe('handleAnnouncementCreated', () => {
  it('notifies only the chosen audience, in-app only, as a server event', async () => {
    const db = memDb(people())
    const r = await handleAnnouncementCreated({ db, serverTimestamp, ann: { tenantId: H, targetRoles: ['admin'], title: 'Downtime', message: 'Saturday' } })
    expect(r.notified).toBe(1)
    expect(notified(db)).toEqual(['sw'])
    const [n] = [...db.store.entries()].filter(([k]) => k.startsWith('notifications/')).map(([, v]) => v)
    expect(n).toMatchObject({ type: 'system_announcement', title: 'Downtime', fromUid: null, channel: 'inapp', read: false })
  })
})

describe('handleAnnouncementReminders', () => {
  const NOW = Date.UTC(2026, 10, 21, 2, 0)
  it('reminds once, within 24 hours of the start', async () => {
    const db = memDb({
      ...people(),
      'announcements/soon': { tenantId: H, targetRoles: ['admin'], title: 'Downtime', message: 'm', reminderSent: false, startAt: ts(NOW + 3 * 3600e3) },
      'announcements/later': { tenantId: H, targetRoles: ['admin'], title: 'Later', message: 'm', reminderSent: false, startAt: ts(NOW + 30 * 3600e3) },
      'announcements/past': { tenantId: H, targetRoles: ['admin'], title: 'Past', message: 'm', reminderSent: false, startAt: ts(NOW - 3600e3) },
    })
    const r1 = await handleAnnouncementReminders({ db, nowMs: NOW, serverTimestamp })
    expect(r1.sent).toBe(1)
    expect(db.store.get('announcements/soon').reminderSent).toBe(true)
    expect(db.store.get('announcements/later').reminderSent).toBe(false)
    const r2 = await handleAnnouncementReminders({ db, nowMs: NOW + 60e3, serverTimestamp })
    expect(r2.sent).toBe(0)
    expect(notified(db)).toEqual(['sw'])
  })
})
