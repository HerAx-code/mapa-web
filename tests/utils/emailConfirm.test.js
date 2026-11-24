import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { EMAIL_CONFIRM_FROM, needsEmailConfirm } from '../../src/utils/emailConfirm.js'

const ts = (iso) => ({ toDate: () => new Date(iso) }) // a Firestore Timestamp's shape

describe('needsEmailConfirm', () => {
  const NEW = { role: 'patient', createdAt: ts('2026-12-01T02:00:00Z') }
  it('a new patient account with an unconfirmed email must confirm', () => {
    expect(needsEmailConfirm(NEW, { emailVerified: false })).toBe(true)
  })
  it('not once the email is confirmed', () => {
    expect(needsEmailConfirm(NEW, { emailVerified: true })).toBe(false)
  })
  it('older accounts, and accounts with no createdAt, are exempt', () => {
    expect(needsEmailConfirm({ role: 'patient', createdAt: ts('2026-11-20T00:00:00Z') }, { emailVerified: false })).toBe(false)
    expect(needsEmailConfirm({ role: 'patient' }, { emailVerified: false })).toBe(false)
    expect(needsEmailConfirm({ role: 'patient', createdAt: '2026-12-01' }, { emailVerified: false })).toBe(false)
  })
  it('the cutoff itself counts as new', () => {
    expect(needsEmailConfirm({ role: 'patient', createdAt: EMAIL_CONFIRM_FROM }, { emailVerified: false })).toBe(true)
  })
  it('staff are never asked', () => {
    expect(needsEmailConfirm({ ...NEW, role: 'staff_admin' }, { emailVerified: false })).toBe(false)
  })
})

describe('the cutoff agrees with firestore.rules', () => {
  it('patientEmailConfirmed uses the same moment', () => {
    const rules = fs.readFileSync(path.resolve('firestore.rules'), 'utf8')
    const fn = rules.slice(rules.indexOf('function patientEmailConfirmed'))
    const m = fn.match(/timestamp\.date\((\d+), (\d+), (\d+)\) \+ duration\.value\((\d+), 'h'\)/)
    expect(m).toBeTruthy()
    const [, y, mo, d, h] = m.map(Number)
    expect(new Date(Date.UTC(y, mo - 1, d, h)).toISOString()).toBe(EMAIL_CONFIRM_FROM.toISOString())
  })
})
