// The one definition of a case's money and lifecycle state (Phase 2, T8 —
// docs/phase2-money-plan.md).
//
// PURE: no Firebase, no ORG, no import.meta, no browser APIs. The web imports
// it directly; the Cloud Functions get it through the esbuild bundle
// (scripts/build-shared.mjs → functions/src/generated/shared.cjs). Change a
// rule here and both sides change together — never re-declare these lists or
// predicates elsewhere (gap R9 / R11: "active request" was defined six times
// and "assistance given" differently in every report).
//
// Timestamps may be Firestore Timestamps (web or Admin SDK), { seconds },
// Dates, ISO strings or millis.

const DAY_MS = 86400000
const MANILA_OFFSET_MS = 8 * 3600000   // PH has no daylight saving

const tsMillis = (ts) => ts?.toMillis ? ts.toMillis()
  : ts?.toDate ? ts.toDate().getTime()
  : typeof ts?.seconds === 'number' ? ts.seconds * 1000
  : ts ? new Date(ts).getTime() : null

// ── Guarantee letters ───────────────────────────────────────────────────────
// Validity (owner decision 2026-11-16: "usually 10 days upon issuance"). Each
// letter stores `glExpiresAt` = the start (Manila time) of the 11th day after
// issue; letters approved before carry none and keep the 30 days they were
// printed with.
export const GL_VALIDITY_DAYS = 10
export const LEGACY_GL_VALIDITY_DAYS = 30
// The agency's "act now" window. (The patient's Track Status uses 7.)
export const GL_EXPIRING_SOON_DAYS = 3

// The instant a letter issued at `issuedMs` stops being valid.
export const glExpiresAtFor = (issuedMs, days = GL_VALIDITY_DAYS) => {
  const local = new Date(issuedMs + MANILA_OFFSET_MS)
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days + 1) - MANILA_OFFSET_MS
}

// When this letter stops being valid (ms), or null without an issue date.
export const glExpiryMs = (app) => {
  const stored = tsMillis(app?.glExpiresAt)
  if (stored != null && !Number.isNaN(stored)) return stored
  const issued = tsMillis(app?.approvedAt)
  if (issued == null || Number.isNaN(issued)) return null
  return issued + (LEGACY_GL_VALIDITY_DAYS + 1) * DAY_MS
}

// The last day the letter is valid, for "valid until …" copy.
export const glValidUntil = (app) => {
  const ms = glExpiryMs(app)
  return ms == null ? null : new Date(ms - 1)
}

// Past its validity while glStatus still says 'issued' (the sweep hasn't run).
export const isGLExpired = (app, now = Date.now()) => {
  if (app?.glStatus !== 'issued') return false
  const ms = glExpiryMs(app)
  return ms != null && now >= ms
}

// Days left: positive while valid, 0 on the last day, negative once past,
// null when the letter isn't issued or has no date.
export const glDaysRemaining = (app, now = Date.now()) => {
  if (app?.glStatus !== 'issued') return null
  const ms = glExpiryMs(app)
  if (ms == null) return null
  return Math.ceil((ms - now) / DAY_MS) - 1
}

export const isGLExpiringSoon = (app, withinDays = GL_EXPIRING_SOON_DAYS, now = Date.now()) => {
  const days = glDaysRemaining(app, now)
  return days != null && days >= 0 && days <= withinDays
}

/**
 * The letter's state, by its own glStatus (2026-11-16: never by the slice
 * status alone — a letter exists from approval, before "Mark as Issued").
 *   'none'     no letter (not approved, or the approval was reversed)
 *   'valid'    issued and inside its validity
 *   'expiring' issued, within `withinDays` of its end
 *   'used'     redeemed by the provider
 *   'expired'  expired, or past its validity and not yet swept
 */
export function letterState(app, now = Date.now(), withinDays = GL_EXPIRING_SOON_DAYS) {
  if (!app) return 'none'
  if (app.glStatus === 'redeemed') return 'used'
  if (app.glStatus === 'expired') return 'expired'
  if (app.glStatus !== 'issued') return 'none'
  if (isGLExpired(app, now)) return 'expired'
  const d = glDaysRemaining(app, now)
  return d != null && d <= withinDays ? 'expiring' : 'valid'
}

