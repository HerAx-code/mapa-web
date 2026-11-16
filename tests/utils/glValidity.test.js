import { describe, it, expect } from 'vitest'
import {
  GL_VALIDITY_DAYS, glExpiresAtFor, glExpiryMs, glValidUntil, isGLExpired, glDaysRemaining,
} from '../../src/utils/constants.js'

// Guarantee Letter validity (owner decision 2026-11-16): 10 days from
// issuance for new letters (stored glExpiresAt); letters approved before keep
// the 30 days printed on them.
const DAY = 86400000
const manila = (y, m, d, h = 0) => Date.UTC(y, m - 1, d, h) - 8 * 3600000
const ts = (ms) => ({ toMillis: () => ms })

describe('glExpiresAtFor', () => {
  it('a letter issued 16 Nov (Manila) is valid through 26 Nov', () => {
    const issued = manila(2026, 11, 16, 14)
    expect(GL_VALIDITY_DAYS).toBe(10)
    expect(glExpiresAtFor(issued)).toBe(manila(2026, 11, 27))
  })
  it('uses the Manila date, not UTC (issued 07:00 Manila = previous UTC day)', () => {
    expect(glExpiresAtFor(manila(2026, 11, 16, 7))).toBe(manila(2026, 11, 27))
  })
})

describe('expiry with and without a stored date', () => {
  const issued = manila(2026, 11, 16, 9)
  const fresh = { glStatus: 'issued', approvedAt: ts(issued), glExpiresAt: ts(glExpiresAtFor(issued)) }
  const legacy = { glStatus: 'issued', approvedAt: ts(issued) }

  it('a new letter is valid on 26 Nov and expired from 27 Nov', () => {
    expect(isGLExpired(fresh, manila(2026, 11, 26, 23))).toBe(false)
    expect(isGLExpired(fresh, manila(2026, 11, 27))).toBe(true)
    expect(glValidUntil(fresh).getTime()).toBe(manila(2026, 11, 27) - 1)
  })

  it('an older letter keeps its 30 days', () => {
    expect(glExpiryMs(legacy)).toBe(issued + 31 * DAY)
    expect(isGLExpired(legacy, issued + 20 * DAY)).toBe(false)
    expect(isGLExpired(legacy, issued + 31 * DAY)).toBe(true)
  })

  it('days remaining: 0 on the last valid day, negative after', () => {
    expect(glDaysRemaining(fresh, manila(2026, 11, 26, 12))).toBe(0)
    expect(glDaysRemaining(fresh, manila(2026, 11, 20, 12))).toBe(6)
    expect(glDaysRemaining(fresh, manila(2026, 11, 28, 12))).toBeLessThan(0)
    expect(glDaysRemaining(legacy, issued + 10.5 * DAY)).toBe(20)
  })

  it('only issued letters can be expired', () => {
    expect(isGLExpired({ ...fresh, glStatus: 'redeemed' }, manila(2026, 12, 30))).toBe(false)
    expect(glDaysRemaining({ ...fresh, glStatus: 'expired' })).toBeNull()
  })
})
