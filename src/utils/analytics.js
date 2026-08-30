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
  let approvalRate = null, philhealthShare = null
  let outcomes = []
  if (Array.isArray(requests)) {
    requestsTotal = requests.length
    requestsFullyFunded = requests.filter(r => r.status === 'fully_funded').length
    // Approval rate: of the requests that reached a FUNDING decision, the share
    // fully funded. Rejected = ineligible (a denial). 'closed' is excluded — it
    // covers both CRMC give-ups and patient withdrawals, neither of which is a
    // funding-eligibility decision, so counting them would deflate the rate.
    const closed   = requests.filter(r => r.status === 'closed').length
    const rejected = requests.filter(r => r.status === 'rejected').length
    const fundingDecided = requestsFullyFunded + rejected
    approvalRate = fundingDecided > 0 ? Math.round((requestsFullyFunded / fundingDecided) * 100) : null
    // PhilHealth share of the total billed across all requests (first charge).
    const billSum = requests.reduce((s, r) => s + (Number(r.totalBill ?? r.amountNeeded) || 0), 0)
    const phSum   = requests.reduce((s, r) => s + (Number(r.philhealthCovered) || 0), 0)
    philhealthShare = billSum > 0 ? Math.round((phSum / billSum) * 100) : null
    // Where requests end up (outcome distribution) — the data-clean stand-in
    // for the MP "denial reasons" panel (MAPA's reasons are free text).
    const inProgress = requestsTotal - requestsFullyFunded - closed - rejected
    outcomes = [
      { key: 'fully_funded', label: 'Fully funded',        count: requestsFullyFunded, tone: 'brand' },
      { key: 'in_progress',  label: 'Still in progress',   count: Math.max(0, inProgress), tone: 'gray' },
      { key: 'closed',       label: 'Closed / withdrawn',  count: closed,   tone: 'amber' },
      { key: 'rejected',     label: 'Rejected',            count: rejected, tone: 'red' },
    ]
  }

  return {
    totalFacilitated,
    patientsHelped,
    glsIssued,
    glsRedeemed,
    avgTurnaroundDays,
    requestsTotal,
    requestsFullyFunded,
    approvalRate,
    philhealthShare,
    outcomes,
    byAgency: topEntries(byAgencyMap),
    byType:   topEntries(byTypeMap),
    // Ascending by month so the trend reads left → right in time.
    byMonth:  Object.values(byMonthMap).sort((a, b) => a.key.localeCompare(b.key)),
  }
}

// Program analytics for a reporting window (facilitation dated by approvedAt),
// plus period-over-period deltas vs the immediately preceding window of the
// same length. `days = null` → all-time (no window, no deltas). Deltas are
// percentages; null when there's no prior-period baseline (avoids misleading
// "+100%" on a cold start). Request-level counts stay program-total.
export function analyticsForRange(slices = [], requests = null, days = null, now = Date.now()) {
  if (!days) return { ...computeAnalytics(slices, requests), rangeDays: null, deltas: null }

  const DAY = 86_400_000
  const winStart  = now - days * DAY
  const prevStart = now - 2 * days * DAY
  const inWin    = (s, start, end) => { const m = ms(s.approvedAt);  return m != null && m >= start && m < end }
  // Requests are cohorted by submittedAt so the request-level metrics
  // (approval rate, PhilHealth share, outcomes, totals) window with the range
  // too — otherwise the selector would apply to only half the board.
  const inReqWin = (r, start, end) => { const m = ms(r.submittedAt); return m != null && m >= start && m < end }
  const winReqs  = Array.isArray(requests) ? requests.filter(r => inReqWin(r, winStart, now + 1)) : requests

  const cur  = computeAnalytics(slices.filter(s => inWin(s, winStart, now + 1)), winReqs)
  const prev = computeAnalytics(slices.filter(s => inWin(s, prevStart, winStart)), null)
  const pct = (c, p) => (p > 0 ? Math.round(((c - p) / p) * 100) : null)

  return {
    ...cur,
    rangeDays: days,
    deltas: {
      totalFacilitated: pct(cur.totalFacilitated, prev.totalFacilitated),
      patientsHelped:   pct(cur.patientsHelped, prev.patientsHelped),
      glsIssued:        pct(cur.glsIssued, prev.glsIssued),
    },
  }
}

// "2026-08" → "Aug 2026" for axis / row labels.
export function formatMonth(key) {
  const [y, m] = String(key).split('-').map(Number)
  if (!y || !m) return key
  return new Date(y, m - 1, 1).toLocaleDateString([], { month: 'short', year: 'numeric' })
}
