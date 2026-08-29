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
// Authentication (added for production):
//   Every request must carry a valid Firebase ID token minted by THIS
//   project, as `Authorization: Bearer <idToken>`. The token is verified
//   against Google's public keys (signature + issuer + audience + expiry)
//   via `jose` — no service-account secret needed, only the public
//   project id. This closes the open-relay hole: without a valid token an
//   internet caller can no longer send mail as CRMC.
//
//   Required Vercel env var (in addition to the SMTP ones below):
//     FIREBASE_PROJECT_ID — the project id (public, non-secret).
//   If it is unset the route fails closed (401) — email is a secondary
//   channel, so failing closed is safe; the in-app notification still
//   delivers.
//
//   Follow-up: anonymous sign-in is enabled for registration, so an
//   anonymous token currently passes. notify() only ever runs under a
//   real signed-in user, so rejecting `firebase.sign_in_provider ===
//   'anonymous'` is a safe future tightening.

import nodemailer from 'nodemailer'
import { jwtVerify, createRemoteJWKSet } from 'jose'

const MAX_SUBJECT_LEN = 200
const MAX_TEXT_LEN    = 5000
const MAX_HTML_LEN    = 50000

// Firebase ID tokens (RS256) are verified against the Secure Token
// service's rotating public keys. createRemoteJWKSet caches + refreshes
// them across warm invocations, so this is one fetch per key rotation,
// not per request.
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID
const JWKS = createRemoteJWKSet(new URL(
  'https://www.googleapis.com/service_accounts/v1/jwks/securetoken@system.gserviceaccount.com'
))

async function verifyCaller(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '')
  if (!m) return null
  if (!PROJECT_ID) {
    console.error('[send-email] FIREBASE_PROJECT_ID env var is not set — rejecting.')
    return null
  }
  try {
    const { payload } = await jwtVerify(m[1], JWKS, {
      issuer:   `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    })
    // Reject anonymous sessions. Anonymous sign-in exists only for the
    // registration access-code check; every notify() email is sent under a
    // real signed-in user, so an anonymous token here is never legitimate —
    // and refusing it stops anyone from minting a throwaway anonymous token
    // to reach the relay.
    if (payload.firebase?.sign_in_provider === 'anonymous') {
      console.warn('[send-email] rejected anonymous token')
      return null
    }
    return payload
  } catch (err) {
    console.warn('[send-email] token verification failed:', err?.code || err?.message)
    return null
  }
}

export default async function handler(req, res) {
  // CORS — the route is called same-origin from the PWA, so reflect the
  // caller's origin only when it belongs to this deployment. Dropping the
  // previous `*` means a cross-origin browser gets no read permission;
  // the real authorization is the Firebase token below.
  const origin = req.headers.origin
  if (origin && req.headers.host && origin.endsWith(req.headers.host)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Gate: require a valid Firebase ID token from this project.
  const caller = await verifyCaller(req)
  if (!caller) {
    return res.status(401).json({ error: 'Unauthorized' })
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