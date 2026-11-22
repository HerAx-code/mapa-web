/**
 * identityIndex — flags patient accounts that look like the same person
 * (input verification Phase 1). Same-hospital matches list uids; matches at
 * another hospital are a count only (tenant boundary). Nothing is blocked.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

vi.mock('firebase-admin', () => ({ default: { firestore: () => ({}) }, firestore: () => ({}) }))
vi.mock('firebase-functions', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (o, fn) => fn }))
vi.mock('firebase-functions/params', () => ({ defineSecret: () => ({ value: () => 'k' }) }))

let m
beforeAll(() => { m = require('../../functions/src/identityIndex') })

const FieldValue = {
  arrayUnion: (...v) => ({ __union: v }),
  arrayRemove: (...v) => ({ __remove: v }),
  serverTimestamp: () => 'TS',
}
function makeDb(seed = {}) {
  const store = JSON.parse(JSON.stringify(seed)) // { 'col/id': data }
  const apply = (cur, d) => {
    const out = { ...cur }
    for (const [k, v] of Object.entries(d)) {
      if (v && v.__union) out[k] = [...new Set([...(out[k] ?? []), ...v.__union])]
      else if (v && v.__remove) out[k] = (out[k] ?? []).filter(x => !v.__remove.includes(x))
      else out[k] = v
    }
    return out
  }
  return {
    store,
    collection: (col) => ({
      doc: (id) => ({
        get: async () => ({ exists: store[`${col}/${id}`] !== undefined, data: () => store[`${col}/${id}`] }),
        set: async (d, opt) => { store[`${col}/${id}`] = apply(opt?.merge ? (store[`${col}/${id}`] ?? {}) : {}, d) },
      }),
    }),
  }
}
const hmac = (kind, v) => `${kind}:${v}` // readable stand-in for the HMAC
const patient = (name, contact, tenantIds) => ({ role: 'patient', name, contact, tenantId: tenantIds[0], tenantIds })
const index = (db, uid, user) => m.handleIdentityIndex({ db, uid, values: m.profileValues(user), hmac, FieldValue })

describe('normalisation', () => {
  it('matches names regardless of case, accents and spacing', () => {
    expect(m.normalizeName('  JOSÉ  dela-Cruz ')).toBe('jose dela cruz')
  })
  it('matches PH mobile numbers in any format', () => {
    expect(m.normalizePhone('0917 123 4567')).toBe('9171234567')
    expect(m.normalizePhone('+63 917-123-4567')).toBe('9171234567')
    expect(m.normalizePhone('12345')).toBe('')
  })
})

describe('handleIdentityIndex', () => {
  it('records "checked, nothing found" for a lone patient', async () => {
    const db = makeDb({ 'users/a': patient('Ana Cruz', '09171234567', ['h1']) })
    await index(db, 'a', db.store['users/a'])
    expect(db.store['identityFlags/h1__a'].matches).toEqual([])
  })

  it('flags a second account with the same name and phone at the same hospital — both ways', async () => {
    const db = makeDb({
      'users/a': patient('Ana Cruz', '09171234567', ['h1']),
      'users/b': patient('ANA CRUZ', '+639171234567', ['h1']),
    })
    await index(db, 'a', db.store['users/a'])
    await index(db, 'b', db.store['users/b'])
    const fa = db.store['identityFlags/h1__a'].matches
    expect(fa.find(x => x.kind === 'name_phone')).toEqual({ kind: 'name_phone', sameHospitalUids: ['b'], otherHospitalCount: 0 })
    expect(db.store['identityFlags/h1__b'].matches.find(x => x.kind === 'name_phone').sameHospitalUids).toEqual(['a'])
  })

  it('a match at ANOTHER hospital is a count only — no uid crosses the boundary', async () => {
    const db = makeDb({
      'users/a': patient('Ana Cruz', '09171234567', ['h1']),
      'users/b': patient('Ana Cruz', '09171234567', ['h2']),
    })
    await index(db, 'a', db.store['users/a'])
    await index(db, 'b', db.store['users/b'])
    const flag = db.store['identityFlags/h1__a']
    expect(flag.matches.find(x => x.kind === 'name_phone')).toEqual({ kind: 'name_phone', sameHospitalUids: [], otherHospitalCount: 1 })
    expect(JSON.stringify(flag)).not.toContain('"b"')
  })

  it('a shared phone alone is its own, weaker match', async () => {
    const db = makeDb({
      'users/a': patient('Ana Cruz', '09171234567', ['h1']),
      'users/b': patient('Ben Cruz', '09171234567', ['h1']),
    })
    await index(db, 'a', db.store['users/a'])
    await index(db, 'b', db.store['users/b'])
    expect(db.store['identityFlags/h1__a'].matches.map(x => x.kind)).toEqual(['phone'])
  })

  it('the same PhilSys card on two accounts is flagged', async () => {
    const db = makeDb({
      'users/a': patient('Ana Cruz', '', ['h1']),
      'users/b': patient('Other Name', '', ['h2']),
    })
    await m.handleIdentityIndex({ db, uid: 'a', values: { pcn: 'fp1' }, hmac, FieldValue })
    await m.handleIdentityIndex({ db, uid: 'b', values: { pcn: 'fp1' }, hmac, FieldValue })
    expect(db.store['identityFlags/h1__a'].matches).toEqual([{ kind: 'pcn', sameHospitalUids: [], otherHospitalCount: 1 }])
  })

  it('changing the phone keeps the old match as "past" for both accounts until a social worker clears it (N18)', async () => {
    const db = makeDb({
      'users/a': patient('Ana Cruz', '09171234567', ['h1']),
      'users/b': patient('Ben Cruz', '09171234567', ['h1']),
    })
    await index(db, 'a', db.store['users/a'])
    await index(db, 'b', db.store['users/b'])
    db.store['users/b'].contact = '09998887777'
    await index(db, 'b', db.store['users/b'])
    for (const u of ['a', 'b']) {
      const ms = db.store[`identityFlags/h1__${u}`].matches
      expect(ms).toHaveLength(1)
      expect(ms[0]).toMatchObject({ kind: 'phone', past: true })
    }
  })

  it('clearIdentityFlag: hospital staff clear past matches with a reason; current ones stay', async () => {
    const db = makeDb({
      'users/sw': { role: 'staff_admin', tenantId: 'h1', name: 'SW' },
      'users/swB': { role: 'staff_admin', tenantId: 'h2', name: 'Other' },
      'identityFlags/h1__a': { uid: 'a', tenantId: 'h1', matches: [
        { kind: 'phone', sameHospitalUids: ['b'], otherHospitalCount: 0, past: true },
        { kind: 'pcn', sameHospitalUids: ['c'], otherHospitalCount: 0 },
      ] },
    })
    db.collection = ((orig) => (col) => (col === 'auditLog' ? { add: async (d) => { db.store['auditLog/x'] = d } } : orig(col)))(db.collection)
    db.doc = (path) => { const [c, id] = path.split('/'); return db.collection(c).doc(id) }
    const call = (callerUid, data) => m.handleClearIdentityFlag({ callerUid, data, db, FieldValue })
    await expect(call('sw', { patientId: 'a', reason: 'short' })).rejects.toMatchObject({ code: 'invalid-argument' })
    await expect(call('swB', { patientId: 'a', reason: 'Asked the patient about it' })).rejects.toMatchObject({ code: 'not-found' })
    expect(await call('sw', { patientId: 'a', reason: 'Asked the patient: old number was a relative' })).toEqual({ cleared: 1 })
    expect(db.store['identityFlags/h1__a'].matches.map((x) => x.kind)).toEqual(['pcn'])
    expect(db.store['identityFlags/h1__a'].cleared).toMatchObject({ byUid: 'sw', kinds: ['phone'] })
    expect(db.store['auditLog/x']).toMatchObject({ action: 'identity_flag_cleared', patientId: 'a' })
  })

  it('writes one flag per hospital the patient filed with', async () => {
    const db = makeDb({
      'users/a': patient('Ana Cruz', '09171234567', ['h1', 'h2']),
      'users/b': patient('Ana Cruz', '09171234567', ['h2']),
    })
    await index(db, 'b', db.store['users/b'])
    await index(db, 'a', db.store['users/a'])
    expect(db.store['identityFlags/h1__a'].matches[0]).toMatchObject({ sameHospitalUids: [], otherHospitalCount: 1 })
    expect(db.store['identityFlags/h2__a'].matches[0]).toMatchObject({ sameHospitalUids: ['b'], otherHospitalCount: 0 })
  })
})

describe('profileChanged', () => {
  it('ignores writes that do not touch name, phone or hospitals', () => {
    const u = patient('Ana', '09171234567', ['h1'])
    expect(m.profileChanged(u, { ...u, documentCount: 3 })).toBe(false)
    expect(m.profileChanged(u, { ...u, tenantIds: ['h1', 'h2'] })).toBe(true)
    expect(m.profileChanged(null, u)).toBe(true)
  })
})
