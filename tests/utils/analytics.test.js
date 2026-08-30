import { describe, it, expect } from 'vitest'
import { computeAnalytics, isFacilitatedSlice, formatMonth } from '../../src/utils/analytics.js'

// Timestamps in the slices are Firestore-style { seconds }.
const ts = (iso) => ({ seconds: Math.floor(Date.parse(iso) / 1000) })

const slices = [
  // Facilitated (approved) — DOH, medicine, ₱5k, patient p1
  { status: 'approved',    amountApproved: 5000, agencyName: 'DOH',  assistanceType: 'Medicine', patientId: 'p1', submittedAt: ts('2026-08-01'), approvedAt: ts('2026-08-03') },
  // Facilitated (certificate, GL issued) — PCSO, hospital bill, ₱10k, patient p2
  { status: 'certificate', glStatus: 'issued', amountApproved: 10000, agencyName: 'PCSO', assistanceType: 'Hospital Bill', patientId: 'p2', submittedAt: ts('2026-08-05'), approvedAt: ts('2026-08-06') },
  // Facilitated again for the SAME patient p1 (should not double-count patient) — DOH, medicine, ₱2k
  { status: 'approved',    amountApproved: 2000, agencyName: 'DOH',  assistanceType: 'Medicine', patientId: 'p1', submittedAt: ts('2026-09-01'), approvedAt: ts('2026-09-02') },
  // Redeemed GL — counts as facilitated + redeemed
  { status: 'certificate', glStatus: 'redeemed', amountApproved: 3000, agencyName: 'PCSO', assistanceType: 'Hospital Bill', patientId: 'p3', submittedAt: ts('2026-09-03'), approvedAt: ts('2026-09-04') },
  // NOT facilitated: expired GL (money released) — must be excluded
  { status: 'certificate', glStatus: 'expired', amountApproved: 9999, agencyName: 'DOH', assistanceType: 'Medicine', patientId: 'p9', approvedAt: ts('2026-09-05') },
  // NOT facilitated: still endorsed / in-flight
  { status: 'endorsed',    amountRequested: 8000, agencyName: 'DSWD', assistanceType: 'Medicine', patientId: 'p4' },
  // NOT facilitated: rejected
  { status: 'rejected',    agencyName: 'DSWD', assistanceType: 'Medicine', patientId: 'p5' },
]

describe('isFacilitatedSlice', () => {
  it('counts approved and certificate slices', () => {
    expect(isFacilitatedSlice({ status: 'approved' })).toBe(true)
    expect(isFacilitatedSlice({ status: 'certificate', glStatus: 'issued' })).toBe(true)
  })
  it('excludes expired GLs, endorsed, and rejected', () => {
    expect(isFacilitatedSlice({ status: 'certificate', glStatus: 'expired' })).toBe(false)
    expect(isFacilitatedSlice({ status: 'endorsed' })).toBe(false)
    expect(isFacilitatedSlice({ status: 'rejected' })).toBe(false)
  })
})

describe('computeAnalytics', () => {
  const a = computeAnalytics(slices, [
    { status: 'fully_funded' }, { status: 'fully_funded' }, { status: 'submitted' },
  ])

  it('sums facilitated money, excluding expired/in-flight/rejected', () => {
    expect(a.totalFacilitated).toBe(5000 + 10000 + 2000 + 3000) // 20000
  })
  it('counts distinct patients helped (no double-count)', () => {
    expect(a.patientsHelped).toBe(3) // p1, p2, p3
  })
  it('counts GLs issued and redeemed', () => {
    expect(a.glsIssued).toBe(4)
    expect(a.glsRedeemed).toBe(1)
  })
  it('reflects request-level counts when requests are passed', () => {
    expect(a.requestsTotal).toBe(3)
    expect(a.requestsFullyFunded).toBe(2)
  })
  it('breaks down by agency, sorted by amount desc', () => {
    expect(a.byAgency[0]).toMatchObject({ label: 'PCSO', amount: 13000, count: 2 })
    expect(a.byAgency.find(x => x.label === 'DOH')).toMatchObject({ amount: 7000, count: 2 })
  })
  it('breaks down by assistance type', () => {
    const med = a.byType.find(x => x.label === 'Medicine')
    expect(med).toMatchObject({ amount: 7000, count: 2 })
  })
  it('builds a monthly trend in ascending time order', () => {
    expect(a.byMonth.map(m => m.key)).toEqual(['2026-08', '2026-09'])
    expect(a.byMonth[0].amount).toBe(15000) // Aug: 5k + 10k
    expect(a.byMonth[1].amount).toBe(5000)  // Sep: 2k + 3k
  })
  it('computes average turnaround in days', () => {
    // (2 + 1 + 1 + 1) / 4 = 1.25
    expect(a.avgTurnaroundDays).toBeCloseTo(1.25, 5)
  })
  it('leaves request counts at 0 for the agency scope (no requests passed)', () => {
    const agency = computeAnalytics(slices.filter(s => s.agencyName === 'DOH'))
    expect(agency.requestsTotal).toBe(0)
    expect(agency.totalFacilitated).toBe(7000)
  })
})

