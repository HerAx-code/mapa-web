import { describe, it, expect } from 'vitest'
import {
  letterState, isLetterOpen, openLettersOf, committedOf, disbursedOf, assistanceGivenOf,
  isRequestFinished, isRequestActive, deriveRequestFinancials, glExpiresAtFor, manilaDayKey,
} from '../../src/shared/caseState.js'

// The one definition of a case's money and lifecycle state (Phase 2, T8).
const DAY = 86400000
const NOW = Date.UTC(2026, 10, 22, 4, 0)     // 22 Nov 2026, 12:00 Manila
const issued = (daysAgo, x = {}) => ({
  status: 'approved', glStatus: 'issued', amountApproved: 1000,
  approvedAt: { toMillis: () => NOW - daysAgo * DAY },
  glExpiresAt: { toMillis: () => glExpiresAtFor(NOW - daysAgo * DAY) }, ...x,
})

describe('letterState', () => {
  it('follows the letter, not the slice status', () => {
    expect(letterState(issued(1), NOW)).toBe('valid')
    expect(letterState(issued(8), NOW)).toBe('expiring')
    expect(letterState(issued(12), NOW)).toBe('expired')                 // past validity, not swept yet
    expect(letterState({ status: 'certificate', glStatus: 'redeemed' }, NOW)).toBe('used')
    expect(letterState({ status: 'certificate', glStatus: 'expired' }, NOW)).toBe('expired')
    expect(letterState({ status: 'reviewing', glStatus: null }, NOW)).toBe('none')
  })
})

describe('open letters and agency money', () => {
  it('a letter stays open until redeemed or swept, even past its validity', () => {
    expect(isLetterOpen(issued(12))).toBe(true)
    expect(openLettersOf([issued(1), issued(12), { status: 'certificate', glStatus: 'redeemed' }])).toBe(2)
  })
  it('committed = open letters; disbursed = billed on redeemed letters', () => {
    expect(committedOf(issued(1))).toBe(1000)
    expect(committedOf({ status: 'certificate', glStatus: 'redeemed', amountApproved: 1000 })).toBe(0)
    expect(disbursedOf({ status: 'certificate', glStatus: 'redeemed', amountApproved: 1000, redeemedAmount: 800 })).toBe(800)
    expect(disbursedOf({ status: 'certificate', glStatus: 'redeemed', amountApproved: 1000 })).toBe(1000) // older letter
    expect(disbursedOf({ status: 'approved', glStatus: 'expired', amountApproved: 1000 })).toBe(0)
    expect(committedOf({ status: 'approved', glStatus: 'issued', approvedAmount: 700 })).toBe(700)       // older field name
  })
})

describe('assistanceGivenOf (P2-F)', () => {
  it('counts approved letters except those left to expire unused', () => {
    expect(assistanceGivenOf(issued(1), NOW)).toMatchObject({ approved: 1000, billed: null, state: 'valid' })
    expect(assistanceGivenOf({ status: 'certificate', glStatus: 'redeemed', amountApproved: 1000, redeemedAmount: 900 }, NOW))
      .toMatchObject({ approved: 1000, billed: 900, state: 'used' })
    expect(assistanceGivenOf(issued(12), NOW)).toBeNull()
    expect(assistanceGivenOf({ status: 'approved', glStatus: 'expired' }, NOW)).toBeNull()
    expect(assistanceGivenOf({ status: 'reviewing' }, NOW)).toBeNull()
    expect(assistanceGivenOf({ status: 'approved', amountApproved: 500 }, NOW)).toMatchObject({ approved: 500 }) // before letters
  })
})

describe('when a case is finished (D4 / P2-B)', () => {
  it('closed or rejected is finished', () => {
    expect(isRequestFinished({ status: 'closed' })).toBe(true)
    expect(isRequestFinished({ status: 'rejected' })).toBe(true)
  })
  it('fully funded is finished only once every letter is settled', () => {
    expect(isRequestFinished({ status: 'fully_funded', openLetters: 1 })).toBe(false)
    expect(isRequestActive({ status: 'fully_funded', openLetters: 1 })).toBe(true)
    expect(isRequestFinished({ status: 'fully_funded', openLetters: 0 })).toBe(true)
    expect(isRequestFinished({ status: 'fully_funded' })).toBe(true)        // older record without the count
  })
  it('everything else is active', () => {
    for (const status of ['submitted', 'under_review', 'assessment', 'endorsed', 'partially_funded']) {
      expect(isRequestActive({ status })).toBe(true)
    }
    expect(isRequestActive(null)).toBe(false)
  })
  it('deriveRequestFinancials reports open letters with the status', () => {
    expect(deriveRequestFinancials([issued(1, { amountRequested: 1000 })], 1000))
      .toEqual({ amountCommitted: 1000, openLetters: 1, status: 'fully_funded' })
  })
})

describe('manilaDayKey', () => {
  it('is the date in Manila, not UTC', () => {
    expect(manilaDayKey(Date.UTC(2026, 10, 21, 17, 0))).toBe('2026-11-22')   // 01:00 Manila
    expect(manilaDayKey(Date.UTC(2026, 10, 21, 15, 0))).toBe('2026-11-21')   // 23:00 Manila
  })
})