// ── Slices ──────────────────────────────────────────────────────────────────
// The exact strings written to `applications.status`: endorsed → reviewing
// ("For Funding") ⇄ awaiting_info → approved → certificate, or rejected / closed.
// The pre-redesign 'pending' and 'interview' were dropped in Phase 2 PR 2.4:
// no slice in production carries them (checked 2026-11-22).
export const COMMITTED_SLICE_STATUSES   = ['approved', 'certificate']
export const OUTSTANDING_SLICE_STATUSES = ['endorsed', 'reviewing', 'awaiting_info']
export const OPEN_SLICE_STATUSES        = ['endorsed', 'reviewing', 'awaiting_info']

// The approved amount (amountApproved; approvedAmount on older slices).
export const sliceApproved = (s) => Number(s?.amountApproved ?? s?.approvedAmount ?? 0) || 0

// Counts toward the request's funding: approved and its letter not expired.
export const isCommittedSlice = (s) =>
  COMMITTED_SLICE_STATUSES.includes(s?.status) && s?.glStatus !== 'expired'

// A letter that hasn't been settled yet: issued, not redeemed, not expired by
// the sweep. (A letter past its validity stays open until the sweep or the
// agency settles it — so a case can't look finished and then reopen.)
export const isLetterOpen = (s) => COMMITTED_SLICE_STATUSES.includes(s?.status) && s?.glStatus === 'issued'
export const openLettersOf = (slices = []) => (slices ?? []).filter(isLetterOpen).length

// Is this slice done from the patient's side (rejected, closed, or its letter
// used or expired)? `isGLExpired` may be passed to override (tests).
export function isSliceTerminal(app, { isGLExpired: expired = isGLExpired } = {}) {
  if (!app) return false
  if (app.status === 'rejected' || app.status === 'closed') return true
  if (COMMITTED_SLICE_STATUSES.includes(app.status)) {
    if (app.glStatus === 'redeemed' || app.glStatus === 'expired') return true
    if (typeof expired === 'function' && expired(app)) return true
  }
  return false
}

// ── Agency money per slice (budget.committed / budget.disbursed) ───────────
// Committed = letters issued and not settled; disbursed = what providers billed
// on redeemed letters (the full approved amount on letters redeemed before
// redeemedAmount existed). Expired letters count toward neither.
export const committedOf = (s) => (isLetterOpen(s) ? sliceApproved(s) : 0)
export const disbursedOf = (s) => (COMMITTED_SLICE_STATUSES.includes(s?.status) && s?.glStatus === 'redeemed'
  ? Number(s?.redeemedAmount ?? sliceApproved(s)) || 0
  : 0)

/**
 * "Assistance given" — the one definition every report uses (P2-F): an
 * approved letter that was not left to expire unused. `billed` is what the
 * provider billed once it was redeemed, else null.
 */
export function assistanceGivenOf(s, now = Date.now()) {
  if (!COMMITTED_SLICE_STATUSES.includes(s?.status)) return null
  const state = letterState(s, now)
  // 'none' on an approved slice = approved before letters were tracked: counts.
  if (state === 'expired') return null
  return {
    approved: sliceApproved(s),
    // The recorded billed amount; a letter redeemed before it was recorded
    // was settled at the full approved amount.
    billed: s?.redeemedAmount != null ? (Number(s.redeemedAmount) || 0) : state === 'used' ? sliceApproved(s) : null,
    state,
  }
}

// ── Requests ────────────────────────────────────────────────────────────────
// Rank along the co-funding lifecycle (0-5), for the patient "where am I" views.
export const REQ_RANK = {
  submitted: 0, under_review: 1, assessment: 2,
  endorsed: 3, partially_funded: 4, fully_funded: 5,
}
export const reqRank = (status) => REQ_RANK[status] ?? 0

// Net amount the agencies co-fund after the bill's discounts, PhilHealth and
// other coverage. Never negative.
export function computeAmountNeeded({ totalBill = 0, discountsApplied = 0, philhealthCovered = 0, otherCovered = 0 } = {}) {
  const net = Number(totalBill) - (Number(discountsApplied) || 0) - Number(philhealthCovered) - Number(otherCovered)
  return Number.isFinite(net) ? Math.max(0, net) : 0
}

