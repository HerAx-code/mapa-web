// Pure helpers for the co-funding REQUEST model.
//
// A request is the patient's medical-assistance need (a bill + an amount).
// CRMC splits it into child "application" slices — one per contributing
// agency — and endorses them sequentially toward zero balance (the Malasakit
// model: PhilHealth applies first, then PCSO → DSWD → DOH-MAIP → LGU, each
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

// Slice statuses that count as money already secured vs. still in flight.
// 'for_funding'/'needs_info' are the redesign's agency-decision states;
// 'reviewing'/'interview' are kept for back-compat until their writers move.
export const COMMITTED_SLICE_STATUSES   = ['approved', 'certificate']
export const OUTSTANDING_SLICE_STATUSES = ['endorsed', 'for_funding', 'needs_info', 'reviewing', 'interview']

// Given a request's amountNeeded and its slices (child applications), compute
// the live funding figures:
//   - committed:   Σ amountApproved for secured slices
//   - outstanding: Σ amountRequested for in-flight slices (reserved caps)
//   - balance:     amountNeeded − committed (what's still unfunded)
//   - headroom:    amountNeeded − committed − outstanding (what CRMC may still
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

// Derive the request status from its funding figures. CRMC can still override
// to 'closed' (gave up on the remaining balance) or 'rejected' (ineligible).
export function deriveRequestStatus({ committed, outstanding }, amountNeeded = 0) {
  const need = Number(amountNeeded) || 0
  if (need > 0 && committed >= need) return 'fully_funded'
  if (committed > 0)                 return 'partially_funded'
  if (outstanding > 0)               return 'endorsed'
  return 'submitted'
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
    status: deriveRequestStatus({ committed: f.committed, outstanding: f.outstanding }, amountNeeded),
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
  if (app.status === 'rejected') return true
  if (app.status === 'certificate') {
    if (app.glStatus === 'redeemed') return true
    if (app.glStatus === 'expired')  return true
    if (typeof isGLExpired === 'function' && isGLExpired(app)) return true
  }
  return false
}