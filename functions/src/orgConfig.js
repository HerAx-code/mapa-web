// ── Deploying organization (Cloud Function mirror of src/config/org.js) ─────
//
// The server side only needs the access-code contract. Keep the prefix + the
// accepted-prefix set in sync with the web config (src/config/org.js). Env is
// read from process.env (set via Firebase Functions config / .env) so a new
// deployment can change the prefix without a code change.
const ACCESS_CODE_PREFIX = process.env.ACCESS_CODE_PREFIX || 'MAPA'
// Accepted but never issued — patients holding a prior deployment's code are
// not locked out. Empty = clean cut (MAPA-only): no outstanding legacy codes.
const LEGACY_ACCESS_CODE_PREFIXES = []

const acceptedAccessCodePrefixes = () =>
  [ACCESS_CODE_PREFIX, ...LEGACY_ACCESS_CODE_PREFIXES].filter(Boolean)

// Multi-hospital Phase 8: every hospital issues codes under its own prefix
// (hospitals/{id}.accessCodePrefix, unique via accessCodePrefixes), so the
// server checks the FORMAT of any prefix and the code doc decides the hospital.
// Same shape as src/config/org.js ACCESS_CODE_PREFIX_PATTERN.
const ACCESS_CODE_PREFIX_PATTERN = '[A-Z][A-Z0-9]{1,9}'

// Full-code validator for any hospital, e.g. MAPA-2026-00001, BGH-2026-00001.
const accessCodeRe = () =>
  new RegExp(`^${ACCESS_CODE_PREFIX_PATTERN}-\\d{4}-\\d{5}$`)

const accessCodeFormatHint = () => 'PREFIX-YYYY-NNNNN'

// Hospital #1 — a code without a tenantId (pre-backfill) belongs to it.
// Must equal VITE_DEFAULT_HOSPITAL_ID and firestore.rules defaultTenant().
const DEFAULT_HOSPITAL_ID = process.env.DEFAULT_HOSPITAL_ID || 'hospital-1'

module.exports = {
  ACCESS_CODE_PREFIX_PATTERN,
  DEFAULT_HOSPITAL_ID,
  ACCESS_CODE_PREFIX,
  LEGACY_ACCESS_CODE_PREFIXES,
  acceptedAccessCodePrefixes,
  accessCodeRe,
  accessCodeFormatHint,
}
