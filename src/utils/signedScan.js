// Helpers for signed scans stored as base64 data URLs in Firestore
// (Guarantee Letters, Certificates of Eligibility).

// Open a stored scan in a new tab. Browsers block navigating to data: URLs,
// so turn it into a blob URL first.
export function openSignedScan(signed) {
  const dataUrl = signed?.downloadUrl ?? signed?.base64
  if (!dataUrl) return false
  if (!dataUrl.startsWith('data:')) { window.open(dataUrl, '_blank', 'noopener'); return true }
  const [head, body] = dataUrl.split(',')
  const type = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream'
  const bytes = Uint8Array.from(atob(body), c => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const win = window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return !!win
}

// SHA-256 of a string, as hex (the uploaded scan's fingerprint).
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}
