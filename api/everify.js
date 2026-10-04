// Vercel serverless function — National ID eVerify (PhilSys) relay.
//
// The authoritative counterpart to the on-device PhilID QR check in
// src/utils/philIdQr.js. eVerify is a *server-to-server* API (client secret +
// IP allowlist), so it can never be called from the patient's browser — this
// proxy holds the credentials and forwards a single, minimal call:
//
//   POST /query/qr/check   { value: "<raw QR string>" }
//     -> { data: { pcn | digital_id | ... }, meta: { qr_type } }
//
// That endpoint only *parses and validates* the scanned QR (confirms it is a
// genuine PhilSys-issued code and returns its type) — it needs NO face-liveness
// session, so it fits MAPA's Tier I registration today. Face matching
// (/query/qr, /query) needs their Face Liveness JS SDK and is deliberately not
// wired here; MAPA keeps its own on-device selfie↔ID match for that.
//
// Required Vercel env vars (Project Settings → Environment Variables):
//   EVERIFY_CLIENT_ID      — sandbox or production client_id
//   EVERIFY_CLIENT_SECRET  — matching client_secret
//   EVERIFY_BASE_URL       — (optional) defaults to the sandbox:
//                            https://ws.everify.gov.ph/api/dev
//                            production is https://ws.everify.gov.ph/api
//   FIREBASE_PROJECT_ID    — same public project id the other relays use
//
// Unset EVERIFY_CLIENT_ID/SECRET => the route replies { enabled: false } and the
// client silently keeps the on-device result. So this ships dormant and only
// activates once CRMC drops the eVerify credentials in Vercel.
//
// Auth: every request must carry a valid Firebase ID token from THIS project
// (`Authorization: Bearer <idToken>`), verified against Google's public keys via
// `jose`. Anonymous tokens are rejected — fails closed (401).

import { jwtVerify, createRemoteJWKSet } from 'jose'

const DEFAULT_BASE_URL = 'https://ws.everify.gov.ph/api/dev'
const MAX_VALUE_LEN = 8000  // a PhilID QR payload is a few KB; cap runaway input

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID
// /jwk/ (singular) is the real JWKS endpoint; /jwks/ 404s — see send-sms.js.
const JWKS = createRemoteJWKSet(new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
))

async function verifyCaller(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '')
  if (!m) return null
  if (!PROJECT_ID) {
    console.error('[everify] FIREBASE_PROJECT_ID env var is not set — rejecting.')
    return null
  }
  try {
    const { payload } = await jwtVerify(m[1], JWKS, {
      issuer:   `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    })
    if (payload.firebase?.sign_in_provider === 'anonymous') return null
    return payload
  } catch (err) {
    console.warn('[everify] token verification failed:', err?.code || err?.message)
    return null
  }
}

// eVerify access tokens live 30 min. Cache per warm function instance and
// refresh a minute early so a long-lived instance doesn't call /auth per request.
let tokenCache = { token: null, expMs: 0 }

async function getAccessToken(baseUrl) {
  const now = Date.now()
  if (tokenCache.token && now < tokenCache.expMs - 60_000) return tokenCache.token
  const r = await fetch(`${baseUrl}/auth`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify({
      client_id:     process.env.EVERIFY_CLIENT_ID,
      client_secret: process.env.EVERIFY_CLIENT_SECRET,
    }),
  })
  const data = await r.json().catch(() => null)
  const token = data?.data?.access_token
  if (!r.ok || !token) {
    throw new Error(`eVerify /auth failed (${r.status})`)
  }
  // expires_at is a unix-seconds string; fall back to 25 min if absent.
  const expSec = Number(data?.data?.expires_at)
  tokenCache = {
    token,
    expMs: Number.isFinite(expSec) ? expSec * 1000 : now + 25 * 60_000,
  }
  return token
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

  // Dormant until credentials are provisioned — tell the client so it no-ops
  // and keeps the on-device result instead of showing an error.
  if (!process.env.EVERIFY_CLIENT_ID || !process.env.EVERIFY_CLIENT_SECRET) {
    return res.status(200).json({ enabled: false })
  }

  const caller = await verifyCaller(req)
  if (!caller) return res.status(401).json({ error: 'Unauthorized' })

  const { value } = req.body ?? {}
  if (!value || typeof value !== 'string') {
    return res.status(400).json({ error: 'Missing QR value' })
  }
  if (value.length > MAX_VALUE_LEN) {
    return res.status(400).json({ error: 'QR value too large' })
  }

  const baseUrl = process.env.EVERIFY_BASE_URL || DEFAULT_BASE_URL

  try {
    const token = await getAccessToken(baseUrl)
    const r = await fetch(`${baseUrl}/query/qr/check`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        Accept:          'application/json',
        Authorization:   `Bearer ${token}`,
      },
      body: JSON.stringify({ value }),
    })
    const data = await r.json().catch(() => null)
    if (!r.ok) {
      // A 4xx here usually means "not a valid PhilSys QR" — surface a clean
      // not-verified result, not a 500, so the client can show "unverified".
      console.warn('[everify] qr/check non-OK', r.status, JSON.stringify(data))
      return res.status(200).json({ enabled: true, ok: false, status: r.status })
    }
    return res.status(200).json({
      enabled: true,
      ok:      true,
      qrType:  data?.meta?.qr_type ?? null,
      // Only the parsed identifier type/value eVerify returns — never any extra
      // PII beyond what the card itself encodes.
      data:    data?.data ?? null,
      queryLogId: r.headers.get('Query-Log-Id') ?? null,
    })
  } catch (err) {
    console.error('[everify]', err?.message)
    return res.status(502).json({ error: 'eVerify gateway error' })
  }
}
