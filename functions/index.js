/**
 * Cloud Functions for MAPA.
 *
 * Currently one scheduled function: resetAgencySlots.
 *
 * The web client also has a lazy fallback in agency/Dashboard.jsx that
 * fires on the first agency-side dashboard load each day if this scheduler
 * hasn't run. Keep both — the scheduler is the primary mechanism so the
 * reset is independent of agency log-in cadence; the lazy path is the
 * safety net for the day the scheduler is misconfigured / failing.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

admin.initializeApp()
const db = admin.firestore()

// Pilot is Cotabato-only; anchor reliably to Manila time so the day boundary
// matches what coordinators experience locally. The Asia/Manila TZ also
// handles future DST changes (Philippines doesn't observe DST today, but
// keying off a named zone is the safe long-term posture).
exports.resetAgencySlots = onSchedule(
  {
    schedule: '0 0 * * *',
    timeZone: 'Asia/Manila',
    region: 'asia-southeast1',
    retryCount: 3,
  },
  async () => {
    // YYYY-MM-DD in Manila local. en-CA conveniently formats as ISO date.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })

    const snap = await db.collection('agencies').where('enabled', '==', true).get()

    const batch = db.batch()
    let resetCount = 0
    let skippedNoTotal = 0
    let skippedAlreadyDone = 0

    for (const docSnap of snap.docs) {
      const data = docSnap.data()
      const total = data?.slots?.total ?? 0
      if (total <= 0) { skippedNoTotal++; continue }
      // The lazy fallback may have already reset for today (if some agency
      // user logged in at 00:00:05 before the scheduler fired). Skip to
      // avoid undoing endorsements that happened in those seconds.
      if (data.lastResetDate === today) { skippedAlreadyDone++; continue }

      batch.update(docSnap.ref, {
        'slots.remaining': total,
        lastResetDate: today,
      })
      resetCount++
    }

    if (resetCount > 0) {
      await batch.commit()
    }

    logger.info('[resetAgencySlots] daily reset complete', {
      date: today,
      reset: resetCount,
      skippedNoTotal,
      skippedAlreadyDone,
      totalAgencies: snap.size,
    })
  }
)