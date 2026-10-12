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
export const CRMC_GATEWAY_NAME     = ORG.gatewayName
export const CRMC_GATEWAY_INITIALS = ORG.gatewayInitials
export const CRMC_GATEWAY_COLOR    = ORG.gatewayColor

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
// MAPA's role model reflects the Malasakit Center arrangement: agencies
// (PCSO, DOH, DSWD, congressional offices, NGOs) bring their own funds.
// CRMC hosts the platform. So fund control lives inside the agency:
//   - AGENCY_ADMIN — senior officer at the agency (e.g., PCSO branch head).
//     Controls allocation, manages coordinators, sees own audit log.
//   - AGENCY — coordinator/social worker. Approves cases within allocation.
//   - SUPER_ADMIN — CRMC platform operator. Onboards agencies, doc review,
//     issues Patient Access Codes. Has zero fund authority.
//   - STAFF_ADMIN — CRMC operations staff. Same as super_admin minus
//     destructive actions.
//   - PATIENT — applicant.
export const ROLES = {
  SUPER_ADMIN:  'super_admin',
  STAFF_ADMIN:  'staff_admin',
  AGENCY_ADMIN: 'agency_admin',
  AGENCY:       'agency',
  PATIENT:      'patient',
}

// Helpers — use these instead of role === ROLES.AGENCY comparisons so that
// agency_admin inherits agency permissions automatically.
export const isAgencyRole = (role) => role === ROLES.AGENCY || role === ROLES.AGENCY_ADMIN
export const isCrmcAdminRole = (role) => role === ROLES.SUPER_ADMIN || role === ROLES.STAFF_ADMIN

// Canonical display labels for roles. Import from here instead of redefining
// per-file so wording stays consistent across the UI.
export const ROLE_LABEL = {
  super_admin:  'Super Administrator',
  staff_admin:  'Staff Administrator',
  agency_admin: 'Agency Administrator',
  agency:       'Agency Coordinator',
  patient:      'Patient',
}

// Short labels for tight UI spaces (chips, table cells, badges).
export const ROLE_LABEL_SHORT = {
  super_admin:  'Super Admin',
  staff_admin:  'Staff Admin',
  agency_admin: 'Agency Admin',
  agency:       'Agency Coordinator',
  patient:      'Patient',
}

// Badge color classes per role for consistent UI tinting.
export const ROLE_BADGE = {
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
  // Endorsed means CRMC routed the slice to this agency; the patient still
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
// target, not a guarantee (see Malasakit sequential-charging model).
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

// Guarantee Letter validity window — counted from approvedAt. After this
// many days a GL whose glStatus is still 'issued' is considered expired
// at the provider and the committed budget should be released.
// Surfaced on both patient (TrackStatus expiry banner) and agency
// (Inbox / ApplicationDetail / Dashboard expiry handlers).
export const GL_VALIDITY_DAYS = 30

// "Is this GL past its validity window even though glStatus still says
// 'issued'?" The post-window state machine flip to glStatus='expired'
// happens via the lazy expiry sweep on agency/Dashboard (or a future
// Cloud Function). Until that flip lands, the UI uses isGLExpired() to
// show "Expired (action needed)" so the coordinator knows to release
// committed budget. Duplicated in agency/Inbox + agency/ApplicationDetail
// before extraction; now sourced from here so the threshold and the
// answer match across surfaces.
export const isGLExpired = (app) => {
  if (app?.glStatus !== 'issued') return false
  const issued = app.approvedAt?.toDate
    ? app.approvedAt.toDate()
    : (app.approvedAt ? new Date(app.approvedAt) : null)
  if (!issued) return false
  const days = Math.floor((Date.now() - issued.getTime()) / 86400000)
  return days > GL_VALIDITY_DAYS
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
export const glDaysRemaining = (app) => {
  if (app?.glStatus !== 'issued') return null
  const issued = app.approvedAt?.toDate
    ? app.approvedAt.toDate()
    : (app.approvedAt ? new Date(app.approvedAt) : null)
  if (!issued) return null
  const daysSinceIssue = Math.floor((Date.now() - issued.getTime()) / 86400000)
  return GL_VALIDITY_DAYS - daysSinceIssue
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
