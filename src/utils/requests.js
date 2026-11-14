// Pure helpers for the co-funding REQUEST model.
//
// A request is the patient's medical-assistance need (a bill + an amount).
// the gateway splits it into child "application" slices — one per contributing
// agency — and endorses them sequentially toward zero balance (the Order of
// Charging model: PhilHealth applies first, then PCSO → DSWD → DOH-MAIP → LGU, each
// covering up to its own ceiling). PhilHealth is captured as a deduction on
// the request itself, not as an endorsable agency.
//
// The balance-cap invariant (committed + outstanding <= amountNeeded) is
// enforced inside the endorsement / approval transactions; these helpers
// compute the figures the UI and those transactions rely on.

export const REQUEST_ID_PREFIX = 'REQ'

export function generateRequestId() {
  const year = new Date().getFullYear()
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase()
  return `${REQUEST_ID_PREFIX}-${year}-${String(Date.now()).slice(-6)}${rand}`
}

// Net amount the agencies must co-fund, after PhilHealth + any prior coverage
// is applied first (sequential charging). Never negative.
export function computeAmountNeeded({ totalBill = 0, philhealthCovered = 0, otherCovered = 0 } = {}) {
  const net = Number(totalBill) - Number(philhealthCovered) - Number(otherCovered)
  return Number.isFinite(net) ? Math.max(0, net) : 0
}

// Derive a request's residual (amountNeeded) from its captured bill + coverage.
// Legacy-safe: requests created before the totalBill/coverage fields existed
// have no `totalBill`, so fall back to their stored `amountNeeded` — display
// and derivation code then never produce NaN or a spurious 0. This is the one
// entry point callers should use; it wraps computeAmountNeeded with that guard.
export function deriveAmountNeeded(req = {}) {
  if (req == null || req.totalBill === undefined || req.totalBill === null) {
    return Number(req?.amountNeeded) || 0
  }
  return computeAmountNeeded({
    totalBill:         req.totalBill,
    philhealthCovered: req.philhealthCovered,
    otherCovered:      req.otherCovered,
  })
}

// Slice statuses that count as money already secured vs. still in flight.
// These MUST match the exact strings the app writes to `applications.status`
// (see the agency ApplicationDetail handlers): a slice is endorsed → reviewing
// ("For Funding") → awaiting_info (agency chasing the patient) → approved →
// certificate, or rejected. 'interview' is a legacy pre-redesign in-flight
// state kept for back-compat.
// ⚠ Mirror of the identical list in functions/src/syncRequestFinancials.js —
// that Cloud Function is the authoritative writer of request.status, so the two
// lists MUST stay in sync. Earlier this listed the never-written 'for_funding'
// and 'needs_info' and OMITTED 'awaiting_info', so an awaiting_info slice fell
// out of `outstanding` and the sync function could regress an endorsed request
// back to 'submitted'.
export const COMMITTED_SLICE_STATUSES   = ['approved', 'certificate']
export const OUTSTANDING_SLICE_STATUSES = ['endorsed', 'reviewing', 'awaiting_info', 'interview']

// Rank of a request status along the co-funding lifecycle (0-5). Single source
// of truth for the patient "where am I" surfaces (JourneyStrip / StatusHero /
// Dashboard) — import this instead of re-declaring the map, so adding or
// reordering a status can't silently diverge between them.
export const REQ_RANK = {
  submitted: 0, under_review: 1, assessment: 2,
  endorsed: 3, partially_funded: 4, fully_funded: 5,
}
export const reqRank = (status) => REQ_RANK[status] ?? 0

