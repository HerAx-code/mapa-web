/**
 * Two-factor stage 2 for the callables (Phase 5 PR 5.4, decision P5-D).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { memDb } from './helpers/memDb.js'

const require = createRequire(import.meta.url)
let mod
beforeAll(() => { mod = require('../../functions/src/mfaPolicy') })
const codeOf = async (p) => { try { await p; return null } catch (e) { return e.code } }

describe('assertStaffMfa', () => {
  const db = () => memDb({ 'users/sw': { role: 'staff_admin' }, 'users/pat': { role: 'patient' } })
  it('when on: refuses a staff caller without a second factor; allows one with it, and patients', async () => {
    expect(await codeOf(mod.assertStaffMfa(db(), { uid: 'sw', token: {} }, true))).toBe('permission-denied')
    expect(await codeOf(mod.assertStaffMfa(db(), { uid: 'sw', token: { firebase: { sign_in_second_factor: 'totp' } } }, true))).toBeNull()
    expect(await codeOf(mod.assertStaffMfa(db(), { uid: 'pat', token: {} }, true))).toBeNull()
  })
  it('when off (as shipped): allows everyone without reading anything', async () => {
    const empty = memDb()
    expect(await codeOf(mod.assertStaffMfa(empty, { uid: 'sw', token: {} }))).toBeNull()
    expect(mod.ENFORCE_STAFF_MFA).toBe(false)
  })
  it('the rules and the functions switch agree', () => {
    const rules = fs.readFileSync(path.resolve('firestore.rules'), 'utf8')
    const m = /function enforceStaffMfa\(\) \{ return (true|false); \}/.exec(rules)
    expect(m).toBeTruthy()
    expect(m[1] === 'true').toBe(mod.ENFORCE_STAFF_MFA)
  })
})
