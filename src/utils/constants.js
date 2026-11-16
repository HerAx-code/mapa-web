// Brand
//
// "MAPA Portal" is redundant — the P in MAPA already stands for Portal.
// Use BRAND_NAME ("MAPA") on its own, or pair with BRAND_SUBTITLE for context.
// Sourced from src/config/org.js so a deployment reskins via env, not by
// chasing hardcoded institution strings across pages/GL templates.
import { ORG } from '../config/org'

export const BRAND_NAME = ORG.name
export const BRAND_SUBTITLE = ORG.shortName
export const BRAND_FULL = ORG.fullName

// Gateway identity — surfaces wherever the patient sees "who is conducting
// my assessment" / "who endorsed my request". The host organization is
// configurable (ORG.gateway*); these aliases are kept so existing importers
// don't need to change. (Name kept as *_GATEWAY_* for import stability.)
export const GATEWAY_NAME     = ORG.gatewayName
export const GATEWAY_INITIALS = ORG.gatewayInitials
export const GATEWAY_COLOR    = ORG.gatewayColor

// Budget period helpers — budget.period is an adjective ('monthly') which
// reads awkwardly when embedded in phrases like "Budget this monthly".
// Use PERIOD_NOUN[period] for "this {month/quarter/year}" / "per {month}"
// phrasings; keep budget.period for adjective slots ("Monthly budget").
export const PERIOD_NOUN = {
  monthly:   'month',
  quarterly: 'quarter',
  yearly:    'year',
}

// Adjective form, title-cased for headers ("Monthly Budget").
export const PERIOD_ADJECTIVE = {
  monthly:   'Monthly',
  quarterly: 'Quarterly',
  yearly:    'Yearly',
}

// Roles
//
// MAPA's role model reflects a one-stop gateway arrangement: agencies
// (PCSO, DOH, DSWD, congressional offices, NGOs) bring their own funds.
// the gateway hosts the platform. So fund control lives inside the agency:
//   - AGENCY_ADMIN — senior officer at the agency (e.g., PCSO branch head).
//     Controls allocation, manages coordinators, sees own audit log.
//   - AGENCY — coordinator/social worker. Approves cases within allocation.
//   - SUPER_ADMIN ("Hospital Admin") — runs ONE hospital's gateway: request
//     queue, patients, access codes (issue/reset/delete), staff accounts,
//     audit log, Hospital Settings. Has zero fund authority.
//   - STAFF_ADMIN — the hospital's day-to-day gateway staff: same queue work
//     and issues access codes; no accounts, audit log, settings, code
//     reset/delete or user deletion.
//   - PATIENT — applicant.
//   - PLATFORM_ADMIN — the network operator (multi-hospital Phase 6): onboards
//     hospitals + their first admins, owns agencies and reference data. No
//     hospital, no patient data. Created only by scripts/create-platform-admin.mjs.
export const ROLES = {
  PLATFORM_ADMIN: 'platform_admin',
  SUPER_ADMIN:  'super_admin',
  STAFF_ADMIN:  'staff_admin',
  AGENCY_ADMIN: 'agency_admin',
  AGENCY:       'agency',
  PATIENT:      'patient',
}

// Helpers — use these instead of role === ROLES.AGENCY comparisons so that
// agency_admin inherits agency permissions automatically.
export const isAgencyRole = (role) => role === ROLES.AGENCY || role === ROLES.AGENCY_ADMIN
export const isGatewayAdminRole = (role) => role === ROLES.SUPER_ADMIN || role === ROLES.STAFF_ADMIN
export const isPlatformAdminRole = (role) => role === ROLES.PLATFORM_ADMIN

