import { auth } from '../firebase'

// Client helper for the National ID eVerify QR check (PhilSys), proxied through
// api/everify.js so the eVerify credentials never reach the browser.
//
// Given the RAW scanned QR string, asks eVerify to confirm it is a genuine
// PhilSys-issued QR and to report its type (PhilID / ePhilID / PCN / Digital
// ID). This is the AUTHORITATIVE authenticity check — the server-to-server
// counterpart to the on-device signature check in philIdQr.js.
//
// Fail-safe by design: any error, a disabled route, or an unauthenticated
// caller returns null, and the caller simply keeps the on-device result. It
// NEVER throws and NEVER blocks the patient — the social worker makes the final
// call, and the dormant (unconfigured) route is the normal state until CRMC
// provisions eVerify credentials in Vercel.
//
// Returns:
//   { verified: true,  qrType, data }  — eVerify confirmed a genuine PhilSys QR
//   { verified: false }                — route live but QR not recognised
//   null                               — route disabled / offline / error
export async function everifyQrCheck(rawQr) {
  if (!rawQr || typeof rawQr !== 'string') return null
  const token = auth.currentUser
    ? await auth.currentUser.getIdToken().catch(() => null)
    : null
  if (!token) return null
  try {
    const r = await fetch('/api/everify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ value: rawQr }),
    })
    const data = await r.json().catch(() => null)
    if (!r.ok || !data) return null
    if (data.enabled === false) return null      // route dormant → keep on-device result
    if (!data.ok) return { verified: false }
    return { verified: true, qrType: data.qrType ?? null, data: data.data ?? null }
  } catch {
    return null
  }
}
