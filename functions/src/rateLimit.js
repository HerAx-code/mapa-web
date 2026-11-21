const { FieldValue } = require('firebase-admin/firestore')

/**
 * Fixed-window counters in `_rateLimit/{key}` (server-only; the rules give
 * clients no access). One shared copy for every function that throttles:
 * verifyAccessCode (per uid / per IP) and sendNotificationEmail (per sender).
 *
 * bumpWindowCounter counts this attempt inside a transaction and reports
 * whether it was within `max` for the current window. It never throws for an
 * over-limit attempt — the caller decides what "refused" means (an HttpsError
 * for a callable, a skipped email for a trigger).
 */
const HOUR_MS = 60 * 60 * 1000

async function bumpWindowCounter({ db, ref, max, now = () => Date.now(), windowMs = HOUR_MS }) {
  let result = { allowed: true, count: 0, minutesLeft: 0 }
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const nowMs = now()
    let count = 0
    let windowStart = nowMs
    if (snap.exists) {
      const data = snap.data()
      const elapsed = nowMs - (data.windowStart ?? 0)
      if (elapsed <= windowMs) {
        count       = data.count ?? 0
        windowStart = data.windowStart ?? nowMs
      }
    }
    if (count >= max) {
      result = { allowed: false, count, minutesLeft: Math.ceil((windowMs - (nowMs - windowStart)) / 60000) }
      return
    }
    tx.set(ref, {
      count: count + 1,
      windowStart,
      lastAttemptAt: FieldValue.serverTimestamp(),
    })
    result = { allowed: true, count: count + 1, minutesLeft: 0 }
  })
  return result
}

module.exports = { bumpWindowCounter, HOUR_MS }
