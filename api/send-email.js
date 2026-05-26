// Vercel serverless function — Gmail SMTP relay.
//
// Replaces the Firebase 'Trigger Email from Firestore' extension path,
// which requires the Firebase Blaze plan. This route uses the Vercel
// Hobby plan (free) plus a Gmail App Password to dispatch
// notification emails server-side, so SMTP credentials never reach
// the patient's browser.
//
// Called by src/utils/notifications.js — every notify() call also
// POSTs here with the recipient + subject + body. Failures are logged
// to the console but never propagate back; the in-app notification
// (written to Firestore) remains the primary surface.
//
// Required Vercel env vars (Project Settings → Environment Variables):
//   SMTP_USER  — the Gmail address you generated the App Password for
//   SMTP_PASS  — the 16-character Gmail App Password (no spaces)
//   SMTP_FROM  — display 'From' address, e.g. 'MAPA CRMC <user@gmail.com>'
//
// Security note for thesis pilot:
//   This route accepts unauthenticated POSTs. Volume is gated by
//   Gmail's own SMTP limits (500/day for App Passwords). Before
//   production, add Firebase ID-token verification — the client
//   already has user.uid in scope and can attach the token via the
//   Authorization header.

import nodemailer from 'nodemailer'

const MAX_SUBJECT_LEN = 200
const MAX_TEXT_LEN    = 5000
const MAX_HTML_LEN    = 50000

export default async function handler(req, res) {
  // CORS — Vercel routes share the deployment's origin so same-origin
  // requests from the PWA don't need a preflight; this allow-list
  // covers a desktop tab pointed at the deployed URL.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { to, subject, text, html } = req.body ?? {}

  if (!to || !subject || (!text && !html)) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, text|html' })
  }

  // Basic length guard so a runaway notification body can't push
  // through a 5 MB SMTP envelope.
  if (typeof subject !== 'string' || subject.length > MAX_SUBJECT_LEN) {
    return res.status(400).json({ error: `Subject too long (max ${MAX_SUBJECT_LEN} chars)` })
  }
  if (text && (typeof text !== 'string' || text.length > MAX_TEXT_LEN)) {
    return res.status(400).json({ error: `Text body too long (max ${MAX_TEXT_LEN} chars)` })
  }
  if (html && (typeof html !== 'string' || html.length > MAX_HTML_LEN)) {
    return res.status(400).json({ error: `HTML body too long (max ${MAX_HTML_LEN} chars)` })
  }

  const SMTP_USER = process.env.SMTP_USER
  const SMTP_PASS = process.env.SMTP_PASS
  const SMTP_FROM = process.env.SMTP_FROM || (SMTP_USER ? `MAPA CRMC <${SMTP_USER}>` : null)

  if (!SMTP_USER || !SMTP_PASS) {
    console.error('[send-email] Missing SMTP_USER or SMTP_PASS env var')
    return res.status(500).json({ error: 'Email service not configured' })
  }

  try {
    const transporter = nodemailer.createTransport({
      host:   'smtp.gmail.com',
      port:   465,
      secure: true,
      auth:   { user: SMTP_USER, pass: SMTP_PASS },
    })

    await transporter.sendMail({
      from:    SMTP_FROM,
      to,
      subject,
      text:    text || undefined,
      html:    html || undefined,
    })

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[send-email]', err?.code, err?.message)
    return res.status(500).json({ error: 'Failed to send email', code: err?.code })
  }
}