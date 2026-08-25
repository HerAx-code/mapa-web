const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

/**
 * deleteAuthUser — deletes one Firebase Auth account on behalf of a
 * super_admin.
 *
 * WHY THIS EXISTS
 *
 * The patient right-to-erasure flow (admin/Patients.handleDeleteAccount,
 * RA 10173 §16(e)) cascades a delete across every Firestore collection,
 * but the Firebase **Auth** account cannot be removed from the browser —
 * the client SDK can only delete the *currently signed-in* user, never
 * another account. So the patient's email stayed registered, and the
 * operator had to remove it by hand in the Firebase Console. That was a
 * documented residual (threat-model, thesis-doc §11.5). On Blaze the
 * Admin SDK closes it: this callable does `auth.deleteUser(targetUid)`.
 *
 * AUTHORIZATION
 *
 * Strict: the CALLER must be a `super_admin` (verified by reading their
 * own users/{uid} profile — the same authority the delete cascade already
 * requires). A super_admin may delete any account EXCEPT their own (a
 * self-delete mid-session is almost certainly a mistake and would strand
 * the session). Nothing else can call this.
 *
 * IDEMPOTENT / SAFE
 *
 * If the target Auth user is already gone (`auth/user-not-found`), that is
 * treated as success — the desired end state (no such account) already
 * holds. This lets the caller re-run a partially-failed erasure.
 *
 * Architecture mirrors verifyAccessCode / syncRequestFinancials: a pure
 * handler (dependency-injected, unit-tested) plus a thin onCall wrapper.
 */

async function handleDeleteAuthUser({ callerUid, targetUid, db, auth }) {
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Sign in required.')
  }
  if (typeof targetUid !== 'string' || targetUid.length === 0) {
    throw new HttpsError('invalid-argument', 'A target uid is required.')
  }
  if (targetUid === callerUid) {
    throw new HttpsError('invalid-argument', 'You cannot delete your own account this way.')
  }

  // Authorize: caller must be super_admin.
  let callerRole
  try {
    const snap = await db.collection('users').doc(callerUid).get()
    callerRole = snap.exists ? snap.data().role : null
  } catch (err) {
    logger.error('[deleteAuthUser] caller lookup failed', { callerUid, err: err.message })
    throw new HttpsError('internal', 'Could not verify your permissions. Try again.')
  }
  if (callerRole !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only a super admin can delete accounts.')
  }

  // Delete the Auth account. Already-gone is a success (idempotent erasure).
  try {
    await auth.deleteUser(targetUid)
    logger.info('[deleteAuthUser] deleted auth account', { callerUid, targetUid })
    return { deleted: true }
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      logger.info('[deleteAuthUser] auth account already absent', { callerUid, targetUid })
      return { deleted: false, reason: 'not-found' }
    }
    logger.error('[deleteAuthUser] delete failed', { callerUid, targetUid, err: err.message })
    throw new HttpsError('internal', 'Could not delete the account. Try again or remove it from the Firebase Console.')
  }
}

exports.handleDeleteAuthUser = handleDeleteAuthUser

exports.deleteAuthUser = onCall({
  region: 'asia-southeast1',
  timeoutSeconds: 60,
  memory: '256MiB',
}, async (request) => handleDeleteAuthUser({
  callerUid: request.auth?.uid,
  targetUid: request.data?.uid,
  db: admin.firestore(),
  auth: admin.auth(),
}))
