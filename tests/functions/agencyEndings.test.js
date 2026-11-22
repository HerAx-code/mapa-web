/**
 * Phase 4 PR 4.3 (P4-D, gaps M2, M13): removing a partner hospital closes that
 * hospital's open slices at the agency; disabling stamps disabledAt for the
 * case timers; the Super Admin gets the open count from the server.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { memDb } from './helpers/memDb.js'

const require = createRequire(import.meta.url)
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (o, fn) => fn }))
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (o, fn) => fn,
  HttpsError: class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code } },
}))

let handleAgencyEndings, handleCountAgencyOpenSlices
beforeAll(() => { ;({ handleAgencyEndings, handleCountAgencyOpenSlices } = require('../../functions/src/onAgencyWritten')) })

const A = 'hosp-a', B = 'hosp-b'
const ts = (ms) => ({ toMillis: () => ms })
const agency = (x = {}) => ({ name: 'DSWD', enabled: true, partnerHospitalIds: [A, B], slots: { total: 5, remaining: 2 }, ...x })
const slice = (tenantId, status, x = {}) => ({ requestId: `r-${tenantId}`, agencyId: 'dswd', agencyName: 'DSWD', patientId: `p-${tenantId}`, tenantId, status, amountRequested: 1000, endorsedById: `sw-${tenantId}`, ...x })
const seed = () => memDb({
  'agencies/dswd': agency({ partnerHospitalIds: [A] }),
  'requests/r-hosp-a': { patientId: 'p-hosp-a', tenantId: A, status: 'endorsed', amountNeeded: 1000 },
  'requests/r-hosp-b': { patientId: 'p-hosp-b', tenantId: B, status: 'endorsed', amountNeeded: 1000 },
  'applications/a1': slice(A, 'reviewing'),
  'applications/b1': slice(B, 'endorsed', { endorsedAt: ts(Date.UTC(2026, 10, 1)) }),
  'applications/b2': slice(B, 'approved', { glStatus: 'issued', amountApproved: 1000 }),
  'users/plat': { role: 'platform_admin' },
  'users/sw': { role: 'staff_admin', tenantId: A },
})
const deps = { serverTimestamp: () => 'TS', deleteField: () => 'DELETE', sliceOverrides: { serverTimestamp: () => 'TS', increment: (n) => ({ inc: n }) } }

describe('handleAgencyEndings', () => {
  it("removing a partner closes only that hospital's open slices; letters and other hospitals untouched", async () => {
    const db = seed()
    const r = await handleAgencyEndings({ db, agencyId: 'dswd', before: agency(), after: agency({ partnerHospitalIds: [A] }), ...deps })
    expect(r.closed).toBe(1)
    expect(db.store.get('applications/b1')).toMatchObject({ status: 'closed', closedAs: 'partner_ended', closedBy: 'system:partner_ended' })
    expect(db.store.get('applications/b2').status).toBe('approved')
    expect(db.store.get('applications/a1').status).toBe('reviewing')
    const notes = [...db.store.entries()].filter(([k]) => k.startsWith('notifications/p-hosp-b/items/'))
    expect(notes).toHaveLength(1)
  })

  it('stamps disabledAt on disable and clears it on re-enable', async () => {
    const db = seed()
    expect((await handleAgencyEndings({ db, agencyId: 'dswd', before: agency(), after: agency({ enabled: false }), ...deps })).disabledAt).toBe('set')
    expect(db.store.get('agencies/dswd').disabledAt).toBe('TS')
    expect((await handleAgencyEndings({ db, agencyId: 'dswd', before: agency({ enabled: false }), after: agency({ disabledAt: 'TS' }), ...deps })).disabledAt).toBe('cleared')
  })

  it('does nothing for an unrelated change', async () => {
    const db = seed()
    expect(await handleAgencyEndings({ db, agencyId: 'dswd', before: agency(), after: agency({ name: 'DSWD Region' }), ...deps })).toEqual({ closed: 0, disabledAt: null })
  })
})

describe('countAgencyOpenSlices', () => {
  it('gives the Super Admin the open count per hospital; nobody else', async () => {
    const db = seed()
    expect(await handleCountAgencyOpenSlices({ callerUid: 'plat', data: { agencyId: 'dswd' }, db })).toEqual({ total: 2, byHospital: { [A]: 1, [B]: 1 } })
    await expect(handleCountAgencyOpenSlices({ callerUid: 'sw', data: { agencyId: 'dswd' }, db })).rejects.toMatchObject({ code: 'permission-denied' })
  })
})
