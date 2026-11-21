/**
 * sendNotificationEmail + emailScope — Phase 1 (T1, gap I5/M5).
 * Email is sent only from the server, only to recipients the sender may
 * reach (decision P1-A), within the sender's hourly limit (P1-D), once per
 * notification, with HTML built and escaped on the server.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { memDb } from './helpers/memDb.js'

const require = createRequire(import.meta.url)
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: (o, fn) => fn }))
vi.mock('firebase-functions/params', () => ({ defineSecret: () => ({ value: () => '' }), defineString: () => ({ value: () => '' }) }))

let mayEmail, emailLimitFor, handleNotificationEmail, renderEmail
beforeAll(() => {
  ;({ mayEmail, emailLimitFor } = require('../../functions/src/emailScope'))
  ;({ handleNotificationEmail, renderEmail } = require('../../functions/src/sendNotificationEmail'))
})

const H = 'hosp-a', OTHER = 'hosp-b'
const patient   = (x = {}) => ({ uid: 'pat', role: 'patient', email: 'p@x.ph', tenantId: H, tenantIds: [H], agencyIds: ['dswd'], ...x })
const social    = (x = {}) => ({ uid: 'sw', role: 'staff_admin', email: 's@x.ph', tenantId: H, ...x })
const coord     = (x = {}) => ({ uid: 'co', role: 'agency', email: 'c@x.ph', agencyId: 'dswd', ...x })
const platform  = (x = {}) => ({ uid: 'pl', role: 'platform_admin', email: 'pl@x.ph', ...x })
const partners  = { dswd: [H], pcso: [OTHER] }

describe('mayEmail — who may email whom (P1-A)', () => {
  it('a server event reaches anyone with an email', () => {
    expect(mayEmail(null, patient()).allowed).toBe(true)
  })
  it('a patient reaches only themselves', () => {
    expect(mayEmail(patient(), patient()).allowed).toBe(true)
    expect(mayEmail(patient(), patient({ uid: 'other' })).allowed).toBe(false)
    expect(mayEmail(patient(), social()).allowed).toBe(false)
  })
  it("hospital staff reach their hospital's patients and staff, not another hospital's", () => {
    expect(mayEmail(social(), patient()).allowed).toBe(true)
    expect(mayEmail(social(), patient({ tenantId: OTHER, tenantIds: [OTHER] })).allowed).toBe(false)
    // marketplace: a patient who filed here before and is now elsewhere
    expect(mayEmail(social(), patient({ tenantId: OTHER, tenantIds: [H, OTHER] })).allowed).toBe(true)
    expect(mayEmail(social(), social({ uid: 'sw2' })).allowed).toBe(true)
    expect(mayEmail(social(), social({ uid: 'sw2', tenantId: OTHER })).allowed).toBe(false)
  })
  it('hospital staff reach agency staff only of a partner agency', () => {
    expect(mayEmail(social(), coord(), partners).allowed).toBe(true)
    expect(mayEmail(social(), coord({ agencyId: 'pcso' }), partners).allowed).toBe(false)
  })
  it('agency staff reach endorsed patients, their own team and partner hospital staff', () => {
    expect(mayEmail(coord(), patient(), partners).allowed).toBe(true)
    expect(mayEmail(coord(), patient({ agencyIds: [] }), partners).allowed).toBe(false)
    expect(mayEmail(coord(), coord({ uid: 'co2', role: 'agency_admin' }), partners).allowed).toBe(true)
    expect(mayEmail(coord(), coord({ uid: 'x', agencyId: 'pcso' }), partners).allowed).toBe(false)
    expect(mayEmail(coord(), social(), partners).allowed).toBe(true)
    expect(mayEmail(coord(), social({ tenantId: OTHER }), partners).allowed).toBe(false)
  })
  it('the Super Admin reaches staff, never patients', () => {
    expect(mayEmail(platform(), social()).allowed).toBe(true)
    expect(mayEmail(platform(), coord()).allowed).toBe(true)
    expect(mayEmail(platform(), patient()).allowed).toBe(false)
  })
  it('never emails an inactive or emailless recipient', () => {
    expect(mayEmail(null, patient({ email: '' })).reason).toBe('no-email')
    expect(mayEmail(null, patient({ active: false })).reason).toBe('inactive-recipient')
    expect(mayEmail(null, patient({ deletion: true })).reason).toBe('inactive-recipient')
  })
  it('hourly limits: patients 10, staff 120 (P1-D)', () => {
    expect(emailLimitFor(patient())).toBe(10)
    expect(emailLimitFor(social())).toBe(120)
    expect(emailLimitFor(coord())).toBe(120)
  })
})

describe('renderEmail', () => {
  it('escapes everything that came from a client', () => {
    const { html, subject } = renderEmail({ title: 'Hi <b>', body: '<script>alert(1)</script>\nline 2', footer: 'MAPA · A&B' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('line 2')
    expect(html).toContain('A&amp;B')
    expect(subject).toBe('Hi <b>')
  })
})

function setup({ notif = {}, users = {}, extra = {} } = {}) {
  const db = memDb({
    'users/pat': patient(),
    'users/sw': social(),
    'users/co': coord(),
    'agencies/dswd': { partnerHospitalIds: [H] },
    [`hospitals/${H}`]: { facilityName: 'Example Medical Center' },
    'notifications/pat/items/n1': { title: 'Update', body: 'Your request moved.', fromUid: 'sw', ...notif },
    ...Object.fromEntries(Object.entries(users).map(([k, v]) => [`users/${k}`, v])),
    ...extra,
  })
  const sent = []
  const sendMail = async (m) => { sent.push(m) }
  return { db, sent, sendMail }
}

const stateOf = (db, path = 'notifications/pat/items/n1') => db.store.get(path).email

describe('handleNotificationEmail', () => {
  it("emails a hospital staff member's notification to their patient, with the hospital footer", async () => {
    const { db, sent, sendMail } = setup()
    await handleNotificationEmail({ db, uid: 'pat', notifId: 'n1', sendMail })
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('p@x.ph')
    expect(sent[0].subject).toBe('Update')
    expect(sent[0].text).toContain('Example Medical Center')
    expect(stateOf(db).state).toBe('sent')
  })

  it('sends once even if the trigger fires twice', async () => {
    const { db, sent, sendMail } = setup()
    await handleNotificationEmail({ db, uid: 'pat', notifId: 'n1', sendMail })
    const r = await handleNotificationEmail({ db, uid: 'pat', notifId: 'n1', sendMail })
    expect(r.skipped).toBe('already-handled')
    expect(sent).toHaveLength(1)
  })

  it('emails server events (no fromUid)', async () => {
    const { db, sent, sendMail } = setup({ notif: { fromUid: null } })
    await handleNotificationEmail({ db, uid: 'pat', notifId: 'n1', sendMail })
    expect(sent).toHaveLength(1)
  })

  it('skips a sender outside the scope, keeping the in-app notification', async () => {
    const { db, sent, sendMail } = setup({ notif: { fromUid: 'sw' }, users: { sw: social({ tenantId: OTHER }) } })
    await handleNotificationEmail({ db, uid: 'pat', notifId: 'n1', sendMail })
    expect(sent).toHaveLength(0)
    expect(stateOf(db)).toMatchObject({ state: 'skipped', reason: 'out-of-scope' })
    expect(db.store.get('notifications/pat/items/n1').title).toBe('Update')
  })

  it('skips in-app-only notifications (announcement fan-outs)', async () => {
    const { db, sent, sendMail } = setup({ notif: { fromUid: null, channel: 'inapp' } })
    await handleNotificationEmail({ db, uid: 'pat', notifId: 'n1', sendMail })
    expect(sent).toHaveLength(0)
    expect(stateOf(db).reason).toBe('in-app-only')
  })

  it('skips an unknown sender', async () => {
    const { db, sent, sendMail } = setup({ notif: { fromUid: 'ghost' } })
    await handleNotificationEmail({ db, uid: 'pat', notifId: 'n1', sendMail })
    expect(sent).toHaveLength(0)
    expect(stateOf(db).reason).toBe('unknown-sender')
  })

  it("stops a patient's 11th email in an hour", async () => {
    const extra = {}
    for (let i = 1; i <= 11; i++) extra[`notifications/pat/items/s${i}`] = { title: `t${i}`, body: 'b', fromUid: 'pat' }
    const { db, sent, sendMail } = setup({ extra })
    for (let i = 1; i <= 11; i++) await handleNotificationEmail({ db, uid: 'pat', notifId: `s${i}`, sendMail })
    expect(sent).toHaveLength(10)
    expect(stateOf(db, 'notifications/pat/items/s11').reason).toBe('rate-limited')
  })

  it('records a failed send instead of throwing', async () => {
    const { db } = setup()
    const sendMail = async () => { const e = new Error('smtp down'); e.code = 'ECONNECTION'; throw e }
    await handleNotificationEmail({ db, uid: 'pat', notifId: 'n1', sendMail })
    expect(stateOf(db)).toMatchObject({ state: 'failed', reason: 'ECONNECTION' })
  })
})
