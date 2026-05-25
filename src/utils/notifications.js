import { collection, addDoc, doc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

// #10 — Notification failures should never break a user-facing action
// (an app submission, a status change, a doc upload). We catch the write
// failure and record it to a top-level `notificationErrors` collection so
// staff_admin can monitor delivery health. The function never rejects.
//
// Callers may still wrap with `.catch(() => {})` for clarity; that's a
// safe no-op now because this function always resolves.
//
// As of the email integration: notify() also writes a doc to the `mail`
// collection so the Firebase 'Trigger Email from Firestore' extension can
// pick it up and dispatch via SMTP. If the extension isn't installed the
// mail docs simply pile up harmlessly. If the user has no email in their
// profile, the mail-side write is skipped (in-app notification still fires).
export const notify = async (uid, { type, title, body, ...extra } = {}) => {
  // 1. In-app notification — primary surface, must succeed for the user
  //    to see anything when they open the app.
  let result = null
  try {
    result = await addDoc(collection(db, 'notifications', uid, 'items'), {
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
  }

  // 2. Email queue — secondary surface, picked up asynchronously by the
  //    Trigger Email from Firestore extension. Wrapped separately so a
  //    missing email or extension misconfig never affects the in-app
  //    notification flow.
  try {
    if (!uid) return result
    const userSnap = await getDoc(doc(db, 'users', uid))
    const email = userSnap.exists() ? userSnap.data()?.email : null
    if (!email) return result

    // Plain-text rendering. The extension will read message.text +
    // message.html and dispatch via the configured SMTP server. We send
    // both formats so clients that strip HTML (Apple Mail digest mode,
    // some Outlook configs) still get readable content.
    const plain = `${body ?? ''}\n\n— MAPA · Cotabato Regional Medical Center`
    const html = [
      '<div style="font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111827;">',
      `<h2 style="margin:0 0 12px;color:#111827;font-size:18px;">${escapeHtml(title ?? '')}</h2>`,
      `<p style="margin:0 0 16px;color:#374151;line-height:1.5;font-size:14px;">${escapeHtml(body ?? '').replace(/\n/g, '<br>')}</p>`,
      '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px;">',
      '<p style="margin:0;color:#9ca3af;font-size:12px;">MAPA · Cotabato Regional Medical Center · Sinsuat Avenue, Cotabato City</p>',
      '</div>',
    ].join('')

    await addDoc(collection(db, 'mail'), {
      to: email,
      message: { subject: title ?? 'MAPA notification', text: plain, html },
      // Trace fields so admins can audit which notification dispatched
      // which email. Extension ignores extra fields.
      meta: {
        recipientUid: uid,
        type:         type ?? null,
        queuedAt:     serverTimestamp(),
      },
    })
  } catch (mailErr) {
    // Email is best-effort. Log to console for diagnostics but never
    // surface to the caller — in-app notification already succeeded.
    console.warn('[notify] mail queue failed:', mailErr?.code, mailErr?.message)
  }

  return result
}

// Minimal HTML escape for email body. The Trigger Email extension does
// not sanitize input; without this, agency-supplied free text in
// awaitingInfoMessage or rejection reasons could break out of the
// surrounding markup.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}