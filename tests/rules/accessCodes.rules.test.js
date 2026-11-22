import { loadRules } from './helpers/rules.js'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, deleteDoc, getDoc, writeBatch } from 'firebase/firestore'
import { claimCode } from './helpers/marketplace.js'
import { issueCode, issuedRecord } from './helpers/codes.js'
import fs from 'node:fs'
import path from 'node:path'

// Multi-hospital Phase 8 — per-hospital access codes
// (docs/multi-hospital-network-plan.md). Prefixes are claimed once
// (accessCodePrefixes) so they stay unique network-wide; each hospital issues
// codes only under its own prefix; a disabled hospital takes no registrations.
const A = 'hospital-1'
const B = 'bgh'
let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'mapa-rules-test-access-codes',
    firestore: {
      rules: loadRules(),
      host: 'localhost',
      port: 8080,
    },
  })
})
afterAll(async () => testEnv?.cleanup())

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const put = (p, d) => setDoc(doc(db, ...p.split('/')), d)
    await Promise.all([
      put('hospitals/hospital-1', { gatewayName: 'MSS A', accessCodePrefix: 'MAPA', enabled: true }),
      put('hospitals/bgh', { gatewayName: 'MSS B', accessCodePrefix: 'BGH', enabled: true }),
      put('hospitals/closed', { gatewayName: 'MSS C', accessCodePrefix: 'CLS', enabled: false }),
      put('accessCodePrefixes/MAPA', { tenantId: A }),
      put('accessCodePrefixes/BGH', { tenantId: B }),
      put('accessCodePrefixes/BGHOLD', { tenantId: B }),          // B's retired prefix
      put('accessCodePrefixes/CLS', { tenantId: 'closed' }),
      put('users/plat', { role: 'platform_admin' }),
      put('users/superA', { role: 'super_admin', tenantId: A }),
      put('users/superB', { role: 'super_admin', tenantId: B }),
      put('hospitalIds/MAPA-2026-00001', { status: 'available', patId: null, tenantId: A }),
      put('hospitalIds/CLS-2026-00001', { status: 'available', patId: null, tenantId: 'closed' }),
    ])
  })
})

const as = (uid) => testEnv.authenticatedContext(uid).firestore()
const ref = (uid, p) => doc(as(uid), ...p.split('/'))
const NEW = { gatewayName: 'MSS', facilityName: 'Cotabato Provincial Hospital', enabled: true }

describe('prefix claims keep prefixes unique (D5)', () => {
  it('a new hospital and its prefix claim are written together', async () => {
    const db = as('plat')
    const b = writeBatch(db)
    b.set(doc(db, 'hospitals', 'cph'), { ...NEW, accessCodePrefix: 'CPH' })
    b.set(doc(db, 'accessCodePrefixes', 'CPH'), { tenantId: 'cph' })
    await assertSucceeds(b.commit())
  })

  it('a hospital without its claim is denied', async () => {
    await assertFails(setDoc(ref('plat', 'hospitals/cph'), { ...NEW, accessCodePrefix: 'CPH' }))
  })

  it("another hospital's prefix — current or retired — can't be taken", async () => {
    await assertFails(setDoc(ref('plat', 'hospitals/cph'), { ...NEW, accessCodePrefix: 'BGH' }))
    await assertFails(setDoc(ref('plat', 'hospitals/cph'), { ...NEW, accessCodePrefix: 'BGHOLD' }))
    await assertFails(updateDoc(ref('plat', 'hospitals/hospital-1'), { accessCodePrefix: 'BGH' }))
  })

  it('a hospital may go back to a prefix it already holds', async () => {
    await assertSucceeds(updateDoc(ref('plat', 'hospitals/bgh'), { accessCodePrefix: 'BGHOLD' }))
  })

  it('other edits need no claim when the prefix is unchanged', async () => {
    await assertSucceeds(updateDoc(ref('plat', 'hospitals/bgh'), { gatewayName: 'Malasakit Desk' }))
  })

  it('a claim must match the hospital it names, and be well-formed', async () => {
    await assertFails(setDoc(ref('plat', 'accessCodePrefixes/XYZ'), { tenantId: B }))     // bgh's prefix is BGH
    const db = as('plat')
    const b = writeBatch(db)
    b.set(doc(db, 'hospitals', 'low'), { ...NEW, accessCodePrefix: 'low' })
    b.set(doc(db, 'accessCodePrefixes', 'low'), { tenantId: 'low' })
    await assertFails(b.commit())
  })

  it('claims are permanent and platform-only', async () => {
    await assertFails(updateDoc(ref('plat', 'accessCodePrefixes/BGH'), { tenantId: A }))
    await assertFails(deleteDoc(ref('plat', 'accessCodePrefixes/BGHOLD')))
    const db = as('superA')
    const b = writeBatch(db)
    b.set(doc(db, 'accessCodePrefixes', 'NEWA'), { tenantId: A })
    b.update(doc(db, 'hospitals', 'hospital-1'), { accessCodePrefix: 'NEWA' })
    await assertFails(b.commit())
  })

  it('anyone signed in can read a claim (prefixes are printed on code cards)', async () => {
    await assertSucceeds(getDoc(ref('superB', 'accessCodePrefixes/MAPA')))
  })
})

