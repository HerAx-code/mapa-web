// Vercel serverless function — Semaphore SMS relay (Philippines).
//
// The SMS analog of api/send-email.js. Same Firebase ID-token gate, then
// dispatches through Semaphore (semaphore.co) so the API key never reaches
// the patient's browser. Called by src/utils/notifications.js notify() when a
// call opts in with `sms: true` — reserved for high-value, time-critical
// messages (interview reminders, approvals, GL ready), since SMS is paid per
// 160-char segment.
//
// Required Vercel env vars (Project Settings → Environment Variables):
//   SEMAPHORE_API_KEY   — your Semaphore API key
//   SEMAPHORE_SENDER    — (optional) a registered sender name; omit to use
//                         Semaphore's default sender
//   FIREBASE_PROJECT_ID — the same public project id api/send-email.js uses
//
// Auth: every request must carry a valid Firebase ID token from THIS project
// (`Authorization: Bearer <idToken>`), verified against Google's public keys
// via `jose`. Anonymous tokens are rejected. Without a valid token the route
// fails closed (401) — SMS is a secondary channel, so failing closed is safe.

import { jwtVerify, createRemoteJWKSet } from 'jose'

const MAX_MESSAGE_LEN = 320  // ~2 SMS segments; a runaway body can't fan out cost

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID
const JWKS = createRemoteJWKSet(new URL(
  'https://www.googleapis.com/service_accounts/v1/jwks/securetoken@system.gserviceaccount.com'
))

async function verifyCaller(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '')
  if (!m) return null
  if (!PROJECT_ID) {
    console.error('[send-sms] FIREBASE_PROJECT_ID env var is not set — rejecting.')
    return null
  }
  try {
    const { payload } = await jwtVerify(m[1], JWKS, {
      issuer:   `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    })
    if (payload.firebase?.sign_in_provider === 'anonymous') {
      console.warn('[send-sms] rejected anonymous token')
      return null
    }
    return payload
  } catch (err) {
    console.warn('[send-sms] token verification failed:', err?.code || err?.message)
    return null
  }
}

// Normalize a PH mobile number to the local 09XXXXXXXXX form Semaphore expects.
// Accepts 09…, +639…, 639…; returns null for anything that isn't a plausible
// PH mobile number so we never spend a credit on a malformed send.
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '')
  if (d.startsWith('63') && d.length >= 12) d = '0' + d.slice(2)
  return (d.length === 11 && d.startsWith('09')) ? d : null
}

export default async function handler(req, res) {
  const origin = req.headers.origin
  if (origin && req.headers.host && origin.endsWith(req.headers.host)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' })

  const caller = await verifyCaller(req)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })

  const { to, message } = req.body ?? {}
  const number = normalizePhone(to)
  if (!number)  return res.status(400).json({ error: 'Invalid or missing PH mobile number' })
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing message' })
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LEN} chars)` })
  }

  const API_KEY = process.env.SEMAPHORE_API_KEY
  if (!API_KEY) {
    console.error('[send-sms] SEMAPHORE_API_KEY env var is not set')
    return res.status(500).json({ error: 'SMS service not configured' })
  }

  try {
    const params = new URLSearchParams({ apikey: API_KEY, number, message })
    if (process.env.SEMAPHORE_SENDER) params.set('sendername', process.env.SEMAPHORE_SENDER)

    const r = await fetch('https://api.semaphore.co/api/v4/messages', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params.toString(),
    })
    const data = await r.json().catch(() => null)
    if (!r.ok) {
      console.error('[send-sms] semaphore error', r.status, data)
      return res.status(502).json({ error: 'SMS gateway error' })
    }
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[send-sms]', err?.message)
    return res.status(500).json({ error: 'Failed to send SMS' })
  }
}
