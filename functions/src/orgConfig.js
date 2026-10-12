// ── Deploying organization (Cloud Function mirror of src/config/org.js) ─────
//
// The server side only needs the access-code contract. Keep the prefix + the
// accepted-prefix set in sync with the web config (src/config/org.js). Env is
// read from process.env (set via Firebase Functions config / .env) so a new
// deployment can change the prefix without a code change.
const ACCESS_CODE_PREFIX = process.env.ACCESS_CODE_PREFIX || 'MAPA'
// Accepted but never issued — patients holding a prior deployment's code are
// not locked out. Empty = clean cut (MAPA-only): no outstanding CRMC codes.
const LEGACY_ACCESS_CODE_PREFIXES = []

const acceptedAccessCodePrefixes = () =>
  [ACCESS_CODE_PREFIX, ...LEGACY_ACCESS_CODE_PREFIXES].filter(Boolean)

// Full-code validator, e.g. /^(MAPA|CRMC)-\d{4}-\d{5}$/
const accessCodeRe = () =>
  new RegExp(`^(${acceptedAccessCodePrefixes().join('|')})-\\d{4}-\\d{5}$`)

const accessCodeFormatHint = () => `${ACCESS_CODE_PREFIX}-YYYY-NNNNN`

module.exports = {
  ACCESS_CODE_PREFIX,
  LEGACY_ACCESS_CODE_PREFIXES,
  acceptedAccessCodePrefixes,
  accessCodeRe,
  accessCodeFormatHint,
}
