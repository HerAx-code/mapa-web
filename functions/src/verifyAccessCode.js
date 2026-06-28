const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

/**
 * verifyAccessCode — Phase 3.5 server-side rate-limited access-code check.
 *
 * Closes the last security review finding ("soft client-side rate limit
 * on access codes"). The Register page previously read hospitalIds/{code}
 * directly via Firestore client SDK, which was both rate-limit-bypassable
 * (just open new tabs) and PII-leaking (the `usedBy` field on the parent
 * doc, fixed structurally in Phase 0.3 but the read path still exists).
 *
 * This function provides the same boolean signal — "is the code
 * available to claim" — without exposing any other data and with a
 * server-enforced per-caller throttle.
 *
 * Contract:
 *   data:  { code: 'CRMC-YYYY-NNNNN' }
 *   auth:  required (anonymous sign-in is fine; throttle keys off
 *          request.auth.uid so each device gets its own quota)
 *   returns: { available: boolean, exists: boolean }
 *     - available: true if the code exists AND status is 'available'
 *     - exists:    true if the code exists at all (helps the UI
 *                  distinguish "wrong code" from "already claimed")
 *
 *   On throttle exceed: throws HttpsError('resource-exhausted', ...)
 *   On unauth:          throws HttpsError('unauthenticated', ...)
 *   On bad input:       throws HttpsError('invalid-argument', ...)
 *
 * Throttle policy:
 *   - 10 verification attempts per uid per hour
 *   - Throttle state in /_rateLimit/verifyAccessCode_{uid} with
 *     { count, windowStart } fields
 *   - Windowed: when (now - windowStart) > 1h, the counter resets
 *
 * Architecture:
 *   - The onCall wrapper at the bottom is what deploys. It pulls auth +
 *     data off the request and calls handleVerifyAccessCode().
 *   - handleVerifyAccessCode(deps) is the pure handler. Takes uid, code,
 *     db, and (optionally) a now-ish clock. Returns the same shape the
 *     callable returns. Throws HttpsError on auth / throttle / input /
 *     internal failures. Pure means it's testable with a mocked db.
 */

const CODE_RE = /^CRMC-\d{4}-\d{5}$/
const WINDOW_MS    = 60 * 60 * 1000  // 1 hour
const MAX_ATTEMPTS = 10

async function handleVerifyAccessCode({ uid, code, db, now = () => Date.now(), serverTimestamp }) {
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

  // 3. Throttle check + bump. One transaction so concurrent calls
  //    can't race past the cap.
  const throttleRef = db.doc(`_rateLimit/verifyAccessCode_${uid}`)
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(throttleRef)
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
      if (count >= MAX_ATTEMPTS) {
        const minutesLeft = Math.ceil((WINDOW_MS - (nowMs - windowStart)) / 60000)
        throw new HttpsError(
          'resource-exhausted',
          `Too many verification attempts. Try again in about ${minutesLeft} minutes.`,
        )
      }
      tx.set(throttleRef, {
        count: count + 1,
        windowStart,
        lastAttemptAt: serverTimestamp(),
      })
    })
  } catch (err) {
    if (err instanceof HttpsError) throw err
    logger.error('[verifyAccessCode] throttle tx failed', { uid, err: err.message })
    throw new HttpsError('internal', 'Could not check rate limit. Try again.')
  }

  // 4. Resolve the code. Server-side reads bypass the parent doc's
  //    public-get exposure, and we only return the minimum signal.
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

exports.verifyAccessCode = onCall({
  // Co-located with Firestore (asia-southeast1) so the get() chain
  // stays in-region; cuts ~50ms off cold-start round-trip vs us-central.
  region: 'asia-southeast1',
  timeoutSeconds: 60,
  memory: '256MiB',
}, async (request) => handleVerifyAccessCode({
  uid:  request.auth?.uid,
  code: request.data?.code,
  db:   admin.firestore(),
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
}))
