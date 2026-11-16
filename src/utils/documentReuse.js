// Which verified documents carry over to a patient's next request.
//
// Only document types marked `reusable` in documentTypes qualify, only at the
// hospital that verified them (RequestAssistance filters by tenant), and only
// inside the type's reuse window (Phase 2B, 2026-11-16; owner answers 7-8):
//   documentTypes.reuseMonths  how long (default 12)
//   documentTypes.reuseFrom    'verified' (default) — from when staff verified
//                              it (reviewedAt, else upload); MAPA doesn't
//                              record an ID's printed expiry.
//                              'issued' — from the date printed on the
//                              document, which the social worker records at
//                              verification (documents.issuedOn, YYYY-MM-DD).
//                              Without it the document isn't reused.
// Valid ID / PhilHealth ID: 12 months from verification. Doctor's order and
// barangay indigency certificate: 3 months from the date on them.

export const REUSE_MONTHS = 12

function toMillis(ts) {
  if (!ts) return null
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (ts instanceof Date) return ts.getTime()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  const n = new Date(ts).getTime()
  return Number.isNaN(n) ? null : n
}

// "2026-11-16" → ms at the start of that day, Manila time.
function issuedMs(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''))
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - 8 * 3600000 : null
}

export function reuseRuleOf(type) {
  const months = Number(type?.reuseMonths)
  return {
    months: Number.isFinite(months) && months > 0 ? months : REUSE_MONTHS,
    from: type?.reuseFrom === 'issued' ? 'issued' : 'verified',
  }
}

// True when this verified document may satisfy the checklist again.
export function canReuseDocument(doc, now = Date.now(), rule = {}) {
  if (doc?.status !== 'verified') return false
  const { months, from } = { months: REUSE_MONTHS, from: 'verified', ...rule }
  const at = from === 'issued'
    ? issuedMs(doc.issuedOn)
    : (toMillis(doc.reviewedAt) ?? toMillis(doc.createdAt))
  if (at == null) return false
  const limit = new Date(now)
  limit.setMonth(limit.getMonth() - months)
  return at >= limit.getTime()
}
