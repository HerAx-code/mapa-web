const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')

/**
 * purgeDeclinedOnboarding — keeps the For Hospitals privacy notice's promise
 * (src/pages/ForHospitals.jsx): "if the request is declined or withdrawn,
 * [the details] are deleted one year after the last action".
 *
 * Monthly. Deletes each onboardingRequests record in the Declined stage
 * (closedAs 'declined' or 'withdrawn'; legacy status 'declined') whose last
 * action (updatedAt, else statusUpdatedAt, else createdAt) is over a year old,
 * together with its uploaded papers in Storage (onboarding/{id}/). An audit
 * entry records the deletion with the hospital name only — no personal data.
 * A hospital record set up before a late decline is left alone.
 *
 * Testable-handler pattern (glExpirySweep / onSliceProceeded).
 */
const RETENTION_DAYS = 365
const DAY_MS = 86400000

const millis = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : null)
const isDeclined = (r) => (r.stage ?? (r.status === 'declined' ? 'declined' : null)) === 'declined'
const lastActionMs = (r) => millis(r.updatedAt) ?? millis(r.statusUpdatedAt) ?? millis(r.createdAt)

async function handlePurgeDeclinedOnboarding({ db, bucket, nowMs, serverTimestamp }) {
  const cutoff = nowMs - RETENTION_DAYS * DAY_MS
  const snap = await db.collection('onboardingRequests').get()
  let deleted = 0, failed = 0, kept = 0
  for (const d of snap.docs) {
    const r = d.data()
    if (!isDeclined(r)) continue
    const last = lastActionMs(r)
    if (last == null || last > cutoff) { kept++; continue }
    try {
      if (bucket) await bucket.deleteFiles({ prefix: `onboarding/${d.id}/` })
      await d.ref.delete()
      await db.collection('auditLog').add({
        action: 'onboarding_request_purged', actorId: 'system', actorName: 'System (retention)', actorRole: 'system',
        targetType: 'onboardingRequest', targetId: d.id, targetName: String(r.hospitalName ?? '').slice(0, 150),
        details: `${r.closedAs === 'withdrawn' ? 'Withdrawn' : 'Declined'} onboarding request deleted one year after the last action (privacy notice).`,
        createdAt: serverTimestamp(),
      })
      deleted++
    } catch (err) {
      failed++
      logger.error('[purgeDeclinedOnboarding] failed to delete one request', { id: d.id, err: err?.message ?? String(err) })
    }
  }
  return { deleted, keptUnderOneYear: kept, failed }
}

exports.handlePurgeDeclinedOnboarding = handlePurgeDeclinedOnboarding
exports.RETENTION_DAYS = RETENTION_DAYS

exports.purgeDeclinedOnboarding = onSchedule(
  {
    schedule: '0 3 1 * *',          // 03:00 on the 1st of every month
    timeZone: 'Asia/Manila',
    region: 'asia-southeast1',
    retryCount: 2,
  },
  async () => {
    const result = await handlePurgeDeclinedOnboarding({
      db: getFirestore(),
      bucket: getStorage().bucket(),
      nowMs: Date.now(),
      serverTimestamp: () => FieldValue.serverTimestamp(),
    })
    logger.info('[purgeDeclinedOnboarding] monthly run complete', result)
  }
)
