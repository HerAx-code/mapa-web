const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore')

/**
 * glExpirySweep — hourly sweep that marks past-validity GLs as
 * expired and releases the committed budget back to each agency's
 * allocation. Mirrors the per-agency manual flow in
 * agency/ApplicationDetail.jsx (performExpireGL) so operators and
 * the sweep produce identical end-state docs.
 *
 * Phase 2 PR 2.3: the only automatic expiry. The agency Dashboard's
 * browser sweep was removed (R2); both paths now share expireLetterTx.
 *
 * Query shape:   glStatus == 'issued' AND approvedAt < (now - 30d)
 * Requires composite index: applications(glStatus ASC, approvedAt ASC)
 *
 * Architecture: same testable-handler pattern as verifyAccessCode +
 * resetAgencySlots. The onSchedule wrapper at the bottom builds the
 * cutoff timestamp + dependency bag and calls handleGLExpirySweep().
 */

// Letter validity is the shared definition (src/shared/caseState.js, bundled
// into ./generated/shared.cjs) — no hand-kept mirror. Since 2026-11-16 each
// letter stores its own glExpiresAt (10 days); older ones keep their 30 days.
const { GL_VALIDITY_DAYS, glExpiryMs } = require('./generated/shared.cjs')
const { expireLetterTx } = require('./sliceActions')
const DAY_MS = 86400000

// nowMs (optional): when given, a candidate is expired only once it is past
// its own validity (glExpiryMs); the query cutoff is the shortest window.
async function handleGLExpirySweep({ db, cutoff, serverTimestamp, increment, cutoffMs, nowMs = null }) {
  const snap = await db
    .collection('applications')
    .where('glStatus', '==', 'issued')
    .where('approvedAt', '<', cutoff)
    .get()

  let expiredCount = 0
  let skippedNoAgency = 0
  let skippedRaced = 0
  let failedCount = 0
  let releasedTotal = 0
  let skippedNotDue = 0

  for (const docSnap of snap.docs) {
    const app = docSnap.data()
    if (nowMs != null) {
      const expiry = glExpiryMs(app)
      if (expiry == null || nowMs < expiry) { skippedNotDue++; continue }
    }
    const agencyId = app.agencyId

    try {
      // The same expiry the agency's "Mark expired" runs (sliceActions:
      // expireLetterTx): it re-reads the letter inside the transaction, so a
      // person who settled or expired it first is not released twice (M3),
      // and it recomputes the request's totals.
      const deps = { serverTimestamp, increment }
      const released = await db.runTransaction((tx) => expireLetterTx(tx, db, docSnap.ref, 'system_sweep', deps))
      if (released == null) skippedRaced++
      else {
        if (!agencyId || !released.agencyFound) skippedNoAgency++
        else releasedTotal += released.amount
      }
      expiredCount++
    } catch (err) {
      failedCount++
      logger.error('[glExpirySweep] failed to expire one app', {
        appId: docSnap.id,
        err: err?.message ?? String(err),
      })
    }
  }

  return {
    cutoffISO: cutoffMs ? new Date(cutoffMs).toISOString() : null,
    candidates: snap.size,
    expired: expiredCount,
    releasedTotal,
    skippedRaced,
    skippedNoAgency,
    skippedNotDue,
    failed: failedCount,
  }
}

exports.handleGLExpirySweep = handleGLExpirySweep
exports.GL_VALIDITY_DAYS = GL_VALIDITY_DAYS
exports.glExpiryMs = glExpiryMs

exports.glExpirySweep = onSchedule(
  {
    schedule: 'every 1 hours',
    timeZone: 'Asia/Manila',
    region: 'asia-southeast1',
    retryCount: 3,
  },
  async () => {
    const nowMs = Date.now()
    const cutoffMs = nowMs - GL_VALIDITY_DAYS * DAY_MS
    const cutoff = Timestamp.fromMillis(cutoffMs)
    const result = await handleGLExpirySweep({
      db: getFirestore(),
      cutoff,
      cutoffMs,
      serverTimestamp: () => FieldValue.serverTimestamp(),
      increment: (n) => FieldValue.increment(n),
      nowMs,
    })
    logger.info('[glExpirySweep] hourly sweep complete', result)
  }
)