// Phase 3 PR 3.4: issuing and claiming run on the server (issueAccessCode /
// claimAccessCode). The browser can no longer do either; the prefix check,
// well-formedness and the paused-hospital rule now live server-side and are
// covered by tests/functions/codeActions.test.js.
describe('issuing a code is a server action now', () => {
  const code = (tenantId) => ({ status: 'available', patId: null, tenantId })
  it('no browser issues a code, even under its own well-formed prefix', async () => {
    await assertFails(issueCode(as('superA'), 'MAPA-2026-00002', { tenantId: A, issued: issuedRecord({ issuedByUid: 'superA' }) }))
    await assertFails(issueCode(as('superB'), 'BGH-2026-00001', { tenantId: B, issued: issuedRecord({ issuedByUid: 'superB' }) }))
    await assertFails(setDoc(ref('superA', 'hospitalIds/MAPA-2026-00003'), code(A)))
  })
})

describe('claiming a code is a server action now', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'users', 'new1'), { role: 'patient', name: 'Juan', agencyId: null })
      await setDoc(doc(db, 'users', 'new2'), { role: 'patient', name: 'Ana', agencyId: null })
    })
  })
  it('no browser claims a code, open or paused hospital', async () => {
    await assertFails(claimCode(as('new1'), { uid: 'new1', code: 'MAPA-2026-00001', tenantId: A, tenantIds: [A] }))
    await assertFails(claimCode(as('new2'), { uid: 'new2', code: 'CLS-2026-00001', tenantId: 'closed', tenantIds: ['closed'] }))
  })
})

// Landing page projection: world-readable, and it must mirror its hospital.
describe('hospitalsPublic — public, and always equal to the hospital doc', () => {
  const pub = { facilityName: '', shortName: '', accessCodePrefix: 'MAPA', enabled: true, gatewayName: 'MSS A' }

  it('anyone, signed out included, can read it', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore(), 'hospitalsPublic', 'hospital-1'), pub))
    await assertSucceeds(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'hospitalsPublic', 'hospital-1')))
  })

  it('no browser writes it, not even a faithful copy (Phase 5 PR 5.2: onHospitalWritten only)', async () => {
    await assertFails(setDoc(ref('plat', 'hospitalsPublic/bgh'), { ...pub, accessCodePrefix: 'BGH', gatewayName: 'MSS B' }))
    await assertFails(setDoc(ref('superA', 'hospitalsPublic/hospital-1'), pub))
  })

  it('a copy that disagrees with the hospital is denied (prefix, sign-ups, name)', async () => {
    await assertFails(setDoc(ref('plat', 'hospitalsPublic/bgh'), { ...pub, accessCodePrefix: 'MAPA' }))
    await assertFails(setDoc(ref('plat', 'hospitalsPublic/closed'), { ...pub, accessCodePrefix: 'CLS', enabled: true }))
    await assertFails(setDoc(ref('superA', 'hospitalsPublic/hospital-1'), { ...pub, facilityName: 'Fake Hospital' }))
  })

  // Marketplace: office, location and contact are public too — and mirrored.
  it('the marketplace fields (office, address, region, email) must mirror the hospital', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) =>
      updateDoc(doc(ctx.firestore(), 'hospitals', 'hospital-1'), { address: 'Cotabato City', region: 'BARMM' }))
    // The trigger projects them (tests/functions/patientIdsAndListing.test.js); browsers can't.
    await assertFails(setDoc(ref('superA', 'hospitalsPublic/hospital-1'), { ...pub, address: 'Cotabato City', region: 'BARMM' }))
    await assertFails(setDoc(ref('superA', 'hospitalsPublic/hospital-1'), { ...pub, address: 'Somewhere else', region: 'BARMM' }))
    await assertFails(setDoc(ref('superA', 'hospitalsPublic/hospital-1'), { ...pub, address: 'Cotabato City', region: 'BARMM', contactEmail: 'x@y.ph' }))
  })

  it("another hospital's super admin, patients and extra fields are denied", async () => {
    await assertFails(setDoc(ref('superA', 'hospitalsPublic/bgh'), { ...pub, accessCodePrefix: 'BGH', gatewayName: 'MSS B' }))
    await assertFails(setDoc(ref('new1', 'hospitalsPublic/hospital-1'), pub))
    await assertFails(setDoc(ref('plat', 'hospitalsPublic/hospital-1'), { ...pub, staff: ['x'] }))
  })
})
