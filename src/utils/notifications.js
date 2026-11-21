import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from '../firebase'

// #10 — Notification failures should never break a user-facing action
// (an app submission, a status change, a doc upload). We catch the write
// failure and record it to a top-level `notificationErrors` collection so
// staff_admin can monitor delivery health. The function never rejects.
//
// Callers may still wrap with `.catch(() => {})` for clarity; that's a
// safe no-op now because this function always resolves.
//
// Email (Phase 1, T1 — 2026-11-21): notify() writes the in-app notification
// ONLY. The sendNotificationEmail Cloud Function emails each new notification
// on the server, after checking that the sender may reach the recipient and
// is under their hourly limit (functions/src/emailScope.js). The browser no
// longer sends email or SMS: the old /api/send-email and /api/send-sms
// endpoints mailed any address with any content (gap I5) and are removed.
// Notifications written by other Cloud Functions are emailed the same way.
export const notify = async (uid, { type, title, body, ...extra } = {}) => {
  let result = null
  try {
    result = await addDoc(collection(db, 'notifications', uid, 'items'), {
      type, title, body, read: false, createdAt: serverTimestamp(),
      // Phase 1.4: sender attribution, required by the notifications
      // create rule. Every notification names the account that wrote it,
      // which is also who sendNotificationEmail checks the email scope for.
      fromUid: auth.currentUser?.uid ?? null,
      ...extra,
    })
  } catch (err) {
    // Best-effort error log. If even this write fails (extreme network
    // failure, rules misconfigured) we drop to console — preferable to
    // throwing and breaking the caller's success path.
    try {
      await addDoc(collection(db, 'notificationErrors'), {
        recipientUid:  uid ?? null,
        // Phase 1.4: attribution, required by the notificationErrors
        // create rule so the log can't be used as an anonymous write sink.
        reportedByUid: auth.currentUser?.uid ?? null,
        type:          type ?? null,
        title:         title ?? null,
        body:          body  ?? null,
        // Always a non-empty string — the rule requires size() > 0, and
        // String(undefined) would still be 'undefined' rather than ''.
        error:         String(err?.message ?? err ?? 'unknown error'),
        errorCode:     err?.code ?? null,
        at:            serverTimestamp(),
      })
    } catch (logErr) {
      console.warn('[notify] both delivery and error-log failed:', err, logErr)
    }
  }
  return result
}