// Given a request's amountNeeded and its slices (child applications), compute
// the live funding figures:
//   - committed:   Σ amountApproved for secured slices
//   - outstanding: Σ amountRequested for in-flight slices (reserved caps)
//   - balance:     amountNeeded − committed (what's still unfunded)
//   - headroom:    amountNeeded − committed − outstanding (what the gateway may still
//                  endorse without breaching the balance cap)
//   - pct:         committed / amountNeeded, 0–100
//   - fullyFunded: committed has reached the target
// A slice's `status` field is the headline state, but for slices that
// reached `certificate` (GL issued) the `glStatus` field tells us
// whether the money is still committed or has been released. Expired
// GLs released their committed budget back to the agency's allocation
// (performExpireGL fires `budget.committed -= amount`), so they MUST
// NOT continue to count as committed on the parent request.
// Discovered during the 2026-06-03 end-to-end review (R2).
function isCommittedSlice(s) {
  if (!COMMITTED_SLICE_STATUSES.includes(s.status)) return false
  if (s.status === 'certificate' && s.glStatus === 'expired') return false
  return true
}

export function computeFunding(amountNeeded = 0, slices = []) {
  const need = Number(amountNeeded) || 0
  const committed = slices
    .filter(isCommittedSlice)
    .reduce((sum, s) => sum + (Number(s.amountApproved) || 0), 0)
  const outstanding = slices
    .filter(s => OUTSTANDING_SLICE_STATUSES.includes(s.status))
    .reduce((sum, s) => sum + (Number(s.amountRequested) || 0), 0)
  const balance  = Math.max(0, need - committed)
  const headroom = Math.max(0, need - committed - outstanding)
  const pct      = need > 0 ? Math.min(100, Math.round((committed / need) * 100)) : 0
  return { committed, outstanding, balance, headroom, pct, fullyFunded: need > 0 && committed >= need }
}

// Phase 2.2 — capacity at endorsement. Can an agency actually fund `need`
// (the request's remaining balance) right now? Looks at the agency's LIVE
// budget headroom (allocated − committed) and its per-applicant policy cap;
// slot availability is a separate gate the caller already applies. Returns:
//   - ceiling: the most this agency could approve (Infinity = uncapped)
//   - status:  'full'  (covers the whole need, or is uncapped / nothing to fund)
//              'partial'(can fund some but not all)
//              'none'   (no budget headroom left)
// ADVISORY ONLY — surfaced so the gateway doesn't endorse to a zero-headroom funder;
// never a hard block (budget is re-checked with authority at approval).
export function agencyCoverage(agency, need = 0) {
  const alloc     = Number(agency?.budget?.allocated) || 0
  const committed = Number(agency?.budget?.committed) || 0
  // No allocation set = no cap configured = treat as unlimited headroom.
  const budgetHeadroom = alloc > 0 ? Math.max(0, alloc - committed) : Infinity
  const perCap  = Number(agency?.maxPerApplicant) || 0
  const ceiling = Math.min(budgetHeadroom, perCap > 0 ? perCap : Infinity)

  const want = Math.max(0, Number(need) || 0)
  let status
  if (want === 0)        status = 'full' // nothing to fund → trivially covered
  else if (ceiling <= 0) status = 'none'
  else if (ceiling >= want) status = 'full'
  else                   status = 'partial'
  return { ceiling, status }
}

// Derive the request status from its funding figures. the gateway can still override
// to 'closed' (gave up on the remaining balance) or 'rejected' (ineligible).
// `endorsedBefore`: the request already has slices. When every one of them is
// declined (nothing committed, nothing outstanding) the case goes back to the
// gateway as 'under_review' to endorse elsewhere or close — NOT 'submitted',
// which made it look like a brand-new filing (logic review 2026-11-14).
export function deriveRequestStatus({ committed, outstanding }, amountNeeded = 0, endorsedBefore = false) {
  const need = Number(amountNeeded) || 0
  if (need > 0 && committed >= need) return 'fully_funded'
  if (committed > 0)                 return 'partially_funded'
  if (outstanding > 0)               return 'endorsed'
  return endorsedBefore ? 'under_review' : 'submitted'
}

// The request statuses the funding maths owns. Anything else (under_review,
// assessment, closed, rejected) is the gateway's decision and is never
// overwritten by a slice event — same authority boundary as
// functions/src/syncRequestFinancials.js. (The maths may still MOVE a request
// into 'under_review' when every agency declines.)
export const DERIVED_REQUEST_STATUSES = ['submitted', 'endorsed', 'partially_funded', 'fully_funded']
export const syncedRequestStatus = (current, next) =>
  DERIVED_REQUEST_STATUSES.includes(current) ? next : current

