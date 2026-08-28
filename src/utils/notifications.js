import { collection, addDoc, doc, getDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from '../firebase'

// #10 — Notification failures should never break a user-facing action
// (an app submission, a status change, a doc upload). We catch the write
// failure and record it to a top-level `notificationErrors` collection so
// staff_admin can monitor delivery health. The function never rejects.
//
// Callers may still wrap with `.catch(() => {})` for clarity; that's a
// safe no-op now because this function always resolves.
//
// Email integration: every notify() call also POSTs to the
// /api/send-email Vercel serverless route, which uses a Gmail App
// Password via SMTP. If the user has no email on file, or the POST
// fails, only the in-app notification fires. Email is a secondary
// channel and never affects the primary in-app flow.
export const notify = async (uid, { type, title, body, ...extra } = {}) => {
  // 1. In-app notification — primary surface, must succeed for the user
  //    to see anything when they open the app.
  let result = null
  try {
    result = await addDoc(collection(db, 'notifications', uid, 'items'), {
      type, title, body, read: false, createdAt: serverTimestamp(),
      // Phase 1.4: sender attribution, required by the notifications
      // create rule. Cross-role notification writes stay allowed (a
      // patient's submit notifies every CRMC admin), so the rule cannot
      // check uid() == recipient — instead every notification names the
      // account that wrote it, making a forged one traceable.
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

  // 2. Email — secondary surface, dispatched server-side by the
  //    /api/send-email Vercel route. Skipped if the user has no
  //    email on file. Wrapped in its own try so a network blip or
  //    a misconfigured SMTP env var never affects the in-app
  //    notification, which already succeeded above.
  try {
    if (!uid) return result
    const userSnap = await getDoc(doc(db, 'users', uid))
    const email = userSnap.exists() ? userSnap.data()?.email : null
    if (!email) return result

    const plain = `${body ?? ''}\n\n— MAPA · Cotabato Regional Medical Center`
    const html = [
      '<div style="font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111827;">',
      `<h2 style="margin:0 0 12px;color:#111827;font-size:18px;">${escapeHtml(title ?? '')}</h2>`,
      `<p style="margin:0 0 16px;color:#374151;line-height:1.5;font-size:14px;">${escapeHtml(body ?? '').replace(/\n/g, '<br>')}</p>`,
      '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px;">',
      '<p style="margin:0;color:#9ca3af;font-size:12px;">MAPA · Cotabato Regional Medical Center · Sinsuat Avenue, Cotabato City</p>',
      '</div>',
    ].join('')

    // R10 (2026-06-03): skip the email POST entirely on the Vite dev
    // server. /api/send-email is a Vercel serverless route -- Vite's
    // dev server doesn't serve it, so every notify() call in dev
    // logged a noisy 404 in the console. Production (Vercel) and any
    // host that serves the /api/ surface continue to work normally.
    const isViteDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true
    if (isViteDev) return result

    // The /api/send-email route now requires a valid Firebase ID token
    // (it verifies it server-side). Attach the current user's token; if
    // there's no signed-in user we can't authenticate the send, so skip
    // it — the in-app notification above already delivered.
    const token = auth.currentUser
      ? await auth.currentUser.getIdToken().catch(() => null)
      : null
    if (!token) return result

    // Fire-and-forget POST. We don't await it so a slow SMTP server
    // doesn't drag down the in-app notification UX. The serverless
    // route logs its own errors; we only log network-level failures.
    fetch('/api/send-email', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({
        to:      email,
        subject: title || 'MAPA notification',
        text:    plain,
        html,
      }),
    }).catch(err => console.warn('[notify] email POST failed:', err?.message))
  } catch (mailErr) {
    console.warn('[notify] email setup failed:', mailErr?.code, mailErr?.message)
  }

  return result
}

// Minimal HTML escape for email body. The serverless route does not
// sanitize input; without this, agency-supplied free text in
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