describe('formatMonth', () => {
  it('formats a YYYY-MM key', () => {
    expect(formatMonth('2026-08')).toBe('Aug 2026')
  })
})

// ── analyticsForRange (period window + deltas) ──────────────────────────────
import { analyticsForRange } from '../../src/utils/analytics.js'

describe('analyticsForRange', () => {
  const NOW = Date.parse('2026-09-30T00:00:00Z')
  const at = (iso) => ({ seconds: Math.floor(Date.parse(iso) / 1000) })
  // current 30d window: Sep 1–30. prior 30d window: Aug 2–31.
  const s = [
    { status: 'approved', amountApproved: 1000, patientId: 'a', approvedAt: at('2026-09-10') }, // current
    { status: 'approved', amountApproved: 1000, patientId: 'b', approvedAt: at('2026-09-20') }, // current
    { status: 'approved', amountApproved: 1000, patientId: 'c', approvedAt: at('2026-08-15') }, // prior
    { status: 'approved', amountApproved: 1000, patientId: 'd', approvedAt: at('2026-06-01') }, // outside both
  ]

  it('all-time (days=null) returns no window and no deltas', () => {
    const r = analyticsForRange(s, null, null, NOW)
    expect(r.rangeDays).toBeNull()
    expect(r.deltas).toBeNull()
    expect(r.totalFacilitated).toBe(4000) // all four
  })

  it('windows to the current period and computes deltas vs the prior period', () => {
    const r = analyticsForRange(s, null, 30, NOW)
    expect(r.rangeDays).toBe(30)
    expect(r.totalFacilitated).toBe(2000)      // two in Sep
    expect(r.patientsHelped).toBe(2)
    // current 2000 vs prior 1000 → +100%
    expect(r.deltas.totalFacilitated).toBe(100)
    expect(r.deltas.glsIssued).toBe(100)
  })

  it('delta is null when there is no prior-period baseline', () => {
    // only current-window data, nothing in the prior window
    const only = [{ status: 'approved', amountApproved: 500, patientId: 'x', approvedAt: at('2026-09-10') }]
    const r = analyticsForRange(only, null, 30, NOW)
    expect(r.totalFacilitated).toBe(500)
    expect(r.deltas.totalFacilitated).toBeNull()
  })
})

// ── request-level health metrics (approval rate / PhilHealth share / outcomes) ─
describe('computeAnalytics request-level health', () => {
  const reqs = [
    { status: 'fully_funded', totalBill: 10000, philhealthCovered: 4000 },
    { status: 'fully_funded', totalBill: 10000, philhealthCovered: 0 },
    { status: 'rejected',     totalBill: 5000,  philhealthCovered: 0 },
    { status: 'closed',       totalBill: 5000,  philhealthCovered: 1000 },
    { status: 'under_review', totalBill: 0 },
  ]
  it('computes approval rate over funding-decided requests (closed excluded)', () => {
    const r = computeAnalytics([], reqs)
    // funding-decided = 2 funded + 1 rejected = 3 (the 1 closed is excluded); 2/3 → 67%
    expect(r.approvalRate).toBe(67)
  })
  it('computes PhilHealth share of total bills', () => {
    const r = computeAnalytics([], reqs)
    // phSum 5000 / billSum 30000 = 16.67 → 17%
    expect(r.philhealthShare).toBe(17)
  })
  it('builds an outcome distribution that covers every request', () => {
    const r = computeAnalytics([], reqs)
    const total = r.outcomes.reduce((s, o) => s + o.count, 0)
    expect(total).toBe(reqs.length)
    expect(r.outcomes.find(o => o.key === 'fully_funded').count).toBe(2)
    expect(r.outcomes.find(o => o.key === 'in_progress').count).toBe(1)
  })
})
