// Shared auth + authorization for the Vercel relay routes (send-email, send-sms).
// The leading underscore keeps this out of Vercel's /api route table — it is a
// helper module, not an HTTP endpoint.
//
// C2 (open-relay fix): the browser must NOT choose the recipient address or the
// message body/HTML. It sends only the recipient's UID + subject + plain text;
// the server verifies the caller, authorizes by role, and resolves the recipient
// from Firestore using the CALLER's own ID token — so firestore.rules decide what
// the caller may read. No firebase-admin, no new secret, no new dependency.

import { jwtVerify, createRemoteJWKSet } from 'jose'

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID

// Firebase ID tokens (RS256) verify against the Secure Token service's rotating
// public keys. Path is /jwk/ (singular) — /jwks/ 404s. createRemoteJWKSet caches
// across warm invocations.
const JWKS = createRemoteJWKSet(new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
))

// Verify the caller's Firebase ID token (signature + issuer + audience + expiry)
// and reject anonymous sessions. Returns { payload, token } so the caller can
// reuse the raw token as a Bearer for Firestore REST reads, or null if invalid.
export async function verifyCaller(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '')
  if (!m) return null
  if (!PROJECT_ID) {
    console.error('[api/_lib/auth] FIREBASE_PROJECT_ID env var is not set — rejecting.')
    return null
  }
  try {
    const { payload } = await jwtVerify(m[1], JWKS, {
      issuer:   `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    })
    // Anonymous sign-in exists only for the registration access-code check; a
    // notify()-driven send is always under a real user, so an anonymous token
    // here is never legitimate.
    if (payload.firebase?.sign_in_provider === 'anonymous') {
      console.warn('[api/_lib/auth] rejected anonymous token')
      return null
    }
    return { payload, token: m[1] }
  } catch (err) {
    console.warn('[api/_lib/auth] token verification failed:', err?.code || err?.message)
    return null
  }
}

// Convert one Firestore REST "Value" object into a plain JS value.
// https://firebase.google.com/docs/firestore/reference/rest/v1/Value
function parseValue(v) {
  if (v == null) return null
  if ('stringValue'    in v) return v.stringValue
  if ('booleanValue'   in v) return v.booleanValue
  if ('integerValue'   in v) return Number(v.integerValue)
  if ('doubleValue'    in v) return v.doubleValue
  if ('timestampValue' in v) return v.timestampValue
  if ('nullValue'      in v) return null
  if ('mapValue'       in v) return parseFirestoreFields(v.mapValue?.fields ?? {})
  if ('arrayValue'     in v) return (v.arrayValue?.values ?? []).map(parseValue)
  return null
}

// Convert a Firestore REST document's `fields` map into a plain JS object.
// Exported for unit tests.
export function parseFirestoreFields(fields = {}) {
  const out = {}
  for (const [k, v] of Object.entries(fields)) out[k] = parseValue(v)
  return out
}

// Read users/{uid} via the Firestore REST API with the CALLER's token as Bearer,
// so access is governed by firestore.rules (not a privileged service account).
// Returns the parsed user doc, or null if missing / not readable by the caller.
export async function getUserDoc(uid, token) {
  if (!uid || !token || !PROJECT_ID) return null
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(uid)}`
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return null
    const doc = await r.json()
    return doc?.fields ? parseFirestoreFields(doc.fields) : null
  } catch (err) {
    console.warn('[api/_lib/auth] getUserDoc failed:', err?.message)
    return null
  }
}

const STAFF_OR_AGENCY = ['super_admin', 'staff_admin', 'agency_admin', 'agency']

// Pure authorization decision for a send. No I/O.
//   - no caller profile                         → 403
//   - caller disabled (active === false) / in deletion → 403
//   - channel 'sms'   → staff/agency roles only
//   - channel 'email' → staff/agency: any MAPA user; patient: only themselves
// Returns { ok: true } or { ok: false, status: 403, reason }.
export function authorizeSend({ callerUid, caller, targetUid, channel }) {
  const deny = (reason) => ({ ok: false, status: 403, reason })
  if (!caller) return deny('no caller profile')
  if (caller.active === false || caller.deletion) return deny('caller disabled or deleted')

  const staffOrAgency = STAFF_OR_AGENCY.includes(caller.role)

  if (channel === 'sms') {
    return staffOrAgency ? { ok: true } : deny('sms channel is staff/agency only')
  }
  if (channel === 'email') {
    if (staffOrAgency) return { ok: true }
    if (caller.role === 'patient' && targetUid === callerUid) return { ok: true }
    return deny('patients may only email themselves')
  }
  return deny(`unknown channel: ${channel}`)
}

// The caller's uid from a verified token payload.
export function callerUidOf(payload) {
  return payload?.user_id || payload?.sub || null
}
