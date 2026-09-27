const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

/**
 * onDocumentCountChanged — maintains users/{patientId}.documentCount so the
 * documents.create rule can cap how many documents a patient uploads
 * (abuse hardening #5).
 *
 * WHY: file SIZE is already capped (~650 KB, uploadDocument.js), but nothing
 * capped the NUMBER of documents, and each document's bytes live as base64 in
 * Firestore (documentContents). A hostile client could loop uploads and run up
 * the project's Firestore footprint. Rules can't count a collection, so the
 * count is denormalised here and the rule reads it with a single get().
 *
 * +1 on create, -1 on delete; an update (e.g. replacePatientDocument, which
 * keeps the same doc id) does not change the count. The mirror can drift
 * slightly under the same create-burst race as the one-active guard (#3) —
 * accepted at pilot scale; the CAP is a generous abuse ceiling, not a tight
 * quota. Testable-handler pattern.
 */

async function handleDocumentCountChanged({ db, before, after, FieldValue }) {
  const created = !before && !!after
  const deleted = !!before && !after
  if (!created && !deleted) return { skipped: 'no-count-change' }

  const patientId = (after && after.patientId) || (before && before.patientId)
  if (!patientId) return { skipped: 'no-patient' }

  const delta = created ? 1 : -1
  await db.collection('users').doc(patientId).set(
    { documentCount: FieldValue.increment(delta) },
    { merge: true },
  )
  return { patientId, delta }
}
exports.handleDocumentCountChanged = handleDocumentCountChanged

exports.onDocumentCountChanged = onDocumentWritten({
  document: 'documents/{docId}',
  region: 'asia-southeast1',
  timeoutSeconds: 60,
  memory: '256MiB',
}, async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const after  = event.data?.after?.exists  ? event.data.after.data()  : null
  try {
    const result = await handleDocumentCountChanged({
      db: admin.firestore(), before, after,
      FieldValue: admin.firestore.FieldValue,
    })
    if (result.delta) logger.info('[onDocumentCountChanged]', result)
    return result
  } catch (err) {
    logger.error('[onDocumentCountChanged] failed', { docId: event.params?.docId, err: err.message })
    return { failed: err.message }
  }
})
