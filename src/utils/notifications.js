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
// `sms: true` opts a call into the paid SMS channel (high-value, time-critical
// messages only). `smsText` is the minimal SMS body (falls back to `title`) —
// keep it free of financial/medical detail (RA-10173). Both are pulled out of
// the params so they aren't written onto the in-app notification doc.
export const notify = async (uid, { type, title, body, sms, smsText, ...extra } = {}) => {
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

  // 2. Secondary channels — email (always, if on file) + SMS (opt-in). Both
  //    go through Vercel /api/* relays that verify a Firebase ID token, and
  //    both are best-effort: a failure here never touches the in-app write
  //    above. Wrapped so a network blip / misconfig can't break the caller.
  try {
    if (!uid) return result
    // R10: /api/* isn't served by the Vite dev server, so skip in dev to
    // avoid noisy 404s. Production (Vercel) and any host serving /api/ work.
    const isViteDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true
    if (isViteDev) return result

    const userSnap = await getDoc(doc(db, 'users', uid))
    const udata    = userSnap.exists() ? userSnap.data() : null
    // Both relays require a valid Firebase ID token; without a signed-in user
    // we can't authenticate either send (the in-app notification landed already).
    const token = auth.currentUser
      ? await auth.currentUser.getIdToken().catch(() => null)
      : null
    if (!token) return result

    // ── Email (if the user has one on file) ──
    const email = udata?.email
    if (email) {
      const plain = `${body ?? ''}\n\n— MAPA · Cotabato Regional Medical Center`
      const html = [
        '<div style="font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111827;">',
        `<h2 style="margin:0 0 12px;color:#111827;font-size:18px;">${escapeHtml(title ?? '')}</h2>`,
        `<p style="margin:0 0 16px;color:#374151;line-height:1.5;font-size:14px;">${escapeHtml(body ?? '').replace(/\n/g, '<br>')}</p>`,
        '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px;">',
        '<p style="margin:0;color:#9ca3af;font-size:12px;">MAPA · Cotabato Regional Medical Center · Sinsuat Avenue, Cotabato City</p>',
        '</div>',
      ].join('')
      // Fire-and-forget so a slow SMTP server doesn't drag down the UX.
      fetch('/api/send-email', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ to: email, subject: title || 'MAPA notification', text: plain, html }),
      }).catch(err => console.warn('[notify] email POST failed:', err?.message))
    }

    // ── SMS (opt-in via sms:true; paid, so high-value messages only) ──
    // Minimal content — smsText, else the title — never the full body, so no
    // financial/medical detail rides an SMS (RA-10173). Needs a phone on file.
    if (sms === true && udata?.contact) {
      fetch('/api/send-sms', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ to: udata.contact, message: (smsText || title || '').slice(0, 300) }),
      }).catch(err => console.warn('[notify] sms POST failed:', err?.message))
    }
  } catch (chErr) {
    console.warn('[notify] secondary-channel setup failed:', chErr?.code, chErr?.message)
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