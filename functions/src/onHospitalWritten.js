const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { projectPublicHospital, isPublishedHospital } = require('./generated/shared.cjs')

/**
 * onHospitalWritten — Phase 5 PR 5.2 (decision P5-B, gap R10). The one writer
 * of hospitalsPublic/{id}, the sign-in-free projection the Landing page,
 * Register and the patient marketplace read. Five browser pages used to write
 * it after saving a hospital, so a failure between the two left it stale, and
 * the training hospital was kept out only by a browser helper. Now:
 *   - a hospital write re-projects its listing (only when the projection changed);
 *   - the training hospital is never published (and is removed if it was);
 *   - a deleted hospital's listing is removed.
 * The rules refuse browser writes to hospitalsPublic.
 */

async function handleHospitalWritten({ db, hospitalId, before, after, serverTimestamp = () => FieldValue.serverTimestamp() }) {
  const ref = db.doc(`hospitalsPublic/${hospitalId}`)
  if (!after || !isPublishedHospital(after)) {
    const existing = await ref.get()
    if (existing.exists) await ref.delete()
    return { removed: existing.exists, hospitalId }
  }
  const next = projectPublicHospital(after)
  if (before && isPublishedHospital(before) && JSON.stringify(projectPublicHospital(before)) === JSON.stringify(next)) {
    const existing = await ref.get()
    if (existing.exists) return { skipped: 'unchanged', hospitalId }
  }
  await ref.set({ ...next, updatedAt: serverTimestamp() })
  return { projected: true, hospitalId }
}

exports.handleHospitalWritten = handleHospitalWritten

exports.onHospitalWritten = onDocumentWritten({
  document: 'hospitals/{hospitalId}', region: 'asia-southeast1', timeoutSeconds: 60, memory: '256MiB',
}, async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const after = event.data?.after?.exists ? event.data.after.data() : null
  try {
    return await handleHospitalWritten({ db: getFirestore(), hospitalId: event.params.hospitalId, before, after })
  } catch (err) {
    logger.error('[onHospitalWritten] projection failed', { hospitalId: event.params.hospitalId, err: err.message })
    return { failed: err.message }
  }
})
