/**
 * resetAgencySlots — daily midnight (Manila) Cloud Function that
 * resets every enabled agency's slots.remaining back to slots.total.
 *
 * STATUS: not currently deployed. The pilot's client-side fallback
 * in agency/Dashboard.jsx fires when an agency user opens the
 * dashboard. When Blaze deployment activates this scheduled function,
 * the client fallback becomes defence-in-depth.
 *
 * Architecture: same testable-handler pattern as verifyAccessCode.
 *   handleResetAgencySlots({ db, today }) is the pure handler;
 *   the onSchedule wrapper at the bottom calls it with the live db
 *   and today's Manila-local date string.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const { getFirestore } = require('firebase-admin/firestore')

async function handleResetAgencySlots({ db, today }) {
  const snap = await db.collection('agencies').where('enabled', '==', true).get()

  const batch = db.batch()
  let resetCount = 0
  let skippedNoTotal = 0
  let skippedAlreadyDone = 0

  for (const docSnap of snap.docs) {
    const data = docSnap.data()
    const total = data?.slots?.total ?? 0
    // Each partner hospital's own daily share refills too (Phase 2 PR 2.2;
    // endorseRequest also refills a share lazily on its first use of the
    // day). A count already reset today is left alone, so endorsements made
    // in the first seconds after midnight are never undone.
    const shareUpdates = {}
    for (const [hid, share] of Object.entries(data?.hospitalSlots ?? {})) {
      if ((Number(share?.total) || 0) > 0 && share?.lastResetDate !== today) {
        shareUpdates[`hospitalSlots.${hid}.remaining`] = Number(share.total) || 0
        shareUpdates[`hospitalSlots.${hid}.lastResetDate`] = today
      }
    }
    const wide = total > 0 && data.lastResetDate !== today
    if (!wide && !Object.keys(shareUpdates).length) {
      if (total <= 0) skippedNoTotal++; else skippedAlreadyDone++
      continue
    }
    batch.update(docSnap.ref, {
      ...(wide ? { 'slots.remaining': total, lastResetDate: today } : {}),
      ...shareUpdates,
    })
    resetCount++
  }

  if (resetCount > 0) {
    await batch.commit()
  }

  return {
    today,
    reset: resetCount,
    skippedNoTotal,
    skippedAlreadyDone,
    totalAgencies: snap.size,
  }
}

exports.handleResetAgencySlots = handleResetAgencySlots

// Pilot is Cotabato-only; anchor reliably to Manila time so the day
// boundary matches what coordinators experience locally. The
// Asia/Manila TZ also handles future DST changes (Philippines doesn't
// observe DST today, but keying off a named zone is the safe long-term
// posture).
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
    const result = await handleResetAgencySlots({ db: getFirestore(), today })
    logger.info('[resetAgencySlots] daily reset complete', result)
  }
)
