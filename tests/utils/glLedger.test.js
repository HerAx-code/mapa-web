import { describe, it, expect } from 'vitest'
import { glState, glLedgerRows, glTotalsByAgency } from '../../src/utils/glLedger.js'

const DAY = 86400000
const NOW = Date.UTC(2026, 10, 16, 4, 0) // 16 Nov 2026, 12:00 Manila
const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms), seconds: Math.floor(ms / 1000) })

const issued = (id, { daysAgo = 1, validDays = 9, ...rest } = {}) => ({
  id, appId: `APP-${id}`, requestId: 'r1', patientName: 'Juan Dela Cruz', agencyName: 'MOH-MAIFIP',
  amountApproved: 10000, glStatus: 'issued',
  approvedAt: ts(NOW - daysAgo * DAY), glExpiresAt: ts(NOW + validDays * DAY), ...rest,
})

describe('glState', () => {
  it('reads valid, expiring soon, used and expired', () => {
    expect(glState(issued('a', { validDays: 9 }), NOW)).toBe('valid')
    expect(glState(issued('b', { validDays: 2 }), NOW)).toBe('expiring')
    expect(glState(issued('c', { validDays: -1 }), NOW)).toBe('expired')   // past validity, sweep not run yet
    expect(glState({ glStatus: 'expired' }, NOW)).toBe('expired')
    expect(glState({ glStatus: 'redeemed' }, NOW)).toBe('used')
    expect(glState({ status: 'reviewing' }, NOW)).toBe(null)
  })
})

describe('glLedgerRows', () => {
  const slices = [
    issued('open'),
    issued('used', { glStatus: 'redeemed', redeemedAmount: 7500, glRedeemedAt: ts(NOW - DAY) }),
    issued('legacy', { glStatus: 'redeemed', redeemedAmount: null, agencyName: 'PCSO' }),
    issued('old', { daysAgo: 40, glStatus: 'expired', agencyName: 'PCSO' }),
    { id: 'none', status: 'endorsed', approvedAt: ts(NOW) },
  ]
  const requests = { r1: { requestId: 'REQ-2026-1', careSetting: 'outpatient' } }

  it('keeps only letters, newest first, with amounts used and unused', () => {
    const rows = glLedgerRows(slices, { requests }, { now: NOW })
    expect(rows.map(r => r.id)).toEqual(['open', 'used', 'legacy', 'old'])
    const used = rows.find(r => r.id === 'used')
    expect(used).toMatchObject({ state: 'used', billed: 7500, unused: 2500, requestRef: 'REQ-2026-1', careSetting: 'Outpatient' })
    // Used before amounts were recorded: counts as fully used.
    expect(rows.find(r => r.id === 'legacy')).toMatchObject({ billed: 10000, unused: 0 })
    expect(rows.find(r => r.id === 'open')).toMatchObject({ state: 'valid', billed: null, daysLeft: 8 })
  })

  it('filters on the issue date', () => {
    const rows = glLedgerRows(slices, { requests }, { now: NOW, from: new Date(NOW - 10 * DAY) })
    expect(rows.map(r => r.id)).not.toContain('old')
  })

  it('totals per agency', () => {
    const totals = glTotalsByAgency(glLedgerRows(slices, { requests }, { now: NOW }))
    expect(totals).toEqual([
      { agency: 'MOH-MAIFIP', openCount: 1, openAmount: 10000, usedCount: 1, billedAmount: 7500, expiredCount: 0 },
      { agency: 'PCSO',       openCount: 0, openAmount: 0,     usedCount: 1, billedAmount: 10000, expiredCount: 1 },
    ])
  })
})
