const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

/**
 * onSliceProceeded — notifies an agency's coordinators when the patient accepts
 * the endorsement (the slice moves endorsed → reviewing).
 *
 * WHY (abuse hardening #1): this ping used to be fired by the patient client on
 * "Proceed", writing into agency users' notification feeds — now forbidden by
 * the notifications.create rule. It moves here (Admin SDK). Only the endorsed →
 * reviewing transition fires it, so it can't be spammed.
 *
 * Coexists with syncRequestFinancials on the same applications/{appId} path
 * (both onDocumentWritten triggers fire independently). Testable-handler pattern.
 */

async function handleSliceProceeded({ db, before, after, serverTimestamp }) {
  if (!(before?.status === 'endorsed' && after?.status === 'reviewing')) {
    return { skipped: 'not-a-proceed' }
  }
  const agencyId = after.agencyId
  if (!agencyId) return { skipped: 'no-agency' }

  const snap = await db.collection('users')
    .where('agencyId', '==', agencyId)
    .where('role', 'in', ['agency', 'agency_admin'])
    .get()
  if (snap.empty) return { skipped: 'no-coordinators', agencyId }

  const name = after.patientName || 'A patient'
  await Promise.all(snap.docs.map(d =>
    db.collection('notifications').doc(d.id).collection('items').add({
      type:      'app_submitted',
      title:     'New endorsed request',
      body:      `${name} accepted the endorsement and submitted their request. Please review.`,
      read:      false,
      createdAt: serverTimestamp(),
      fromUid:   null,
    }),
  ))
  return { notified: snap.size, agencyId }
}

exports.handleSliceProceeded = handleSliceProceeded

exports.onSliceProceeded = onDocumentWritten({
  document: 'applications/{appId}',
  region: 'asia-southeast1',
  timeoutSeconds: 60,
  memory: '256MiB',
}, async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const after  = event.data?.after?.exists  ? event.data.after.data()  : null
  try {
    const result = await handleSliceProceeded({
      db: admin.firestore(), before, after,
      serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    })
    if (result.notified) logger.info('[onSliceProceeded] notified agency', result)
    return result
  } catch (err) {
    logger.error('[onSliceProceeded] failed', { appId: event.params?.appId, err: err.message })
    return { failed: err.message }
  }
})
