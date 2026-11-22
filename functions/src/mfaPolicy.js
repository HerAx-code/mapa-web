const { HttpsError } = require('firebase-functions/v2/https')

/**
 * Two-factor stage 2 for the callable functions (Phase 5 PR 5.4, decision
 * P5-D). When on, a staff caller must be signed in with a second factor
 * (request.auth.token.firebase.sign_in_second_factor); patients are exempt.
 *
 * OFF until every active staff sign-in is enrolled (scripts/report-staff-mfa.mjs)
 * and not before 2026-12-06. Turning it on is this constant AND
 * enforceStaffMfa() in firestore.rules set to true, then a functions + rules
 * deploy. tests/functions/mfaPolicy.test.js checks the two agree.
 */
const ENFORCE_STAFF_MFA = false
const STAFF_ROLES = ['platform_admin', 'super_admin', 'staff_admin', 'agency_admin', 'agency']

// Refuse a staff caller without a second factor. `enforce` is injectable for
// tests; when off, it returns at once without reading anything.
async function assertStaffMfa(db, auth, enforce = ENFORCE_STAFF_MFA) {
  if (!enforce || !auth?.uid) return
  if (auth.token?.firebase?.sign_in_second_factor) return
  const snap = await db.doc(`users/${auth.uid}`).get()
  if (snap.exists && STAFF_ROLES.includes(snap.data().role)) {
    throw new HttpsError('permission-denied', 'Sign in again with your two-factor code to do this.')
  }
}

module.exports = { ENFORCE_STAFF_MFA, STAFF_ROLES, assertStaffMfa }