// Idle session timeout (security-improvement-plan §1.3; see
// docs/session-timeout-and-terms-plan.md). STAFF ONLY — patients are exempt,
// because auto-logout punishes the indigent phone users MAPA exists to serve.
// Values are deliberately conservative for health-adjacent PII on potentially
// shared office machines; tune here if field use shows them too aggressive.
export const SESSION_IDLE_MS     = 15 * 60 * 1000       // log out after 15 min idle
export const SESSION_WARN_MS     = 90 * 1000            // warn 90s before logout
export const SESSION_ABSOLUTE_MS = 10 * 60 * 60 * 1000  // hard cap ~10h since app load
// A staff role is subject to the timeout; patients (and logged-out) are not.
export const isTimeoutRole = (role) => isGatewayAdminRole(role) || isAgencyRole(role) || isPlatformAdminRole(role)

// Terms of Use version (docs/session-timeout-and-terms-plan.md). Patients accept
// at registration; the accepted version is stamped on their user doc. Bump this
// (any new string — a date is convenient) when the terms change, and every
// patient is re-prompted to accept at next load (TermsGate). Patient-scoped: the
// Terms are about applying for assistance, so staff accounts are exempt.
export const TERMS_VERSION = '2026-10-18'

// Canonical display labels for roles. Import from here instead of redefining
// per-file so wording stays consistent across the UI.
// Display names (role ids are stored data and never renamed): the network
// operator `platform_admin` is shown as "Super Admin"; the hospital-scoped
// `super_admin` is shown as "Hospital Admin" (owner decision 2026-11-14).
export const ROLE_LABEL = {
  platform_admin: 'Super Administrator',
  super_admin:  'Hospital Administrator',
  staff_admin:  'Staff Administrator',
  agency_admin: 'Agency Administrator',
  agency:       'Agency Coordinator',
  patient:      'Patient',
}

// Short labels for tight UI spaces (chips, table cells, badges).
export const ROLE_LABEL_SHORT = {
  platform_admin: 'Super Admin',
  super_admin:  'Hospital Admin',
  staff_admin:  'Staff Admin',
  agency_admin: 'Agency Admin',
  agency:       'Agency Coordinator',
  patient:      'Patient',
}

// Badge color classes per role for consistent UI tinting.
export const ROLE_BADGE = {
  platform_admin: 'badge-purple',
  super_admin:  'badge-purple',
  staff_admin:  'badge-blue',
  agency_admin: 'badge-amber',
  agency:       'badge-green',
  patient:      'badge-gray',
}

// ── Status configs ─────────────────────────────────────────────────────────
// Keyed by the LOWERCASE status string actually written to Firestore.
// These are the single source of truth — use <StatusBadge /> instead of
// redefining label/badge maps per file. The previous PascalCase
// APP_STATUS / DOC_STATUS exports were keyed wrong (uppercase) and got
// shadowed by per-file definitions everywhere.

export const APP_STATUS_CONFIG = {
  pending:       { label: 'Pending',                  badge: 'badge-blue'   },
  // Endorsed means the gateway routed the slice to this agency; the patient still
  // has to hit Proceed before the agency actually starts reviewing funding.
  // So the previous "Awaiting You" label was wrong from the agency's seat --
  // they're not the one being waited on.
  endorsed:      { label: 'Endorsed',                 badge: 'badge-purple' },
  // Post-Proceed funding state. The wire value stays 'reviewing' (the patient
  // rule permits endorsed->reviewing), but to the agency it's a funding queue.
  reviewing:     { label: 'For Funding',              badge: 'badge-amber'  },
  awaiting_info: { label: 'Needs Info',               badge: 'badge-orange' },
  approved:      { label: 'Approved',                 badge: 'badge-green'  },
  certificate:   { label: 'Guarantee Letter Issued',  badge: 'badge-green'  },
  rejected:      { label: 'Rejected',                 badge: 'badge-red'    },
  // The gateway rejected/closed the parent request while this slice was still
  // open — no decision by the agency, nothing committed.
  closed:        { label: 'Closed by hospital',       badge: 'badge-gray'   },
  // Legacy pre-redesign status -- only fires on applications written under
  // the old direct-to-agency model.
  interview:     { label: 'Interview',                badge: 'badge-purple' },
}

