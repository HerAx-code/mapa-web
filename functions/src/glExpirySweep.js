const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

const db = admin.firestore()

// Mirror of src/utils/constants.js GL_VALIDITY_DAYS. Kept in sync by
// hand because the web bundle and the functions bundle are built
// separately and don't share a module surface; this constant
// rarely changes and a mismatch would only postpone an expiry by
// at most one sweep interval.
const GL_VALIDITY_DAYS = 30

// Hourly sweep that marks past-validity GLs as expired and releases
// the committed budget back to each agency's allocation. Mirrors the
// per-agency manual flow in agency/ApplicationDetail.jsx
// (performExpireGL) so that operators and the sweep produce
// identical end-state docs.
//
// STATUS: not currently deployed. The pilot runs on Spark (free) and
// this code is the v2 target. The same sweep is done by a client-side
// useEffect in agency/Dashboard.jsx that fires on agency-user dashboard
// load: it queries glStatus=='issued', filters by approvedAt < now-30d,
// then writes the same end-state per app. When deployed on Blaze, this
// scheduled function takes over as the primary mechanism and the
// client sweep becomes defence-in-depth.
//
// Query shape:   glStatus == 'issued' AND approvedAt < (now - 30d)
// Requires composite index: applications(glStatus ASC, approvedAt ASC)
// -- added in firestore.indexes.json alongside this code.
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
            glExpiredAt: admin.firestore.FieldValue.serverTimestamp(),
            glExpiredBy: 'system_sweep',
            updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
          })

          if (agencyId && amount > 0) {
            tx.update(db.doc(`agencies/${agencyId}`), {
              'budget.committed': admin.firestore.FieldValue.increment(-amount),
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

    logger.info('[glExpirySweep] hourly sweep complete', {
      cutoffISO: new Date(cutoffMs).toISOString(),
      candidates: snap.size,
      expired: expiredCount,
      releasedTotal,
      skippedRaced,
      skippedNoAgency,
      failed: failedCount,
    })
  }
)
