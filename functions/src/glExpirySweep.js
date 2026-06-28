const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

/**
 * glExpirySweep — hourly sweep that marks past-validity GLs as
 * expired and releases the committed budget back to each agency's
 * allocation. Mirrors the per-agency manual flow in
 * agency/ApplicationDetail.jsx (performExpireGL) so operators and
 * the sweep produce identical end-state docs.
 *
 * STATUS: not currently deployed. The pilot's client-side fallback
 * in agency/Dashboard.jsx runs on dashboard load. When Blaze
 * deployment activates this scheduled function, the client fallback
 * becomes defence-in-depth.
 *
 * Query shape:   glStatus == 'issued' AND approvedAt < (now - 30d)
 * Requires composite index: applications(glStatus ASC, approvedAt ASC)
 *
 * Architecture: same testable-handler pattern as verifyAccessCode +
 * resetAgencySlots. The onSchedule wrapper at the bottom builds the
 * cutoff timestamp + dependency bag and calls handleGLExpirySweep().
 */

// Mirror of src/utils/constants.js GL_VALIDITY_DAYS. Kept in sync by
// hand because the web bundle and the functions bundle are built
// separately and don't share a module surface; this constant rarely
// changes and a mismatch would only postpone an expiry by at most
// one sweep interval.
const GL_VALIDITY_DAYS = 30

async function handleGLExpirySweep({ db, cutoff, serverTimestamp, increment, cutoffMs }) {
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

  for (const docSnap of snap.docs) {
    const app = docSnap.data()
    const amount = Number(app.approvedAmount) || 0
    const agencyId = app.agencyId

    try {
      await db.runTransaction(async (tx) => {
        // Re-read inside the transaction so a coordinator who clicked
        // "Mark GL Expired" between the query and the transaction does
        // not get their budget release silently doubled.
        const fresh = await tx.get(docSnap.ref)
        if (!fresh.exists)                                { skippedRaced++; return }
        if (fresh.data().glStatus !== 'issued')           { skippedRaced++; return }

        tx.update(docSnap.ref, {
          glStatus:    'expired',
          glExpiredAt: serverTimestamp(),
          glExpiredBy: 'system_sweep',
          updatedAt:   serverTimestamp(),
        })

        if (agencyId && amount > 0) {
          tx.update(db.doc(`agencies/${agencyId}`), {
            'budget.committed': increment(-amount),
          })
          releasedTotal += amount
        } else if (!agencyId) {
          skippedNoAgency++
        }
      })
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
    failed: failedCount,
  }
}

exports.handleGLExpirySweep = handleGLExpirySweep
exports.GL_VALIDITY_DAYS = GL_VALIDITY_DAYS

exports.glExpirySweep = onSchedule(
  {
    schedule: 'every 1 hours',
    timeZone: 'Asia/Manila',
    region: 'asia-southeast1',
    retryCount: 3,
  },
  async () => {
    const cutoffMs = Date.now() - GL_VALIDITY_DAYS * 86400000
    const cutoff = admin.firestore.Timestamp.fromMillis(cutoffMs)
    const result = await handleGLExpirySweep({
      db: admin.firestore(),
      cutoff,
      cutoffMs,
      serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
      increment: (n) => admin.firestore.FieldValue.increment(n),
    })
    logger.info('[glExpirySweep] hourly sweep complete', result)
  }
)
