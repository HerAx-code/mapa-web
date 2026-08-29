// Pure aggregation for the Impact / Analytics surfaces.
//
// Everything is derived from the `applications` collection (the co-funding
// "slices"), optionally joined with `requests` for request-level counts.
// A slice carries: amountApproved, amountRequested, agencyName, assistanceType,
// patientId, status, glStatus, submittedAt (endorse time), approvedAt.
//
// "Facilitated" money mirrors computeFunding's committed rule: a slice counts
// only once an agency has approved it (status approved/certificate) and its GL
// has not expired (an expired GL released the money back to the agency).

const FACILITATED_STATUSES = ['approved', 'certificate']

export function isFacilitatedSlice(s) {
  if (!s || !FACILITATED_STATUSES.includes(s.status)) return false
  if (s.status === 'certificate' && s.glStatus === 'expired') return false
  return true
}

// Firestore Timestamp | Date | {seconds} → millis (or null).
function ms(ts) {
  if (!ts) return null
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  if (ts instanceof Date) return ts.getTime()
  const n = Date.parse(ts)
  return Number.isNaN(n) ? null : n
}

function monthKey(millis) {
  const d = new Date(millis)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Roll a [{key, amount, count}] map into a sorted array (desc by amount).
function topEntries(map) {
  return Object.values(map).sort((a, b) => b.amount - a.amount)
}

/**
 * Aggregate slices (+ optional requests) into the figures both the CRMC
 * Analytics page and the per-agency Impact page render. Pass an already-
 * filtered slice array for the agency scope; pass requests only for the
 * program view (agency scope leaves request-level counts at 0).
 */
export function computeAnalytics(slices = [], requests = null) {
  const facilitated = slices.filter(isFacilitatedSlice)

  const totalFacilitated = facilitated.reduce((s, x) => s + (Number(x.amountApproved) || 0), 0)
  const patientsHelped   = new Set(facilitated.map(s => s.patientId).filter(Boolean)).size
  const glsIssued        = facilitated.length
  const glsRedeemed      = facilitated.filter(s => s.glStatus === 'redeemed').length

  // Turnaround: agency decision time (approvedAt − submittedAt), in days.
  const turnarounds = facilitated
    .map(s => { const a = ms(s.approvedAt), b = ms(s.submittedAt); return (a && b && a >= b) ? (a - b) / 86400000 : null })
    .filter(v => v != null)
  const avgTurnaroundDays = turnarounds.length
    ? turnarounds.reduce((s, v) => s + v, 0) / turnarounds.length
    : null

  // Breakdowns (magnitude by category).
  const byAgencyMap = {}
  const byTypeMap   = {}
  const byMonthMap  = {}
  for (const s of facilitated) {
    const amt = Number(s.amountApproved) || 0
    const ag  = s.agencyName || 'Unknown agency'
    const ty  = s.assistanceType || 'Unspecified'
    ;(byAgencyMap[ag] ??= { key: ag, label: ag, amount: 0, count: 0 })
    byAgencyMap[ag].amount += amt; byAgencyMap[ag].count += 1
    ;(byTypeMap[ty] ??= { key: ty, label: ty, amount: 0, count: 0 })
    byTypeMap[ty].amount += amt; byTypeMap[ty].count += 1
    const m = ms(s.approvedAt)
    if (m != null) {
      const k = monthKey(m)
      ;(byMonthMap[k] ??= { key: k, amount: 0, count: 0 })
      byMonthMap[k].amount += amt; byMonthMap[k].count += 1
    }
  }

  // Request-level (program view only).
  let requestsTotal = 0, requestsFullyFunded = 0
  if (Array.isArray(requests)) {
    requestsTotal = requests.length
    requestsFullyFunded = requests.filter(r => r.status === 'fully_funded').length
  }

  return {
    totalFacilitated,
    patientsHelped,
    glsIssued,
    glsRedeemed,
    avgTurnaroundDays,
    requestsTotal,
    requestsFullyFunded,
    byAgency: topEntries(byAgencyMap),
    byType:   topEntries(byTypeMap),
    // Ascending by month so the trend reads left → right in time.
    byMonth:  Object.values(byMonthMap).sort((a, b) => a.key.localeCompare(b.key)),
  }
}

// "2026-08" → "Aug 2026" for axis / row labels.
export function formatMonth(key) {
  const [y, m] = String(key).split('-').map(Number)
  if (!y || !m) return key
  return new Date(y, m - 1, 1).toLocaleDateString([], { month: 'short', year: 'numeric' })
}
