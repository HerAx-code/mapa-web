// Which verified documents carry over to a patient's next request
// (2026-11-15). Only document types marked `reusable` in documentTypes (the
// Valid ID and PhilHealth ID; see src/data/referenceData.js) qualify, only at
// the hospital that verified them (RequestAssistance filters by tenant), and
// only while the verification is recent: MAPA doesn't record an ID's printed
// expiry, so a verification older than REUSE_MONTHS asks for a fresh copy.

export const REUSE_MONTHS = 12

function toMillis(ts) {
  if (!ts) return null
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (ts instanceof Date) return ts.getTime()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  const n = new Date(ts).getTime()
  return Number.isNaN(n) ? null : n
}

// True when this verified document may satisfy the checklist again.
// Verified time = reviewedAt (stamped when staff verify), else createdAt.
export function canReuseDocument(doc, now = Date.now()) {
  if (doc?.status !== 'verified') return false
  const at = toMillis(doc.reviewedAt) ?? toMillis(doc.createdAt)
  if (at == null) return false
  const limit = new Date(now)
  limit.setMonth(limit.getMonth() - REUSE_MONTHS)
  return at >= limit.getTime()
}