export function deriveAmountNeeded(req = {}) {
  if (req == null || req.totalBill === undefined || req.totalBill === null) {
    return Number(req?.amountNeeded) || 0
  }
  return computeAmountNeeded({
    totalBill: req.totalBill, discountsApplied: req.discountsApplied,
    philhealthCovered: req.philhealthCovered, otherCovered: req.otherCovered,
  })
}

// Funding figures for a request from its slices.
export function computeFunding(amountNeeded = 0, slices = []) {
  const need = Number(amountNeeded) || 0
  const committed = (slices ?? []).filter(isCommittedSlice).reduce((sum, s) => sum + (Number(s.amountApproved) || 0), 0)
  const outstanding = (slices ?? [])
    .filter((s) => OUTSTANDING_SLICE_STATUSES.includes(s.status))
    .reduce((sum, s) => sum + (Number(s.amountRequested) || 0), 0)
  const balance  = Math.max(0, need - committed)
  const headroom = Math.max(0, need - committed - outstanding)
  const pct      = need > 0 ? Math.min(100, Math.round((committed / need) * 100)) : 0
  return { committed, outstanding, balance, headroom, pct, fullyFunded: need > 0 && committed >= need }
}

// The status the funding maths gives. When every agency declined, the case
// goes back to the hospital as 'under_review'.
export function deriveRequestStatus({ committed, outstanding }, amountNeeded = 0, endorsedBefore = false) {
  const need = Number(amountNeeded) || 0
  if (need > 0 && committed >= need) return 'fully_funded'
  if (committed > 0)                 return 'partially_funded'
  if (outstanding > 0)               return 'endorsed'
  return endorsedBefore ? 'under_review' : 'submitted'
}

// The statuses the funding maths owns; anything else is the hospital's call.
export const DERIVED_REQUEST_STATUSES = ['submitted', 'endorsed', 'partially_funded', 'fully_funded']
export const syncedRequestStatus = (current, next) =>
  DERIVED_REQUEST_STATUSES.includes(current) ? next : current

// Status, committed total and open letters, recomputed from the slices (the
// slice that just changed already in its new state).
export function deriveRequestFinancials(slices = [], amountNeeded = 0) {
  const f = computeFunding(amountNeeded, slices)
  return {
    amountCommitted: f.committed,
    openLetters: openLettersOf(slices),
    status: deriveRequestStatus({ committed: f.committed, outstanding: f.outstanding }, amountNeeded, (slices ?? []).length > 0),
  }
}

export const REQUEST_CLOSED_STATUSES = ['closed', 'rejected']
// The hospital ended it (no new commitments).
export const isRequestClosed = (status) => REQUEST_CLOSED_STATUSES.includes(status)
export const isRequestClosedByGateway = isRequestClosed

/**
 * Is the case FINISHED (decision D4 / P2-B)? Closed or rejected, or fully
 * funded with every approved letter settled (redeemed or expired). Only a
 * finished case frees the patient to file again, purges the selfie and moves
 * to "Past". `openLetters` is kept on the request by syncRequestFinancials; a
 * request without it (older records) counts as having none.
 */
export const isRequestFinished = (req) =>
  isRequestClosed(req?.status) || (req?.status === 'fully_funded' && !(Number(req?.openLetters) > 0))

// Still the patient's current case.
export const isRequestActive = (req) => !!req?.status && !isRequestFinished(req)

// ── Agency slots ────────────────────────────────────────────────────────────
// An agency's slots for TODAY at a hospital: its own share
// (hospitalSlots[hospitalId]) or the agency-wide default. Resets lazily: a
// count stored on an earlier day means the slots have refilled.
export function effectiveSlots(agency, todayKey, hospitalId) {
  const own = hospitalId ? agency?.hospitalSlots?.[hospitalId] : null
  const src = own ?? { ...(agency?.slots ?? {}), lastResetDate: agency?.lastResetDate }
  const total  = Number(src.total) || 0
  const stored = Number(src.remaining) || 0
  const stale  = total > 0 && !!todayKey && !!src.lastResetDate && src.lastResetDate !== todayKey
  return { total, remaining: stale ? total : Math.min(stored, total || stored), stale, perHospital: !!own }
}

// Today's date in Manila as YYYY-MM-DD (the slot day).
export const manilaDayKey = (ms = Date.now()) => new Date(ms + MANILA_OFFSET_MS).toISOString().slice(0, 10)