export const DOC_STATUS_CONFIG = {
  pending:  { label: 'Pending Review', badge: 'badge-amber' },
  verified: { label: 'Verified',       badge: 'badge-green' },
  rejected: { label: 'Rejected',       badge: 'badge-red'   },
}

export const REPORT_STATUS_CONFIG = {
  open:        { label: 'Open',        badge: 'badge-amber' },
  in_progress: { label: 'In Progress', badge: 'badge-blue'  },
  resolved:    { label: 'Resolved',    badge: 'badge-green' },
}

// Co-funding REQUEST (parent) status — the patient's overall journey toward
// zero balance. Each contributing agency gets a child application "slice"
// which keeps its own APP_STATUS_CONFIG. "partially_funded" is a legitimate
// outcome: agencies cover up to their ceilings and full zero-balance is the
// target, not a guarantee (see the Order of Charging model).
export const REQUEST_STATUS_CONFIG = {
  submitted:        { label: 'Submitted',        badge: 'badge-blue'   },
  under_review:     { label: 'Under Review',      badge: 'badge-amber'  },
  assessment:       { label: 'Assessment',        badge: 'badge-purple' },
  endorsed:         { label: 'Endorsed',          badge: 'badge-purple' },
  partially_funded: { label: 'Partially Funded',  badge: 'badge-amber'  },
  fully_funded:     { label: 'Fully Funded',      badge: 'badge-green'  },
  closed:           { label: 'Closed',            badge: 'badge-gray'   },
  rejected:         { label: 'Rejected',          badge: 'badge-red'    },
  // ── Back-compat (pre-redesign request states; pruned once writers move) ──
  verifying:        { label: 'Under Review',      badge: 'badge-amber'  },
  endorsing:        { label: 'Being Endorsed',    badge: 'badge-purple' },
}

// Slot status thresholds
export const SLOT_STATUS = (remaining, total) => {
  if (remaining === 0) return { label: 'Full',    color: 'text-red-600',   bar: 'bg-red-400',   badge: 'badge-red'   }
  if (remaining / total <= 0.25) return { label: 'Limited', color: 'text-amber-600', bar: 'bg-amber-400', badge: 'badge-amber' }
  return { label: `${remaining} slots`, color: 'text-green-600', bar: 'bg-brand-500', badge: 'badge-green' }
}

// (The former mock AGENCIES array lived here; it had zero importers and was
//  removed in the single-source cleanup. The canonical agency seed is
//  src/data/agencies.seed.js, consumed by Seed.jsx + bootstrap-reference-data.js.)
// PATIENT_NOTIFICATIONS was prototype mock data referenced only by the
// since-removed Navbar/NotificationPanel components. Real notifications
// come from Firestore via the Layout's onSnapshot subscription.

// Guarantee Letter validity (owner decision 2026-11-16: "usually 10 days upon
// issuance"). Each GL approved from that date stores its own expiry,
// `glExpiresAt` = the start (Manila time) of the 11th day after issue, so a
// GL issued 16 Nov is valid until the end of 26 Nov. GLs approved before
// carry no glExpiresAt and keep the 30 days they were printed with
// (LEGACY_GL_VALIDITY_DAYS). Mirrored in functions/src/glExpirySweep.js.
export const GL_VALIDITY_DAYS = 10
export const LEGACY_GL_VALIDITY_DAYS = 30
const DAY_MS = 86400000
const MANILA_OFFSET_MS = 8 * 3600000   // PH has no daylight saving

const tsMillis = (ts) => ts?.toMillis ? ts.toMillis()
  : ts?.toDate ? ts.toDate().getTime()
  : typeof ts?.seconds === 'number' ? ts.seconds * 1000
  : ts ? new Date(ts).getTime() : null

// The instant a GL issued at `issuedMs` stops being valid (new rule).
export const glExpiresAtFor = (issuedMs, days = GL_VALIDITY_DAYS) => {
  const local = new Date(issuedMs + MANILA_OFFSET_MS)
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days + 1) - MANILA_OFFSET_MS
}

