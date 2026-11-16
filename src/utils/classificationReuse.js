// Phase 2B (2026-11-16): reusing a patient's means-test classification.
// DOH AO 2021-0044: a classification is valid 6 months to a year by length of
// treatment; the social worker sets 6 or 12 on each sheet
// (classificationValidMonths, default 6). It may be reused on a new request
// only while household size and monthly income are unchanged; the
// recommendation and sign-off are still done fresh on every request.
// Old-scale categories (before the AO 2021-0044 classes) are never reused.
import { isLegacyCategory, meansCategoryLabel } from './intakeSheet.js'

export const CLASSIFICATION_VALID_MONTHS = 6

const toDate = (ts) => ts?.toDate ? ts.toDate()
  : typeof ts?.seconds === 'number' ? new Date(ts.seconds * 1000)
  : ts ? new Date(ts) : null

const monthsOf = (s) => (Number(s?.classificationValidMonths) === 12 ? 12 : CLASSIFICATION_VALID_MONTHS)

const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x }

// When a completed classification stops being valid, or null.
export function classificationValidUntil(s) {
  const at = toDate(s?.completedAt)
  if (!s?.meansTestCategory || !at || Number.isNaN(at.getTime())) return null
  return addMonths(at, monthsOf(s))
}

// One line for agency, request and print views:
// "Indigent (C3) · 124% of BARMM 2023 line · 4Ps · valid until 16 May 2027".
export function classificationSummary(s) {
  if (!s?.meansTestCategory) return ''
  const parts = [meansCategoryLabel(s.meansTestCategory)]
  const b = s.classificationBasis
  const size = Number(s.householdSize)
  if (!isLegacyCategory(s.meansTestCategory) && b && Number(b.povertyLine) > 0 && size > 0 && s.monthlyIncome !== '' && s.monthlyIncome != null) {
    const pct = Math.floor(((Number(s.monthlyIncome) || 0) / size / Number(b.povertyLine)) * 100)
    parts.push(`${pct}% of ${[b.region, b.year].filter(Boolean).join(' ') || 'the'} poverty line`)
  }
  if (s.is4Ps) parts.push('4Ps')
  const until = classificationValidUntil(s)
  if (until && !isLegacyCategory(s.meansTestCategory)) {
    parts.push(`valid until ${until.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}`)
  }
  return parts.join(' · ')
}

// The most recent completed classification among `requests` (this patient's
// other requests at this hospital) that is still valid, or null.
export function reusableClassification(requests, now = Date.now()) {
  const best = (requests ?? [])
    .map(r => ({ r, s: r.intakeSheet ?? {}, at: toDate(r.intakeSheet?.completedAt) }))
    .filter(x => x.s.meansTestCategory && !isLegacyCategory(x.s.meansTestCategory)
      && x.at && !Number.isNaN(x.at.getTime()) && addMonths(x.at, monthsOf(x.s)) > new Date(now))
    .sort((a, b) => b.at - a.at)[0]
  if (!best) return null
  return {
    requestId:     best.r.id,
    requestRef:    best.r.requestId ?? best.r.id,
    category:      best.s.meansTestCategory,
    reason:        best.s.meansTestOverrideReason || null,
    by:            best.s.completedBy || null,
    at:            best.at,
    validUntil:    addMonths(best.at, monthsOf(best.s)),
    validMonths:   monthsOf(best.s),
    is4Ps:         !!best.s.is4Ps,
    circumstances: best.s.circumstances ?? [],
    circumstancesOther: best.s.circumstancesOther ?? '',
    basis:         best.s.classificationBasis ?? null,
    householdSize: best.s.householdSize,
    monthlyIncome: best.s.monthlyIncome,
  }
}
