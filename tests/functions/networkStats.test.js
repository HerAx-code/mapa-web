import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { computeNetworkStats, computePublicStats, writeNetworkStats, summarize } = require('../../functions/src/networkStats')

// Multi-hospital Phase 9 — per-hospital counts for the platform admin, computed
// from an in-memory fake that evaluates the query filters for real.
function makeDb(data) {
  const writes = []
  const query = (col, filters = []) => {
    const rows = () => (data[col] ?? []).filter((d) => filters.every(([f, op, v]) =>
      op === '==' ? d[f] === v : op === 'in' ? v.includes(d[f])
      : op === 'array-contains' ? (d[f] ?? []).includes(v) : false))
    return {
      where: (f, op, v) => query(col, [...filters, [f, op, v]]),
      select: () => query(col, filters),
      count: () => ({ get: async () => ({ data: () => ({ count: rows().length }) }) }),
      aggregate: (spec) => ({
        get: async () => ({
          data: () => Object.fromEntries(Object.entries(spec).map(([k, a]) => [k,
            a.kind === 'count' ? rows().length : rows().reduce((s, d) => s + (Number(d[a.field]) || 0), 0)])),
        }),
      }),
      get: async () => ({ docs: rows().map((d) => ({ id: d.id, data: () => d })) }),
    }
  }
  return {
    writes,
    collection: (col) => query(col),
    doc: (path) => ({ set: async (d) => { writes.push({ path, d }) } }),
  }
}
const AggregateField = { count: () => ({ kind: 'count' }), sum: (field) => ({ kind: 'sum', field }) }

const data = {
  hospitals: [{ id: 'hospital-1' }, { id: 'bgh' }],
  // Marketplace: a hospital's patients = users.tenantIds (who filed there).
  users: [
    { role: 'patient', tenantId: 'hospital-1', tenantIds: ['hospital-1'] },
    { role: 'patient', tenantId: 'bgh', tenantIds: ['hospital-1', 'bgh'] },   // moved: counted at both
    { role: 'staff_admin', tenantId: 'bgh' },
    { role: 'patient' },                                         // never filed: not counted
  ],
  requests: [
    { status: 'submitted', tenantId: 'hospital-1' }, { status: 'assessment', tenantId: 'hospital-1' },
    { status: 'partially_funded', tenantId: 'hospital-1' }, { status: 'fully_funded', tenantId: 'bgh' },
    { status: 'rejected', tenantId: 'bgh' },
  ],
  applications: [
    { status: 'approved', amountApproved: 10000, tenantId: 'hospital-1' },
    { status: 'certificate', amountApproved: 5000, tenantId: 'hospital-1' },
    { status: 'reviewing', amountApproved: 0, tenantId: 'hospital-1' },
    { status: 'approved', amountApproved: 20000, tenantId: 'bgh' },
  ],
}

describe('computeNetworkStats', () => {
  it('counts each hospital separately (patients, request stages, approved slices, pesos)', async () => {
    const s = await computeNetworkStats({ db: makeDb(data), AggregateField })
    expect(s.hospitals['hospital-1']).toEqual({
      patients: 2,
      requests: { inReview: 2, inFunding: 1, funded: 0, closed: 0 },
      approvedSlices: 2, amountApproved: 15000,
    })
    expect(s.hospitals.bgh).toEqual({
      patients: 1,
      requests: { inReview: 0, inFunding: 0, funded: 1, closed: 1 },
      approvedSlices: 1, amountApproved: 20000,
    })
  })

  it('totals the network', async () => {
    const s = await computeNetworkStats({ db: makeDb(data), AggregateField })
    expect(s.totals).toEqual({
      patients: 3, approvedSlices: 3, amountApproved: 35000,
      requests: { inReview: 2, inFunding: 1, funded: 1, closed: 1 },
    })
  })

  it('carries no patient-level data — only numbers', async () => {
    const s = await computeNetworkStats({ db: makeDb(data), AggregateField })
    const leaves = JSON.stringify(s).match(/"[^"]+":"[^"]*"/g)
    expect(leaves).toBeNull()                  // no string values anywhere
  })

  it('writes the summary doc, then one public stats doc per hospital', async () => {
    const db = makeDb(data)
    await writeNetworkStats({ db, AggregateField, serverTimestamp: () => 'TS' })
    expect(db.writes.map((w) => w.path)).toEqual(['networkStats/current', 'hospitalsPublicStats/hospital-1', 'hospitalsPublicStats/bgh'])
    expect(db.writes[0].d.generatedAt).toBe('TS')
    expect(db.writes[0].d.publicStats).toBeUndefined()   // platform doc unchanged
  })
})

// Marketplace — typical turnaround (median days, filing → first endorsement).
describe('computePublicStats', () => {
  const NOW = Date.UTC(2026, 10, 14)
  const day = 86400000
  const reqs = (n, tenantId, daysToEndorse, filedDaysAgo = 10) => Array.from({ length: n }, (_, i) => ({
    id: `${tenantId}-r${i}`, tenantId, submittedAt: NOW - filedDaysAgo * day,
    _slices: [{ requestId: `${tenantId}-r${i}`, tenantId, endorsedAt: NOW - filedDaysAgo * day + daysToEndorse[i % daysToEndorse.length] * day }],
  }))
  const build = (requests, extraSlices = []) => ({
    hospitals: [{ id: 'hospital-1' }, { id: 'bgh' }],
    requests,
    applications: [...requests.flatMap((r) => r._slices), ...extraSlices],
  })

  it('publishes the median over at least 5 requests', async () => {
    const s = await computePublicStats({ db: makeDb(build(reqs(5, 'hospital-1', [1, 2, 3, 4, 10]))), now: NOW })
    expect(s['hospital-1']).toEqual({ turnaroundDays: 3, basedOn: 5 })
  })

  it('publishes nothing below 5 requests (but says how many)', async () => {
    const s = await computePublicStats({ db: makeDb(build(reqs(4, 'bgh', [2]))), now: NOW })
    expect(s.bgh).toEqual({ turnaroundDays: null, basedOn: 4 })
  })

  it('uses the FIRST endorsement and ignores old or never-endorsed requests', async () => {
    const recent = reqs(5, 'hospital-1', [2])
    const old = reqs(3, 'bgh', [30], 400).map((r) => ({ ...r, tenantId: 'hospital-1' }))
    const later = recent.map((r) => ({ requestId: r.id, tenantId: 'hospital-1', endorsedAt: NOW }))  // a second agency, later
    const data = build([...recent, ...old, { id: 'pending', tenantId: 'hospital-1', submittedAt: NOW, _slices: [] }], later)
    data.applications = data.applications.map((a) => ({ ...a, tenantId: 'hospital-1' }))
    const s = await computePublicStats({ db: makeDb(data), now: NOW })
    expect(s['hospital-1']).toEqual({ turnaroundDays: 2, basedOn: 5 })
  })
})

describe('summarize', () => {
  it('is all zeros for an empty network', () => {
    expect(summarize({})).toEqual({
      patients: 0, approvedSlices: 0, amountApproved: 0,
      requests: { inReview: 0, inFunding: 0, funded: 0, closed: 0 },
    })
  })
})
