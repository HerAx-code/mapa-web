const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

/**
 * onRequestWritten — server-side staff notifications for request lifecycle
 * events that the PATIENT used to fire client-side.
 *
 * WHY (abuse hardening #1): the notifications.create rule now forbids a patient
 * from writing into other users' feeds (the spam / phishing primitive). Three
 * legitimate patient-triggered staff pings therefore move server-side; this
 * trigger owns two of them (the third — "patient proceeded" → agency — is in
 * onSliceProceeded):
 *   - NEW REQUEST (create)                → notify CRMC admins.
 *   - WITHDRAWAL (patient closes it)      → notify CRMC admins so it leaves
 *                                           their action queue.
 * Admin SDK, rules-bypassing. In-app only (the old client path also emailed via
 * /api/send-email; dropped — admins triage the queue in-app).
 *
 * Testable-handler pattern (verifyAccessCode / syncRequestFinancials).
 */

const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH')}`

async function notifyAdmins({ db, serverTimestamp, type, title, body }) {
  const snap = await db.collection('users')
    .where('role', 'in', ['super_admin', 'staff_admin'])
    .get()
  if (snap.empty) return 0
  await Promise.all(snap.docs.map(d =>
    db.collection('notifications').doc(d.id).collection('items').add({
      type, title, body, read: false, createdAt: serverTimestamp(), fromUid: null,
    }),
  ))
  return snap.size
}

async function handleRequestWritten({ db, before, after, requestId, serverTimestamp }) {
  // New request → tell staff to pick it up.
  if (!before && after) {
    const name = after.patientName || 'A patient'
    const type = after.assistanceType || 'assistance'
    const rid  = after.requestId || requestId
    const n = await notifyAdmins({ db, serverTimestamp,
      type: 'app_submitted', title: 'New assistance request',
      body: `${name} submitted a ${type} request — total bill ${peso(after.totalBill)}. ID: ${rid}.` })
    return { event: 'created', notified: n, requestId }
  }

  // Patient withdrawal → remove it from the staff action queue. Distinguished by
  // the applicant closeReason the withdraw path writes; an admin/agency close
  // won't carry it, so this fires only for patient-initiated withdrawals.
  if (before && after &&
      before.status !== 'closed' && after.status === 'closed' &&
      typeof after.closeReason === 'string' && after.closeReason.toLowerCase().includes('withdraw')) {
    const name = after.patientName || 'A patient'
    const type = after.assistanceType || 'assistance'
    const rid  = after.requestId || requestId
    const n = await notifyAdmins({ db, serverTimestamp,
      type: 'app_withdrawn', title: 'Request withdrawn',
      body: `${name} withdrew their ${type} request (${rid}).` })
    return { event: 'withdrawn', notified: n, requestId }
  }

  return { skipped: 'no-notify-event', requestId }
}

exports.handleRequestWritten = handleRequestWritten

exports.onRequestWritten = onDocumentWritten({
  document: 'requests/{requestId}',
  region: 'asia-southeast1',
  timeoutSeconds: 60,
  memory: '256MiB',
}, async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const after  = event.data?.after?.exists  ? event.data.after.data()  : null
  try {
    const result = await handleRequestWritten({
      db: admin.firestore(), before, after,
      requestId: event.params?.requestId,
      serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    })
    if (result.notified) logger.info('[onRequestWritten] notified staff', result)
    return result
  } catch (err) {
    logger.error('[onRequestWritten] failed', { requestId: event.params?.requestId, err: err.message })
    return { failed: err.message }
  }
})