// A request the gateway has finished (rejected / closed): no new commitments.
export const isRequestClosedByGateway = (status) => ['closed', 'rejected'].includes(status)

// Slices still in play (not decided, not committed).
export const OPEN_SLICE_STATUSES = ['pending', 'endorsed', 'reviewing', 'awaiting_info', 'interview']

// An agency's slots for TODAY — per partner hospital (owner decision
// 2026-11-14: each hospital gets its own daily count, set by the agency
// admin in agencies.hospitalSlots[hospitalId] = { total, remaining,
// lastResetDate }). A hospital without its own entry falls back to the
// agency-wide default (agencies.slots). The daily reset is written lazily, so
// a stored figure from a KNOWN earlier day means the slots have refilled.
export function effectiveSlots(agency, todayKey, hospitalId) {
  const own = hospitalId ? agency?.hospitalSlots?.[hospitalId] : null
  const src = own ?? { ...(agency?.slots ?? {}), lastResetDate: agency?.lastResetDate }
  const total  = Number(src.total) || 0
  const stored = Number(src.remaining) || 0
  const stale  = total > 0 && !!todayKey && !!src.lastResetDate && src.lastResetDate !== todayKey
  return { total, remaining: stale ? total : Math.min(stored, total || stored), stale, perHospital: !!own }
}

// When a slice transitions OUT of committed status (reversal, expiry),
// the parent request's `amountCommitted` + `status` fields go stale
// because they were stamped at approval time and never updated. The
// L11 'data check' chip surfaces this contract violation, but the
// fix is to also re-sync the parent on every release.
//
// Returns { amountCommitted, amountOutstanding, status } recomputed
// from the slice array, assuming the slice that just transitioned
// is ALREADY in its post-transition state inside `slices`.
//
// Use this inside the transaction that flipped the slice status, with
// `slices` populated from sibling reads on the same transaction.
//
// R3 fix: 2026-06-03 end-to-end review.
export function deriveRequestFinancials(slices = [], amountNeeded = 0) {
  const f = computeFunding(amountNeeded, slices)
  return {
    amountCommitted: f.committed,
    status: deriveRequestStatus({ committed: f.committed, outstanding: f.outstanding }, amountNeeded, slices.length > 0),
  }
}

// Is this slice DONE from the patient's perspective? Returns true when:
//   - rejected (agency turned it down — terminal)
//   - certificate + glStatus 'redeemed' (patient claimed at agency office)
//   - certificate + glStatus 'expired' (lapsed past validity window)
//   - certificate + past GL_VALIDITY_DAYS (sweep hasn't flipped glStatus yet)
//
// Use this to decide whether a slice belongs in the patient's "In Progress"
// view (active, still has a downloadable GL / pending action) or the "Past
// Applications" view (terminal record). Shared between TrackStatus and the
// patient Dashboard so both surfaces agree on what "active" means.
//
// Reused inside the Dashboard activeApp picker — without this, a redeemed
// or lapsed slice was still selected as the patient's "current" status card,
// which was misleading once the slice was actually done.
//
// Imported lazily inline by callers to avoid circular imports through
// utils/constants (which holds isGLExpired/GL_VALIDITY_DAYS). Pass the
// caller-resolved isGLExpired in to keep this module dependency-free.
// R17 (TrackStatus) introduced the predicate; R18 hoists it here.
export function isSliceTerminal(app, { isGLExpired } = {}) {
  if (!app) return false
  if (app.status === 'rejected' || app.status === 'closed') return true
  if (app.status === 'certificate') {
    if (app.glStatus === 'redeemed') return true
    if (app.glStatus === 'expired')  return true
    if (typeof isGLExpired === 'function' && isGLExpired(app)) return true
  }
  return false
}