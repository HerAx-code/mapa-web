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

// The funding maths, slice and request states and daily slots live in the
// shared case-state module (Phase 2, T8): one definition for the web and the
// Cloud Functions (syncRequestFinancials, onRequestWritten, the money
// functions). Re-exported here so existing imports keep working.
export {
  computeAmountNeeded, deriveAmountNeeded,
  COMMITTED_SLICE_STATUSES, OUTSTANDING_SLICE_STATUSES, OPEN_SLICE_STATUSES,
  REQ_RANK, reqRank, computeFunding, deriveRequestStatus,
  DERIVED_REQUEST_STATUSES, syncedRequestStatus,
  effectiveSlots, deriveRequestFinancials, isSliceTerminal,
  isRequestFinished, isRequestActive, isRequestClosed, sliceApproved,
} from '../shared/caseState'

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
