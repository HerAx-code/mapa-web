import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { computeNetworkStats, writeNetworkStats, summarize } = require('../../functions/src/networkStats')

// Multi-hospital Phase 9 — per-hospital counts for the platform admin, computed
// from an in-memory fake that evaluates the query filters for real.
function makeDb(data) {
  const writes = []
  const query = (col, filters = []) => {
    const rows = () => (data[col] ?? []).filter((d) => filters.every(([f, op, v]) =>
      op === '==' ? d[f] === v : op === 'in' ? v.includes(d[f]) : false))
    return {
      where: (f, op, v) => query(col, [...filters, [f, op, v]]),
      count: () => ({ get: async () => ({ data: () => ({ count: rows().length }) }) }),
      aggregate: (spec) => ({
        get: async () => ({
          data: () => Object.fromEntries(Object.entries(spec).map(([k, a]) => [k,
            a.kind === 'count' ? rows().length : rows().reduce((s, d) => s + (Number(d[a.field]) || 0), 0)])),
        }),
      }),
      get: async () => ({ docs: (data[col] ?? []).map((d) => ({ id: d.id, data: () => d })) }),
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
  users: [
    { role: 'patient', tenantId: 'hospital-1' }, { role: 'patient', tenantId: 'hospital-1' },
    { role: 'patient', tenantId: 'bgh' }, { role: 'staff_admin', tenantId: 'bgh' },
    { role: 'patient' },                                         // untagged: not counted
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

  it('writes one summary doc with a timestamp', async () => {
    const db = makeDb(data)
    await writeNetworkStats({ db, AggregateField, serverTimestamp: () => 'TS' })
    expect(db.writes).toHaveLength(1)
    expect(db.writes[0].path).toBe('networkStats/current')
    expect(db.writes[0].d.generatedAt).toBe('TS')
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
