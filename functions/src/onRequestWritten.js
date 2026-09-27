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
 * It ALSO maintains the one-active-request guard (abuse hardening #3): a mirror
 * pointer `users/{patientId}.activeRequestId` that the `requests.create` rule
 * reads so a patient can only ever have one non-terminal request. Rules can't
 * query/aggregate, so the count is denormalised here and the rule does a single
 * get(). Set while the request is active, cleared when it goes terminal /
 * withdrawn / deleted (see syncActiveRequest).
 *
 * Testable-handler pattern (verifyAccessCode / syncRequestFinancials).
 */

const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH')}`

// A request is "active" while it is not in a terminal state. Mirrors the
// client's ACTIVE() in src/pages/patient/RequestAssistance.jsx — keep in sync.
const isActiveStatus = (s) => !!s && !['closed', 'rejected', 'fully_funded'].includes(s)

/**
 * Keep users/{patientId}.activeRequestId in step with this request's state so
 * the requests.create rule can enforce "one active request per patient".
 *
 * - While active → point the guard at this request. Self-healing: a read first
 *   avoids rewriting an already-correct pointer (no churn on ordinary status
 *   advances) but still backfills a pre-existing active request whose pointer
 *   was never set (older data, before this feature shipped).
 * - Terminal / deleted → clear the pointer, but ONLY if it still names THIS
 *   request, so we never clobber a pointer that (through bad legacy data)
 *   happens to name a different active request.
 *
 * Race (accepted, pilot scale): two rapid creates can both read the guard as
 * empty in the rule before this trigger sets it. The client UI guard + the rare
 * cleanup cover it; documented in docs/patient-abuse-hardening-plan.md §3.
 */
async function syncActiveRequest({ db, before, after, requestId, FieldValue }) {
  const patientId = (after && after.patientId) || (before && before.patientId)
  if (!patientId) return { skipped: 'no-patient' }
  const userRef  = db.collection('users').doc(patientId)
  const nowActive = !!after && isActiveStatus(after.status)
  const wasActive = !!before && isActiveStatus(before.status)

  if (nowActive) {
    const snap = await userRef.get()
    if (!snap.exists || snap.data().activeRequestId !== requestId) {
      await userRef.set({ activeRequestId: requestId }, { merge: true })
      return { active: 'set', patientId }
    }
    return { active: 'already-set', patientId }
  }
  if (wasActive) { // active → terminal (or deleted): free the patient to file again
    const snap = await userRef.get()
    if (snap.exists && snap.data().activeRequestId === requestId) {
      await userRef.update({ activeRequestId: FieldValue.delete() })
      return { active: 'cleared', patientId }
    }
    return { active: 'clear-skipped', patientId }
  }
  return { active: 'noop', patientId }
}
exports.syncActiveRequest = syncActiveRequest
exports.isActiveStatus = isActiveStatus

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

async function notifyOnRequestWritten({ db, before, after, requestId, serverTimestamp }) {
  // New request → tell staff to pick it up.
  if (!before && after) {
    const name = after.patientName || 'A patient'
    const type = after.assistanceType || 'assistance'
    const rid  = after.requestId || requestId
    const n = await notifyAdmins({ db, serverTimestamp,
      type: 'app_submitted', title: 'New assistance request',
      body: `${name} submitted a ${type} request — total bill ${peso(after.totalBill)}. ID: ${rid}.` })
    return { event: 'created', notified: n }
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
    return { event: 'withdrawn', notified: n }
  }

  return { skipped: 'no-notify-event' }
}

async function handleRequestWritten({ db, before, after, requestId, serverTimestamp, FieldValue }) {
  // Two independent concerns run on every request write: the staff notification
  // (create/withdraw) and the one-active-request guard mirror. Keep them
  // separate so a failure in one is contained by the wrapper's try/catch and
  // the other still ran.
  const notify     = await notifyOnRequestWritten({ db, before, after, requestId, serverTimestamp })
  const activeSync = await syncActiveRequest({ db, before, after, requestId, FieldValue })
  return { ...notify, activeSync, requestId }
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
      FieldValue: admin.firestore.FieldValue,
    })
    if (result.notified || result.activeSync?.active === 'set' || result.activeSync?.active === 'cleared') {
      logger.info('[onRequestWritten]', result)
    }
    return result
  } catch (err) {
    logger.error('[onRequestWritten] failed', { requestId: event.params?.requestId, err: err.message })
    return { failed: err.message }
  }
})
