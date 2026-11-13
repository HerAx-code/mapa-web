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
  // Optional institution tag under the product name (was 'the gateway'). Empty by
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
  // clean cut (MAPA-only): confirmed no outstanding legacy codes, so none kept.
  accessCodePrefix: env.VITE_ACCESS_CODE_PREFIX || 'MAPA',
  legacyAccessCodePrefixes: [],

  // Where patients are told to go / write for an access code.
  contactEmail: env.VITE_ORG_CONTACT_EMAIL || 'support@example.org',
}

// ── Multi-hospital tenancy (docs/multi-hospital-network-plan.md, Phase 1) ───
//
// MAPA is becoming one deployment serving many hospitals. The env values above
// are now the FALLBACK; at sign-in AuthContext loads the user's hospitals/{id}
// doc and applyHospital() copies its fields INTO this same ORG object. Every
// existing `ORG.x` read — React pages, HTML builders (GL / intake sheet),
// notify(), MFA issuer — picks up the hospital's value with no call-site change.
// Values copied once at module load go stale: i18n/index.js re-syncs its token
// map via onOrgChange(); lazily-loaded pages evaluate after sign-in.
//
// Users carry no hospitalId until Phase 2, so everyone resolves to the default
// (hospital #1, seeded from these env values by scripts/seed-default-hospital.mjs).
export const DEFAULT_HOSPITAL_ID = env.VITE_DEFAULT_HOSPITAL_ID || 'hospital-1'

// Fields a hospital doc may override. NOT here on purpose:
//   - name / fullName: the MAPA product brand is network-wide, not per hospital.
//   - accessCodePrefix: verifyAccessCode (server) still validates against the
//     single env prefix; issuing codes with a hospital prefix before Phase 8
//     makes the server reject them.
const HOSPITAL_FIELDS = ['shortName', 'gatewayName', 'gatewayInitials', 'facilityName', 'contactEmail']

const ENV_ORG = { ...ORG, hospitalId: DEFAULT_HOSPITAL_ID }
Object.assign(ORG, ENV_ORG)

const listeners = new Set()

// Subscribe to hospital changes. Returns an unsubscribe function.
export const onOrgChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

// Apply a hospital doc's data (or null = back to env defaults, e.g. on sign-out
// or when the doc is missing/unreadable). Blank values fall back to env so a
// half-filled hospital doc never blanks out the UI.
export function applyHospital(hospital, hospitalId = DEFAULT_HOSPITAL_ID) {
  Object.assign(ORG, ENV_ORG)
  if (hospital) {
    ORG.hospitalId = hospitalId
    for (const key of HOSPITAL_FIELDS) {
      const v = hospital[key]
      if (typeof v === 'string' && v.trim()) ORG[key] = v.trim()
    }
    // A configured facility is a proper noun, used verbatim in both languages.
    if (ORG.facilityName !== ENV_ORG.facilityName) ORG.facilityNameFil = ORG.facilityName
  }
  listeners.forEach((fn) => fn(ORG))
}

// All prefixes a typed access code may validly use (active + legacy).
export const acceptedAccessCodePrefixes = () =>
  [ORG.accessCodePrefix, ...ORG.legacyAccessCodePrefixes].filter(Boolean)

// Validator for a full access code, e.g. MAPA-2026-00001 (or a legacy the gateway- one).
export const accessCodeRe = () =>
  new RegExp(`^(${acceptedAccessCodePrefixes().join('|')})-\\d{4}-\\d{5}$`)

// The active issuing prefix for a given year, e.g. "MAPA-2026-".
export const accessCodePrefixFor = (year) => `${ORG.accessCodePrefix}-${year}-`

// Human-readable format hint, e.g. "MAPA-YYYY-NNNNN".
export const accessCodeFormatHint = () => `${ORG.accessCodePrefix}-YYYY-NNNNN`