// When this GL stops being valid (ms), or null without an issue date:
// its stored glExpiresAt, else the legacy 30 days from approvedAt.
export const glExpiryMs = (app) => {
  const stored = tsMillis(app?.glExpiresAt)
  if (stored != null && !Number.isNaN(stored)) return stored
  const issued = tsMillis(app?.approvedAt)
  if (issued == null || Number.isNaN(issued)) return null
  return issued + (LEGACY_GL_VALIDITY_DAYS + 1) * DAY_MS
}

// The last day the GL is valid, for "valid until …" copy.
export const glValidUntil = (app) => {
  const ms = glExpiryMs(app)
  return ms == null ? null : new Date(ms - 1)
}

// "Is this GL past its validity window even though glStatus still says
// 'issued'?" The flip to glStatus='expired' happens via the expiry sweep
// (agency/Dashboard and the glExpirySweep Cloud Function). Until then the UI
// shows "Expired (action needed)" so the coordinator releases the budget.
export const isGLExpired = (app, now = Date.now()) => {
  if (app?.glStatus !== 'issued') return false
  const ms = glExpiryMs(app)
  return ms != null && now >= ms
}
// Default window for the pre-expiry "act now" warning. 3 days is the
// triage signal: still time for the patient to redeem, but tight enough
// that the agency coordinator should nudge them today rather than later.
// (Patient TrackStatus uses a wider 7-day window so patients have more
// runway to plan; agency triage wants a sharper threshold.)
export const GL_EXPIRING_SOON_DAYS = 3

// Days remaining in the GL validity window. Returns a positive integer
// while valid, 0 on the last valid day, negative once past expiry, or
// null when GL is not in 'issued' state or the issued-at date is missing.
// For the simple "is it past?" answer use isGLExpired() — this helper
// exists for "expires in N days" copy.
export const glDaysRemaining = (app, now = Date.now()) => {
  if (app?.glStatus !== 'issued') return null
  const ms = glExpiryMs(app)
  if (ms == null) return null
  return Math.ceil((ms - now) / DAY_MS) - 1
}


// Pre-expiry triage signal: GL is issued, still valid, but its validity
// window closes within the next `withinDays` days. Use this to surface
// "expires in 3 days" chips so coordinators / patients can act before
// the committed budget is reclaimed. False once the GL has actually
// expired (use isGLExpired() for the post-window state).
export const isGLExpiringSoon = (app, withinDays = GL_EXPIRING_SOON_DAYS) => {
  const days = glDaysRemaining(app)
  return days != null && days >= 0 && days <= withinDays
}

// ── ID verification (advisory face-match + liveness) ───────────────────────
// Thresholds for the on-device face-match / liveness check (src/utils/faceCheck).
// Kept here (not hardcoded in components) so they can be tuned without touching
// the UI. See docs/id-verification-plan.md §2 (verdict bands).
//
// PROVISIONAL — these MUST be calibrated on real logged scores before the chips
// are trusted (plan §7). The whole feature is advisory: a verdict never blocks a
// submission, and the social worker always makes the final call. Scores are
// cosine similarity in [0, 1]; a same-person ID-portrait↔selfie pair typically
// scores high, but the cross-domain (printed low-res ID vs live selfie) match is
// harder than photo-to-photo benchmarks, so HI is set conservatively for
// precision — a green "match" should be trustworthy; borderline falls to amber.
export const FACE_MATCH_HI = 0.72   // cosine ≥ this → faceMatch 'pass', else 'unclear'
export const LIVENESS_HI   = 0.55   // score  ≥ this → liveness  'pass', else 'unclear'
// Advisory screen/photo-recapture flag (src/utils/recaptureCheck.js). score ≥
// this → recaptureSuspected. PROVISIONAL + unvalidated like the two above: a
// weak, never-blocking hint to the social worker, kept conservative so it rarely
// cries wolf. Calibrate against a real labelled set before trusting it.
export const RECAPTURE_HI  = 0.5
