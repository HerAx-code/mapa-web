import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

// #10 — Notification failures should never break a user-facing action
// (an app submission, a status change, a doc upload). We catch the write
// failure and record it to a top-level `notificationErrors` collection so
// staff_admin can monitor delivery health. The function never rejects.
//
// Callers may still wrap with `.catch(() => {})` for clarity; that's a
// safe no-op now because this function always resolves.
export const notify = async (uid, { type, title, body, ...extra } = {}) => {
  try {
    return await addDoc(collection(db, 'notifications', uid, 'items'), {
      type, title, body, read: false, createdAt: serverTimestamp(),
      ...extra,
    })
  } catch (err) {
    // Best-effort error log. If even this write fails (extreme network
    // failure, rules misconfigured) we drop to console — preferable to
    // throwing and breaking the caller's success path.
    try {
      await addDoc(collection(db, 'notificationErrors'), {
        recipientUid: uid ?? null,
        type:         type ?? null,
        title:        title ?? null,
        body:         body  ?? null,
        error:        String(err?.message ?? err),
        errorCode:    err?.code ?? null,
        at:           serverTimestamp(),
      })
    } catch (logErr) {
      console.warn('[notify] both delivery and error-log failed:', err, logErr)
    }
    return null
  }
}