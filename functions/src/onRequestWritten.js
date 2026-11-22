const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { DEFAULT_HOSPITAL_ID } = require('./orgConfig')

/**
 * onRequestWritten — server-side staff notifications for request lifecycle
 * events that the PATIENT used to fire client-side.
 *
 * WHY (abuse hardening #1): the notifications.create rule now forbids a patient
 * from writing into other users' feeds (the spam / phishing primitive). Three
 * legitimate patient-triggered staff pings therefore move server-side; this
 * trigger owns two of them (the third — "patient proceeded" → agency — is in
 * onSliceProceeded):
 *   - NEW REQUEST (create)                → notify the gateway admins.
 *   - WITHDRAWAL (patient closes it)      → notify the gateway admins so it leaves
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

// A request is "active" until it is FINISHED (decision D4, Phase 2): closed,
// rejected, or fully funded with every approved letter settled. The one
// definition lives in src/shared/caseState.js (bundled into
// ./generated/shared.cjs) and is the same one the patient's pages use.
const { isRequestActive } = require('./generated/shared.cjs')
const isActiveStatus = (s) => isRequestActive({ status: s })

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
  const nowActive = !!after && isRequestActive(after)
  const wasActive = !!before && isRequestActive(before)

  if (nowActive) {
    const snap = await userRef.get()
    const current = snap.exists ? snap.data().activeRequestId : null
    if (current === requestId) return { active: 'already-set', patientId }
    // Never take the pointer from ANOTHER case that is still active (gap I3:
    // an expired letter reopened a finished case and stole the pointer from
    // the patient's newer request, leaving two active requests).
    if (current) {
      const other = await db.collection('requests').doc(current).get()
      if (other.exists && isRequestActive(other.data())) return { active: 'kept-other', patientId }
    }
    await userRef.set({ activeRequestId: requestId }, { merge: true })
    return { active: 'set', patientId }
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

// Multi-hospital Phase 9: only the REQUEST's hospital's gateway staff. This
// used to notify every super/staff admin in the network — another hospital's
// staff got this patient's name, bill and request id. Staff are few, so read
// them and filter here: an untagged (pre-backfill) admin is hospital #1, and
// Firestore can't query for a missing field.
async function notifyAdmins({ db, serverTimestamp, tenantId, type, title, body }) {
  const tenant = tenantId || DEFAULT_HOSPITAL_ID
  const snap = await db.collection('users')
    .where('role', 'in', ['super_admin', 'staff_admin'])
    .get()
  const staff = snap.docs.filter(d => ((d.data() ?? {}).tenantId || DEFAULT_HOSPITAL_ID) === tenant)
  if (!staff.length) return 0
  await Promise.all(staff.map(d =>
    db.collection('notifications').doc(d.id).collection('items').add({
      type, title, body, read: false, createdAt: serverTimestamp(), fromUid: null,
    }),
  ))
  return staff.length
}

async function notifyOnRequestWritten({ db, before, after, requestId, serverTimestamp }) {
  // New request → tell staff to pick it up.
  if (!before && after) {
    const name = after.patientName || 'A patient'
    const type = after.assistanceType || 'assistance'
    const rid  = after.requestId || requestId
    const n = await notifyAdmins({ db, serverTimestamp, tenantId: after.tenantId,
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
    const n = await notifyAdmins({ db, serverTimestamp, tenantId: after.tenantId,
      type: 'app_withdrawn', title: 'Request withdrawn',
      body: `${name} withdrew their ${type} request (${rid}).` })
    return { event: 'withdrawn', notified: n }
  }

  return { skipped: 'no-notify-event' }
}

// Phase 3 PR 3.4 (P3-E / D1): a withdrawal BEFORE any staff action gives the
// access code back to the patient for one new filing; after a review it is used
// up. "Before any staff action" = the request never left `submitted` and no
// attached document has been verified or rejected. Giving it back just clears
// the code's `requestId` (the patient still holds it: `claimableBy`), which only
// the server may do (the rules let a browser set requestId, never clear it).
const STAFF_TOUCHED_DOC = (s) => s === 'verified' || s === 'rejected'
async function returnCodeOnWithdrawal({ db, before, after, requestId, FieldValue }) {
  if (!(before && after &&
        before.status !== 'closed' && after.status === 'closed' &&
        typeof after.closeReason === 'string' && after.closeReason.toLowerCase().includes('withdraw'))) {
    return { codeReturn: 'not-a-withdrawal' }
  }
  if (before.status !== 'submitted') return { codeReturn: 'past-submitted' }
  if ((after.attachedDocuments ?? []).some((a) => STAFF_TOUCHED_DOC(a?.status))) return { codeReturn: 'doc-reviewed' }
  // One code backs one request, so this matches at most one doc.
  const snap = await db.collection('hospitalIds').where('requestId', '==', requestId).get()
  if (snap.empty) return { codeReturn: 'no-code' }
  const codeRef = snap.docs[0].ref
  // A course code keeps backing requests in turn — leave its requestId as the
  // course transaction manages it; an ordinary code is freed for one new filing.
  await codeRef.update({ requestId: FieldValue.delete() })
  return { codeReturn: 'returned', code: snap.docs[0].id }
}
exports.returnCodeOnWithdrawal = returnCodeOnWithdrawal

async function handleRequestWritten({ db, before, after, requestId, serverTimestamp, FieldValue }) {
  // Independent concerns run on every request write: the staff notification
  // (create/withdraw), the one-active-request guard mirror, and the withdrawal
  // code-return. Keep them separate so a failure in one is contained by the
  // wrapper's try/catch and the others still ran.
  const notify     = await notifyOnRequestWritten({ db, before, after, requestId, serverTimestamp })
  const activeSync = await syncActiveRequest({ db, before, after, requestId, FieldValue })
  const codeReturn = await returnCodeOnWithdrawal({ db, before, after, requestId, FieldValue })
  return { ...notify, activeSync, ...codeReturn, requestId }
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
      db: getFirestore(), before, after,
      requestId: event.params?.requestId,
      serverTimestamp: () => FieldValue.serverTimestamp(),
      FieldValue: FieldValue,
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
