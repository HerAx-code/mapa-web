// Phase 2B (2026-11-16): reusing a patient's means-test classification.
// The MSS classification is valid 6 months (owner answer 8; DOH AO 2021-0044
// allows 6-12 months by treatment length). The social worker may reuse it on
// a new request only while household size and monthly income are unchanged;
// the recommendation and sign-off are still done fresh on every request.

export const CLASSIFICATION_VALID_MONTHS = 6

const toDate = (ts) => ts?.toDate ? ts.toDate()
  : typeof ts?.seconds === 'number' ? new Date(ts.seconds * 1000)
  : ts ? new Date(ts) : null

// The most recent completed classification among `requests` (this patient's
// other requests at this hospital) that is still valid, or null.
export function reusableClassification(requests, now = Date.now()) {
  const limit = new Date(now)
  limit.setMonth(limit.getMonth() - CLASSIFICATION_VALID_MONTHS)
  const best = (requests ?? [])
    .map(r => ({ r, s: r.intakeSheet ?? {}, at: toDate(r.intakeSheet?.completedAt) }))
    .filter(x => x.s.meansTestCategory && x.at && !Number.isNaN(x.at.getTime()) && x.at >= limit)
    .sort((a, b) => b.at - a.at)[0]
  if (!best) return null
  const validUntil = new Date(best.at)
  validUntil.setMonth(validUntil.getMonth() + CLASSIFICATION_VALID_MONTHS)
  return {
    requestId:     best.r.id,
    requestRef:    best.r.requestId ?? best.r.id,
    category:      best.s.meansTestCategory,
    reason:        best.s.meansTestOverrideReason || null,
    by:            best.s.completedBy || null,
    at:            best.at,
    validUntil,
    householdSize: best.s.householdSize,
    monthlyIncome: best.s.monthlyIncome,
  }
}
