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
export const COMMITTED_SLICE_STATUSES   = ['approved', 'certificate']
export const OUTSTANDING_SLICE_STATUSES = ['endorsed', 'reviewing', 'interview']

// Given a request's amountNeeded and its slices (child applications), compute
// the live funding figures:
//   - committed:   Σ amountApproved for secured slices
//   - outstanding: Σ amountRequested for in-flight slices (reserved caps)
//   - balance:     amountNeeded − committed (what's still unfunded)
//   - headroom:    amountNeeded − committed − outstanding (what CRMC may still
//                  endorse without breaching the balance cap)
//   - pct:         committed / amountNeeded, 0–100
//   - fullyFunded: committed has reached the target
export function computeFunding(amountNeeded = 0, slices = []) {
  const need = Number(amountNeeded) || 0
  const committed = slices
    .filter(s => COMMITTED_SLICE_STATUSES.includes(s.status))
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
  if (outstanding > 0)               return 'endorsing'
  return 'submitted'
}