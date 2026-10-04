// On-device PhilID / ePhilID QR decode + PSA signature verify.
//
// ADVISORY + flag-gated + fails-null, in the same spirit as idOcr / faceCheck:
// nothing here blocks or auto-rejects; it gives the social worker a stronger
// signal when a patient chooses to scan their National ID. Everything runs on the
// phone — the QR payload never leaves the device. Heavy deps (jsqr, @noble, cbor-x)
// are dynamically imported so they stay out of the patient boot bundle.
//
// PRIVACY (RA 10173): we NEVER store or transmit the raw 16-digit PCN or the
// 12-digit PSN. Only a masked PCN (last 4) + a keyed fingerprint (for advisory
// duplicate detection) are persisted. See maskPcn / pcnFingerprint.
//
// LEGAL / STATUS: verifying PSA-signed National-ID data as a relying party needs
// PSA/NIDAS clearance (see docs/id-verification-research.md §4-5). This path is
// OFF by default (VITE_PHILID_QR_ENABLED) and signature verification returns
// 'unverified' until CRMC vendors PSA's real public key into
// public/philsys-public-keys.json post-clearance. The verify LOGIC is unit-tested
// with a test keypair; the production key is a deploy-time artifact.
//
// Formats (per bettergovph/openverify): v1 PhilID = JSON + Ed25519 signature;
// v3 ePhilID = Base45 → gzip → CBOR, with an embedded holder photo.

export const PHILID_QR_ENABLED = import.meta.env?.VITE_PHILID_QR_ENABLED === 'true'

// ── PCN helpers (pure, no deps) ──────────────────────────────────────────────

const digitsOnly = (s) => String(s ?? '').replace(/\D/g, '')

// A valid PhilSys Card Number is 16 digits. Returns the digits or null.
export function normalizePcn(raw) {
  const d = digitsOnly(raw)
  return d.length === 16 ? d : null
}

// Show only the last 4, grouped like the card. Never persist more than this.
export function maskPcn(raw) {
  const d = digitsOnly(raw)
  if (d.length < 4) return null
  return `•••• •••• •••• ${d.slice(-4)}`
}

// Keyed fingerprint of the PCN for ADVISORY duplicate detection ("this card was
// used by another account"). HMAC-SHA256 with an app key. NOTE: a client-side key
// is not a true secret — this is pseudonymization, not cryptographic secrecy; a
// server-side (Blaze/Function) HMAC is the upgrade. The raw PCN is never stored.
export async function pcnFingerprint(raw) {
  const d = digitsOnly(raw)
  if (d.length !== 16) return null
  try {
    const key = import.meta.env?.VITE_PCN_FINGERPRINT_KEY || 'mapa-pcn-fingerprint-v1'
    const { hmac } = await import('@noble/hashes/hmac.js')
    const { sha256 } = await import('@noble/hashes/sha2.js')
    const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils.js')
    return bytesToHex(hmac(sha256, utf8ToBytes(key), utf8ToBytes(d)))
  } catch { return null }
}

// ── QR decode from a camera frame (ImageData) ────────────────────────────────
export async function decodeQrFromImageData(imageData) {
  if (!imageData) return null
  try {
    const mod = await import('jsqr')
    const jsQR = mod.default || mod
    const res = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' })
    return res?.data ?? null
  } catch { return null }
}

// ── Base45 (RFC 9285) decode — inline, no dep ────────────────────────────────
const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'
export function base45Decode(str) {
  const out = []
  const s = String(str)
  for (let i = 0; i < s.length; i += 3) {
    const chunk = s.slice(i, i + 3)
    let value = 0
    for (let j = 0; j < chunk.length; j++) {
      const idx = B45.indexOf(chunk[j])
      if (idx < 0) throw new Error('bad base45 char')
      value += idx * Math.pow(45, j)
    }
    if (chunk.length === 3) { out.push((value >> 8) & 0xff); out.push(value & 0xff) }
    else if (chunk.length === 2) { out.push(value & 0xff) }
    else throw new Error('bad base45 length')
  }
  return new Uint8Array(out)
}

async function gunzip(bytes) {
  // Native, no dep. Available in modern browsers + Node 18+.
  if (typeof DecompressionStream === 'undefined') throw new Error('no DecompressionStream')
  const ds = new DecompressionStream('gzip')
  const stream = new Response(bytes).body.pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// Verify an Ed25519 signature. Returns true / false, or null if we have no key
// to check against (→ shown to the patient + worker as "unverified").
export async function verifyEd25519(sigBytes, msgBytes, pubKeyHex) {
  if (!pubKeyHex) return null
  try {
    const ed = await import('@noble/ed25519')
    const { hexToBytes } = await import('@noble/hashes/utils.js')
    return await ed.verifyAsync(sigBytes, msgBytes, hexToBytes(pubKeyHex))
  } catch { return null }
}

// Load vendored PSA public key(s). Empty until CRMC drops the real key in
// post-clearance → verification returns 'unverified' (null), never a false pass.
async function psaPublicKeys() {
  try {
    const res = await fetch('/philsys-public-keys.json')
    if (!res.ok) return []
    const json = await res.json()
    return Array.isArray(json?.ed25519) ? json.ed25519 : []
  } catch { return [] }
}

// Parse + verify a scanned QR string into an advisory identity result. Fails-null
// on anything unexpected. Returns:
//   { version, name, dob, pcn, photoDataUrl, signatureValid: true|false|null }
export async function parsePhilId(qrString) {
  if (!qrString || typeof qrString !== 'string') return null
  try {
    const keys = await psaPublicKeys()
    // v1 PhilID: JSON object, Ed25519 signature over the canonical subject.
    if (qrString.trim().startsWith('{')) {
      const obj = JSON.parse(qrString)
      const name = [obj.subject?.lName, obj.subject?.fName, obj.subject?.mName].filter(Boolean).join(', ') || obj.subject?.name || null
      const dob = obj.subject?.DOB || obj.DOB || null
      const pcn = obj.PCN || obj.pcn || null
      let signatureValid = null
      if (obj.signature && keys.length) {
        const { hexToBytes, utf8ToBytes } = await import('@noble/hashes/utils.js')
        const sig = hexToBytes(String(obj.signature))
        const msg = utf8ToBytes(JSON.stringify(obj.subject ?? {}))
        for (const k of keys) {
          if (await verifyEd25519(sig, msg, k)) { signatureValid = true; break }
          signatureValid = false
        }
      }
      return { version: 'v1', name, dob, pcn, photoDataUrl: null, signatureValid }
    }
    // v3 ePhilID: Base45 → gzip → CBOR (with embedded photo).
    const { decode: cborDecode } = await import('cbor-x')
    const cbor = await gunzip(base45Decode(qrString))
    const data = cborDecode(cbor)
    const name = data?.name || [data?.lName, data?.fName, data?.mName].filter(Boolean).join(', ') || null
    const dob = data?.DOB || data?.dob || null
    const pcn = data?.PCN || data?.pcn || null
    let photoDataUrl = null
    const photo = data?.photo || data?.face
    if (photo instanceof Uint8Array) photoDataUrl = `data:image/jpeg;base64,${btoa(String.fromCharCode(...photo))}`
    let signatureValid = null
    if (data?.signature && keys.length) {
      const msg = typeof data.signed === 'object' ? new Uint8Array(0) : new Uint8Array(0) // schema-specific; pending real samples
      for (const k of keys) {
        if (await verifyEd25519(data.signature, msg, k)) { signatureValid = true; break }
        signatureValid = false
      }
    }
    return { version: 'v3', name, dob, pcn, photoDataUrl, signatureValid }
  } catch {
    return null
  }
}
