// Per-hospital view of an agency's slices (multi-hospital). An agency is
// network-level and funds patients from every partner hospital; these helpers
// group its slices by the hospital that endorsed them (slice.tenantId).
// Pure — unit-tested in tests/utils/hospitalBreakdown.test.js.
import { DEFAULT_HOSPITAL_ID } from '../config/org'

// A slice without a tenantId predates the Phase 3 backfill: hospital #1.
export const sliceHospital = (slice) => slice?.tenantId || DEFAULT_HOSPITAL_ID

// Statuses as the agency sees them (APP_STATUS_CONFIG). 'endorsed' slices are
// still waiting on the patient's Proceed, so they aren't in the agency's queue.
const IN_QUEUE = ['pending', 'reviewing', 'awaiting_info']
const APPROVED = ['approved', 'certificate']

// The distinct hospitals among these slices (agency-visible ones only).
export const hospitalsIn = (slices) =>
  [...new Set((slices ?? []).filter((s) => s.status !== 'endorsed').map(sliceHospital))]

// [{ tenantId, total, inQueue, approved, rejected, amountApproved }], busiest first.
export function breakdownByHospital(slices) {
  const rows = new Map()
  for (const s of slices ?? []) {
    if (!s || s.status === 'endorsed') continue
    const id = sliceHospital(s)
    if (!rows.has(id)) rows.set(id, { tenantId: id, total: 0, inQueue: 0, approved: 0, rejected: 0, amountApproved: 0 })
    const r = rows.get(id)
    r.total++
    if (IN_QUEUE.includes(s.status)) r.inQueue++
    else if (APPROVED.includes(s.status)) { r.approved++; r.amountApproved += Number(s.amountApproved) || 0 }
    else if (s.status === 'rejected') r.rejected++
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || a.tenantId.localeCompare(b.tenantId))
}

// Filter slices to one hospital ('all' = no filter).
export const filterByHospital = (slices, tenantId) =>
  !tenantId || tenantId === 'all' ? slices : slices.filter((s) => sliceHospital(s) === tenantId)
