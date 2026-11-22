const { HttpsError } = require('firebase-functions/v2/https')
const { FieldValue } = require('firebase-admin/firestore')

// Helpers every callable that acts for a signed-in staff member shares
// (accountAdmin, caseActions): load profiles, refuse with a clear message,
// and write the audit entry and in-app notifications on the server.

const fail = (code, msg) => { throw new HttpsError(code, msg) }

async function loadUser(db, uid) {
  const s = await db.doc(`users/${uid}`).get()
  return s.exists ? { uid, ...s.data() } : null
}

async function loadCaller(db, callerUid) {
  if (!callerUid) fail('unauthenticated', 'Sign in required.')
  const caller = await loadUser(db, callerUid)
  if (!caller || caller.active === false) fail('permission-denied', 'Your account cannot do this.')
  return caller
}

// One audit entry, written by the function itself (never forgeable from a
// browser). `entry` overrides the defaults.
async function writeAudit(db, caller, entry) {
  await db.collection('auditLog').add({
    actorId: caller.uid, actorName: caller.name ?? '', actorRole: caller.role ?? '',
    actorAgencyId: caller.agencyId ?? null,
    targetType: 'account', targetName: '', details: '', requestId: null, patientId: null,
    ...(caller.tenantId ? { tenantId: caller.tenantId } : {}),
    ...entry,
    createdAt: FieldValue.serverTimestamp(),
  })
}

// An in-app notification; sendNotificationEmail emails it under the sender's
// scope. `fromUid` null = a server event.
async function notifyServer(db, uid, { type, title, body }, fromUid = null) {
  if (!uid) return
  await db.collection('notifications').doc(uid).collection('items').add({
    type, title: String(title ?? '').slice(0, 200), body: String(body ?? '').slice(0, 2000),
    read: false, fromUid, createdAt: FieldValue.serverTimestamp(),
  })
}

module.exports = { fail, loadUser, loadCaller, writeAudit, notifyServer }
