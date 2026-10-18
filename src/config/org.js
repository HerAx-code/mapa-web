// ── Deploying organization (single source of truth) ────────────────────────
//
// MAPA is a client-agnostic platform: the host organization that issues
// Patient Access Codes, conducts the assessment, and endorses requests is
// NOT hardcoded. Everything the patient sees about "who runs this" reads
// from ORG so a new deployment reskins by setting a few env vars — no string
// chasing across pages, GL templates, or the Cloud Function.
//
// Defaults are the neutral MAPA identity. A real deployment overrides the
// institution-specific fields (name/gateway/contact/access-code prefix) via
// VITE_ORG_* env at build time. Geography (BARMM/Cotabato) is deliberately
// NOT here — it is real Philippine location data, not brand.
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}

export const ORG = {
  // Short product name shown in the header/logo lockup.
  name: env.VITE_ORG_NAME || 'MAPA',
  // Optional institution tag under the product name (was 'CRMC'). Empty by
  // default so an unaffiliated deployment shows no host institution.
  shortName: env.VITE_ORG_SHORT_NAME || '',
  // Expanded product name.
  fullName: env.VITE_ORG_FULL_NAME || 'Medical Assistance Portal Access',

  // The gateway office: issues access codes, runs the one remote assessment,
  // and endorses to funders. Appears wherever the patient reads "who is
  // assessing / who endorsed me" and on the Guarantee Letter + intake sheet.
  gatewayName: env.VITE_ORG_GATEWAY_NAME || 'Medical Social Services',
  gatewayInitials: env.VITE_ORG_GATEWAY_INITIALS || 'MSS',
  gatewayColor: 'bg-brand-500',

  // The host hospital/facility itself — used where copy refers to the place a
  // patient is admitted/treated or "your hospital bill". Neutral default;
  // an affiliated deployment overrides to the real hospital name so copy like
  // "admitted at {{facility}}" reads correctly. Mostly used mid-sentence.
  facilityName: env.VITE_ORG_FACILITY_NAME || 'the hospital',
  // Filipino rendering of the facility. A configured VITE_ORG_FACILITY_NAME is a
  // proper noun (language-neutral), so it's used verbatim in both languages; only
  // the generic English default ("the hospital") needs a Filipino equivalent, so
  // patient copy renders "sa ospital" rather than the mixed-language "sa the
  // hospital". Tagalog prepositions (sa/ng) take the bare noun — no article.
  facilityNameFil: env.VITE_ORG_FACILITY_NAME || 'ospital',

  // Patient Access Code prefix. New codes are issued as
  //   `${accessCodePrefix}-YYYY-NNNNN`  e.g. MAPA-2026-00001
  // legacyAccessCodePrefixes are ACCEPTED at registration but never issued, so
  // patients holding a code from a prior deployment aren't locked out. Empty =
  // clean cut (MAPA-only): confirmed no outstanding CRMC codes, so none kept.
  accessCodePrefix: env.VITE_ACCESS_CODE_PREFIX || 'MAPA',
  legacyAccessCodePrefixes: [],

  // Where patients are told to go / write for an access code.
  contactEmail: env.VITE_ORG_CONTACT_EMAIL || 'support@example.org',
}

// All prefixes a typed access code may validly use (active + legacy).
export const acceptedAccessCodePrefixes = () =>
  [ORG.accessCodePrefix, ...ORG.legacyAccessCodePrefixes].filter(Boolean)

// Validator for a full access code, e.g. MAPA-2026-00001 (or a legacy CRMC- one).
export const accessCodeRe = () =>
  new RegExp(`^(${acceptedAccessCodePrefixes().join('|')})-\\d{4}-\\d{5}$`)

// The active issuing prefix for a given year, e.g. "MAPA-2026-".
export const accessCodePrefixFor = (year) => `${ORG.accessCodePrefix}-${year}-`

// Human-readable format hint, e.g. "MAPA-YYYY-NNNNN".
export const accessCodeFormatHint = () => `${ORG.accessCodePrefix}-YYYY-NNNNN`
