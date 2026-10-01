// Vercel serverless function — Semaphore SMS relay (Philippines).
//
// The SMS analog of api/send-email.js. Called by src/utils/notifications.js
// notify() when a call opts in with `sms: true` (paid per segment → high-value,
// time-critical messages only).
//
// C2 (open-relay fix): the browser sends only { uid, message } — the recipient
// UID, NOT a phone number. The server verifies the caller, allows ONLY staff /
// agency roles (see api/_lib/auth.js authorizeSend), resolves the recipient's
// phone from users/{uid}.contact using the CALLER's token (firestore.rules
// govern the read), normalizes it, then sends. This removes the previous ability
// for any signed-in user to spend SMS credits to any PH number.
//
// Required Vercel env vars:
//   SEMAPHORE_API_KEY, SEMAPHORE_SENDER (optional), FIREBASE_PROJECT_ID.
// Rate limiting is a follow-up (needs a shared store).

import { verifyCaller, getUserDoc, authorizeSend, callerUidOf } from './_lib/auth.js'

const MAX_MESSAGE_LEN = 320  // ~2 SMS segments; a runaway body can't fan out cost

// Normalize a PH mobile number to the local 09XXXXXXXXX form Semaphore expects.
// Accepts 09…, +639…, 639…; returns null for anything implausible so we never
// spend a credit on a malformed send. Exported for unit testing.
export function normalizePhone(raw) {
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

  const verified = await verifyCaller(req)
  if (!verified) return res.status(401).json({ error: 'Unauthorized' })
  const { payload, token } = verified
  const callerUid = callerUidOf(payload)

  const body = req.body ?? {}
  // New contract: the client no longer picks the recipient number.
  if ('to' in body || 'number' in body) {
    return res.status(400).json({ error: 'Unsupported field: send { uid, message } only' })
  }
  const { uid, message } = body
  if (!uid) return res.status(400).json({ error: 'Missing required field: uid' })
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing message' })
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LEN} chars)` })
  }

  // Authorize (staff/agency only), then resolve the recipient's phone.
  const caller = await getUserDoc(callerUid, token)
  const decision = authorizeSend({ callerUid, caller, targetUid: uid, channel: 'sms' })
  if (!decision.ok) return res.status(decision.status).json({ error: 'Forbidden' })

  const recipient = await getUserDoc(uid, token)
  const number = normalizePhone(recipient?.contact)
  // No usable phone on file → nothing to send. Succeed quietly (SMS is secondary).
  if (!number) return res.status(200).json({ ok: true, skipped: 'no-recipient-phone' })

  const API_KEY = process.env.SEMAPHORE_API_KEY
  if (!API_KEY) {
    console.error('[send-sms] SEMAPHORE_API_KEY env var is not set')
    return res.status(500).json({ error: 'SMS service not configured' })
  }

  const trySend = async (useSender) => {
    const params = new URLSearchParams({ apikey: API_KEY, number, message })
    if (useSender && process.env.SEMAPHORE_SENDER) params.set('sendername', process.env.SEMAPHORE_SENDER)
    const r = await fetch('https://api.semaphore.co/api/v4/messages', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params.toString(),
    })
    const data = await r.json().catch(() => null)
    const ok = r.ok && Array.isArray(data) && data.length > 0
    return { ok, status: r.status, data }
  }

  try {
    let resp = await trySend(true)
    // A custom SEMAPHORE_SENDER that isn't approved makes Semaphore reject the
    // send; fall back to the default sender so delivery still succeeds.
    if (!resp.ok && process.env.SEMAPHORE_SENDER) {
      console.warn('[send-sms] custom-sender send failed', resp.status, JSON.stringify(resp.data), '— retrying with default sender')
      resp = await trySend(false)
    }
    if (!resp.ok) {
      console.error('[send-sms] semaphore error', resp.status, JSON.stringify(resp.data))
      return res.status(502).json({ error: 'SMS gateway error' })
    }
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[send-sms]', err?.message)
    return res.status(500).json({ error: 'Failed to send SMS' })
  }
}
