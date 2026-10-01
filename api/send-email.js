// Vercel serverless function — Gmail SMTP relay.
//
// Replaces the Firebase 'Trigger Email from Firestore' extension (needs Blaze).
// Uses the Vercel Hobby plan + a Gmail App Password so SMTP credentials never
// reach the browser. Called by src/utils/notifications.js notify().
//
// C2 (open-relay fix): the browser sends only { uid, subject, text } — the
// recipient UID, NOT an address, and NO html. The server:
//   1. verifies the caller's Firebase ID token (rejects anonymous),
//   2. authorizes by role (staff/agency may email any user; a patient only
//      themselves) — see api/_lib/auth.js authorizeSend,
//   3. resolves the recipient's email from users/{uid} using the CALLER's token
//      (so firestore.rules govern the read),
//   4. builds the branded HTML server-side (escaped), then sends.
// This removes the previous ability for any signed-in user to send arbitrary
// HTML to an arbitrary address as "MAPA CRMC".
//
// Required Vercel env vars:
//   SMTP_USER, SMTP_PASS, SMTP_FROM (optional display From),
//   FIREBASE_PROJECT_ID (public project id, used for token verify + REST reads).
// Rate limiting is a follow-up (needs a shared store).

import nodemailer from 'nodemailer'
import { verifyCaller, getUserDoc, authorizeSend, callerUidOf } from './_lib/auth.js'

const MAX_SUBJECT_LEN = 200
const MAX_TEXT_LEN    = 5000

// Minimal HTML escape so recipient-facing free text (rejection reasons,
// awaiting-info messages) can't break out of the surrounding markup.
// Exported for unit testing.
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Build the branded notification HTML from a plain subject + body. All
// interpolated values are escaped. Exported for unit testing.
export function buildEmailHtml(subject, text) {
  return [
    '<div style="font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111827;">',
    `<h2 style="margin:0 0 12px;color:#111827;font-size:18px;">${escapeHtml(subject ?? '')}</h2>`,
    `<p style="margin:0 0 16px;color:#374151;line-height:1.5;font-size:14px;">${escapeHtml(text ?? '').replace(/\n/g, '<br>')}</p>`,
    '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px;">',
    '<p style="margin:0;color:#9ca3af;font-size:12px;">MAPA · Cotabato Regional Medical Center · Sinsuat Avenue, Cotabato City</p>',
    '</div>',
  ].join('')
}

export default async function handler(req, res) {
  // CORS — same-origin only (the real authorization is the token below).
  const origin = req.headers.origin
  if (origin && req.headers.host && origin.endsWith(req.headers.host)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' })

  const verified = await verifyCaller(req)
  if (!verified) return res.status(401).json({ error: 'Unauthorized' })
  const { payload, token } = verified
  const callerUid = callerUidOf(payload)

  const body = req.body ?? {}
  // New contract: the client no longer picks the recipient address or the HTML.
  if ('to' in body || 'html' in body) {
    return res.status(400).json({ error: 'Unsupported field: send { uid, subject, text } only' })
  }
  const { uid, subject, text } = body
  if (!uid || !subject || !text) {
    return res.status(400).json({ error: 'Missing required fields: uid, subject, text' })
  }
  if (typeof subject !== 'string' || subject.length > MAX_SUBJECT_LEN) {
    return res.status(400).json({ error: `Subject too long (max ${MAX_SUBJECT_LEN} chars)` })
  }
  if (typeof text !== 'string' || text.length > MAX_TEXT_LEN) {
    return res.status(400).json({ error: `Text body too long (max ${MAX_TEXT_LEN} chars)` })
  }

  // Authorize by role (pure), then resolve the recipient from Firestore.
  const caller = await getUserDoc(callerUid, token)
  const decision = authorizeSend({ callerUid, caller, targetUid: uid, channel: 'email' })
  if (!decision.ok) return res.status(decision.status).json({ error: 'Forbidden' })

  const recipient = await getUserDoc(uid, token)
  const email = recipient?.email
  // No address on file → nothing to send. Succeed quietly (email is secondary;
  // the in-app notification already landed) so notify()'s fire-and-forget is calm.
  if (!email) return res.status(200).json({ ok: true, skipped: 'no-recipient-email' })

  const SMTP_USER = process.env.SMTP_USER
  const SMTP_PASS = process.env.SMTP_PASS
  const SMTP_FROM = process.env.SMTP_FROM || (SMTP_USER ? `MAPA CRMC <${SMTP_USER}>` : null)
  if (!SMTP_USER || !SMTP_PASS) {
    console.error('[send-email] Missing SMTP_USER or SMTP_PASS env var')
    return res.status(500).json({ error: 'Email service not configured' })
  }

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
    await transporter.sendMail({
      from:    SMTP_FROM,
      to:      email,
      subject,
      text:    `${text}\n\n— MAPA · Cotabato Regional Medical Center`,
      html:    buildEmailHtml(subject, text),
    })
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[send-email]', err?.code, err?.message)
    return res.status(500).json({ error: 'Failed to send email', code: err?.code })
  }
}
