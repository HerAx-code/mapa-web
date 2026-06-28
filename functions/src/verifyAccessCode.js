const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

const db = admin.firestore()

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
 *   - Throttle docs are write-side-only; tightening them via TTL
 *     policy is a deploy-time admin task (separate from code)
 *
 * Threat model:
 *   - Bot iterating CRMC-YYYY-00000 → CRMC-YYYY-99999 to find claimable
 *     codes: blocked at 10 attempts/hour. To enumerate the full ~30k
 *     2026 range would take 3000 hours.
 *   - Same actor opens many tabs to bypass: each tab has a fresh uid
 *     only if they explicitly call signInAnonymously per tab. With
 *     persistent auth they share the same uid → throttled together.
 *   - Determined attacker re-signing in to get fresh uids: possible
 *     but slow (each anon sign-in is a network round-trip). Combined
 *     with the structural Phase 0.3 fix (no usedBy on parent doc),
 *     the worst they can learn is "is this code claimed".
 */

const CODE_RE = /^CRMC-\d{4}-\d{5}$/
const WINDOW_MS  = 60 * 60 * 1000  // 1 hour
const MAX_ATTEMPTS = 10

exports.verifyAccessCode = onCall({
  // Co-located with Firestore (asia-southeast1) so the get() chain
  // stays in-region; cuts ~50ms off cold-start round-trip vs us-central.
  region: 'asia-southeast1',
  // 60-second timeout is plenty; the work is two reads + maybe one
  // write. Saves $$ vs the default 540s budget.
  timeoutSeconds: 60,
  // memory: '256MiB' is the minimum onCall offers and is fine for
  // this workload.
  memory: '256MiB',
}, async (request) => {

  // 1. Auth gate (anonymous is acceptable, but unauth is not).
  if (!request.auth?.uid) {
    throw new HttpsError(
      'unauthenticated',
      'Sign in (anonymously is fine) before verifying an access code.',
    )
  }
  const uid = request.auth.uid

  // 2. Input validation.
  const code = String(request.data?.code ?? '').trim().toUpperCase()
  if (!CODE_RE.test(code)) {
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
      const now  = Date.now()
      let count = 0
      let windowStart = now
      if (snap.exists) {
        const data = snap.data()
        const elapsed = now - (data.windowStart ?? 0)
        if (elapsed > WINDOW_MS) {
          // Window expired — start fresh.
          count = 0
          windowStart = now
        } else {
          count       = data.count ?? 0
          windowStart = data.windowStart ?? now
        }
      }
      if (count >= MAX_ATTEMPTS) {
        const minutesLeft = Math.ceil((WINDOW_MS - (now - windowStart)) / 60000)
        throw new HttpsError(
          'resource-exhausted',
          `Too many verification attempts. Try again in about ${minutesLeft} minutes.`,
        )
      }
      tx.set(throttleRef, {
        count: count + 1,
        windowStart,
        lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
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
    const codeSnap = await db.doc(`hospitalIds/${code}`).get()
    if (!codeSnap.exists) {
      return { available: false, exists: false }
    }
    const status = codeSnap.data().status
    return {
      available: status === 'available',
      exists: true,
    }
  } catch (err) {
    logger.error('[verifyAccessCode] read failed', { uid, code, err: err.message })
    throw new HttpsError('internal', 'Could not look up the access code. Try again.')
  }
})
