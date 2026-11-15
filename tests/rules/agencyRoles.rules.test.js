import { loadRules } from './helpers/rules.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, increment, FieldPath } from 'firebase/firestore'

// Role review 2026-11-15: an agency coordinator writes only what its work
// changes (budget usage, today's remaining slots, one hospital's remaining
// slots); capacity, settings and enabled belong to the Agency Admin / Super
// Admin. The public projection can't rename or re-open an agency.
let testEnv
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-agency-roles',
    firestore: { rules: loadRules(), host: 'localhost', port: 8080 },
  })
})
afterAll(async () => testEnv?.cleanup())

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const put = (p, d) => setDoc(doc(db, ...p.split('/')), d)
    await Promise.all([
      put('users/coord', { role: 'agency', agencyId: 'dswd' }),
      put('users/aadmin', { role: 'agency_admin', agencyId: 'dswd' }),
      put('users/plat', { role: 'platform_admin' }),
      put('agencies/dswd', {
        name: 'DSWD', enabled: true, maxPerApplicant: 10000, assistanceTypes: ['Medicines'],
        slots: { total: 10, remaining: 5 }, lastResetDate: '2026-11-14',
        hospitalSlots: { 'hospital-1': { total: 4, remaining: 2 }, bgh: { total: 3, remaining: 3 } },
        budget: { allocated: 100000, committed: 0, disbursed: 0, period: 'monthly' },
      }),
      put('agenciesPublic/dswd', { name: 'DSWD', enabled: true, slots: { total: 10, remaining: 5 } }),
    ])
  })
})
const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const ag = (uid) => doc(as(uid), 'agencies', 'dswd')

describe('agency coordinator: usage only', () => {
  it('records budget usage, resets today\'s slots and restores one hospital\'s slot', async () => {
    await assertSucceeds(updateDoc(ag('coord'), { 'budget.committed': increment(5000) }))
    await assertSucceeds(updateDoc(ag('coord'), { 'budget.committed': increment(-5000), 'budget.disbursed': increment(5000) }))
    await assertSucceeds(updateDoc(ag('coord'), { 'slots.remaining': 10, lastResetDate: '2026-11-15' }))
    await assertSucceeds(updateDoc(ag('coord'), new FieldPath('hospitalSlots', 'hospital-1', 'remaining'), 3, 'slotRestoredFor', 'hospital-1'))
  })

  it("can't change capacity, settings, allocation or enabled", async () => {
    await assertFails(updateDoc(ag('coord'), { 'slots.total': 50 }))
    await assertFails(updateDoc(ag('coord'), new FieldPath('hospitalSlots', 'hospital-1', 'total'), 40, 'slotRestoredFor', 'hospital-1'))
    await assertFails(updateDoc(ag('coord'), { slotAdjustments: [{ type: 'add', delta: 5 }] }))
    await assertFails(updateDoc(ag('coord'), { 'budget.allocated': 999999 }))
    await assertFails(updateDoc(ag('coord'), { 'budget.period': 'yearly' }))
    await assertFails(updateDoc(ag('coord'), { maxPerApplicant: 999999 }))
    await assertFails(updateDoc(ag('coord'), { assistanceTypes: ['Anything'] }))
    await assertFails(updateDoc(ag('coord'), { enabled: false }))
    await assertFails(updateDoc(ag('coord'), { name: 'Renamed' }))
  })

  it('touches only the hospital it names', async () => {
    await assertFails(updateDoc(ag('coord'), new FieldPath('hospitalSlots', 'hospital-1', 'remaining'), 3))
    await assertFails(updateDoc(ag('coord'), new FieldPath('hospitalSlots', 'bgh', 'remaining'), 2, 'slotRestoredFor', 'hospital-1'))
    await assertFails(updateDoc(ag('coord'), {
      'hospitalSlots.hospital-1.remaining': 3, 'hospitalSlots.bgh.remaining': 2, slotRestoredFor: 'hospital-1',
    }))
  })
})

describe('agency admin and Super Admin', () => {
  it('the Agency Admin sets capacity and budget but not enabled', async () => {
    await assertSucceeds(updateDoc(ag('aadmin'), { 'slots.total': 20, 'budget.allocated': 200000 }))
    await assertSucceeds(updateDoc(ag('aadmin'), new FieldPath('hospitalSlots', 'bgh', 'total'), 6))
    await assertFails(updateDoc(ag('aadmin'), { enabled: false }))
  })

  it('the Super Admin can disable an agency', async () => {
    await assertSucceeds(updateDoc(ag('plat'), { enabled: false }))
  })
})

describe('agenciesPublic projection', () => {
  const pub = (uid) => doc(as(uid), 'agenciesPublic', 'dswd')
  it('agency users refresh it, but only with the real name and enabled', async () => {
    await assertSucceeds(setDoc(pub('coord'), { name: 'DSWD', enabled: true, slots: { total: 10, remaining: 4 } }))
    await assertFails(setDoc(pub('coord'), { name: 'DSWD', enabled: false, slots: { total: 10, remaining: 4 } }))
    await assertFails(setDoc(pub('coord'), { name: 'Fake', enabled: true, slots: { total: 10, remaining: 4 } }))
  })

  it('a missing enabled field on the agency counts as enabled (projection default)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'agencies', 'pcso'), { name: 'PCSO', slots: { total: 1, remaining: 1 } }))
    await testEnv.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'users', 'pcsoCoord'), { role: 'agency', agencyId: 'pcso' }))
    await assertSucceeds(setDoc(doc(as('pcsoCoord'), 'agenciesPublic', 'pcso'),
      { name: 'PCSO', enabled: true, slots: { total: 1, remaining: 1 } }))
  })
})
