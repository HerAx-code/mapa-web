const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const crypto = require('node:crypto')

/**
 * verifyAccessCode — Phase 3.5 server-side rate-limited access-code check.
 *
 * Closes the access-code enumeration vector. The Register page previously
 * read hospitalIds/{code} directly via Firestore client SDK, which was
 * (a) bypassable by opening new tabs and (b) PII-leaking (the `usedBy`
 * field on the parent doc -- fixed structurally in Phase 0.3 but the
 * read path still existed).
 *
 * This function provides the same boolean signal -- "is the code
 * available to claim" -- without exposing any other data, and with
 * TWO server-enforced throttles that any caller must pass:
 *
 *   1. Per-uid throttle: 10 attempts/hour per authenticated uid.
 *      Catches legitimate-account abuse (one patient spamming).
 *
 *   2. Per-IP throttle: 60 attempts/hour per client IP (hashed).
 *      Catches the bot bypass via signInAnonymously() looping: each
 *      new anon sign-in gets a fresh uid (defeating throttle #1), but
 *      the IP stays the same (caught by throttle #2). 60/hour is loose
 *      enough for shared NAT / CRMC compound wifi (a normal patient
 *      attempts ~5 codes max), tight enough that full enumeration of
 *      the 30k 2026 code range would take ~500 hours per IP.
 *
 * Contract:
 *   data:  { code: 'CRMC-YYYY-NNNNN' }
 *   auth:  required (anonymous sign-in is fine; throttle keys are uid
 *          AND a hash of request.rawRequest.ip)
 *   returns: { available: boolean, exists: boolean }
 *
 *   On throttle exceed (either tier): throws HttpsError('resource-exhausted')
 *   On unauth:                         throws HttpsError('unauthenticated')
 *   On bad input:                      throws HttpsError('invalid-argument')
 *
 * Architecture: handleVerifyAccessCode(deps) is the pure handler --
 * dependencies passed in for testability. The onCall wrapper at the
 * bottom unpacks request.auth + request.rawRequest.ip and calls it.
 */

const CODE_RE = /^CRMC-\d{4}-\d{5}$/
const WINDOW_MS = 60 * 60 * 1000  // 1 hour
const MAX_UID_ATTEMPTS = 10
const MAX_IP_ATTEMPTS  = 60

// Hash IPs before storing so the rate-limit doc IDs don't leak the
// actual IPs to anyone with Firestore read access (admins). SHA-256
// truncated to 16 chars is plenty of entropy to avoid collisions
// across the few-thousand-IP scale we'd see at pilot.
function hashIp(ip) {
  return crypto
    .createHash('sha256')
    .update(String(ip ?? 'unknown'))
    .digest('hex')
    .slice(0, 16)
}

async function checkAndBumpThrottle({ db, ref, max, label, now }) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const nowMs = now()
    let count = 0
    let windowStart = nowMs
    if (snap.exists) {
      const data = snap.data()
      const elapsed = nowMs - (data.windowStart ?? 0)
      if (elapsed > WINDOW_MS) {
        count = 0
        windowStart = nowMs
      } else {
        count       = data.count ?? 0
        windowStart = data.windowStart ?? nowMs
      }
    }
    if (count >= max) {
      const minutesLeft = Math.ceil((WINDOW_MS - (nowMs - windowStart)) / 60000)
      throw new HttpsError(
        'resource-exhausted',
        `Too many verification attempts (${label} cap reached). Try again in about ${minutesLeft} minutes.`,
      )
    }
    tx.set(ref, {
      count: count + 1,
      windowStart,
      lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  })
}

async function handleVerifyAccessCode({ uid, code, ip, db, now = () => Date.now(), serverTimestamp }) {
  // 1. Auth gate (anonymous is acceptable, but unauth is not).
  if (!uid) {
    throw new HttpsError(
      'unauthenticated',
      'Sign in (anonymously is fine) before verifying an access code.',
    )
  }

  // 2. Input validation.
  const normalizedCode = String(code ?? '').trim().toUpperCase()
  if (!CODE_RE.test(normalizedCode)) {
    throw new HttpsError(
      'invalid-argument',
      'Code must be in the format CRMC-YYYY-NNNNN.',
    )
  }

  // 3a. Per-uid throttle (10/hour). Defends against one legitimate
  //     account abusing the endpoint.
  await checkAndBumpThrottle({
    db,
    ref: db.doc(`_rateLimit/verifyAccessCode_uid_${uid}`),
    max: MAX_UID_ATTEMPTS,
    label: 'per-account',
    now,
  }).catch(err => {
    if (err instanceof HttpsError) throw err
    logger.error('[verifyAccessCode] uid throttle tx failed', { uid, err: err.message })
    throw new HttpsError('internal', 'Could not check rate limit. Try again.')
  })

  // 3b. Per-IP throttle (60/hour). Defends against the bot bypass
  //     where an attacker calls signInAnonymously() in a loop to
  //     defeat the per-uid limit. IPs are hashed before storage so
  //     the throttle docs don't leak actual IPs.
  const ipHash = hashIp(ip)
  await checkAndBumpThrottle({
    db,
    ref: db.doc(`_rateLimit/verifyAccessCode_ip_${ipHash}`),
    max: MAX_IP_ATTEMPTS,
    label: 'per-network',
    now,
  }).catch(err => {
    if (err instanceof HttpsError) throw err
    logger.error('[verifyAccessCode] ip throttle tx failed', { ipHash, err: err.message })
    throw new HttpsError('internal', 'Could not check rate limit. Try again.')
  })

  // 4. Resolve the code. Server-side reads bypass the parent doc's
  //    public-get exposure; we only return the minimum signal.
  try {
    const codeSnap = await db.doc(`hospitalIds/${normalizedCode}`).get()
    if (!codeSnap.exists) {
      return { available: false, exists: false }
    }
    const status = codeSnap.data().status
    return {
      available: status === 'available',
      exists: true,
    }
  } catch (err) {
    logger.error('[verifyAccessCode] read failed', { uid, code: normalizedCode, err: err.message })
    throw new HttpsError('internal', 'Could not look up the access code. Try again.')
  }
}

exports.handleVerifyAccessCode = handleVerifyAccessCode
exports.hashIp = hashIp  // exported for tests + ops debugging

exports.verifyAccessCode = onCall({
  region: 'asia-southeast1',
  timeoutSeconds: 60,
  memory: '256MiB',
}, async (request) => handleVerifyAccessCode({
  uid:  request.auth?.uid,
  code: request.data?.code,
  // Cloud Functions v2 onCall passes the underlying Express request as
  // rawRequest. ip parses x-forwarded-for and falls back to the
  // connection IP. Behind the Cloud Run gateway this is usually the
  // real client IP, though a determined attacker behind a residential
  // proxy can rotate it. That's fine -- IP-throttling is one layer of
  // defense, not the only one.
  ip:   request.rawRequest?.ip,
  db:   admin.firestore(),
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
}))
