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

// Mirror of src/utils/constants.js (glExpiryMs). Kept in sync by hand: the
// web and functions bundles don't share modules. Since 2026-11-16 each GL
// stores its own glExpiresAt (10 days from issuance); older GLs carry none
// and keep the 30 days they were printed with.
const GL_VALIDITY_DAYS = 10
const LEGACY_GL_VALIDITY_DAYS = 30
const DAY_MS = 86400000

function glExpiryMs(app) {
  const stored = app?.glExpiresAt?.toMillis?.()
  if (typeof stored === 'number') return stored
  const issued = app?.approvedAt?.toMillis?.()
  return typeof issued === 'number' ? issued + (LEGACY_GL_VALIDITY_DAYS + 1) * DAY_MS : null
}

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
