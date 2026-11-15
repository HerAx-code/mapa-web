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

  it('changing the phone clears the old match for both accounts', async () => {
    const db = makeDb({
      'users/a': patient('Ana Cruz', '09171234567', ['h1']),
      'users/b': patient('Ben Cruz', '09171234567', ['h1']),
    })
    await index(db, 'a', db.store['users/a'])
    await index(db, 'b', db.store['users/b'])
    db.store['users/b'].contact = '09998887777'
    await index(db, 'b', db.store['users/b'])
    expect(db.store['identityFlags/h1__a'].matches).toEqual([])
    expect(db.store['identityFlags/h1__b'].matches).toEqual([])
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
