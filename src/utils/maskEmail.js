// The network contact address (VITE_ORG_CONTACT_EMAIL) is shown MASKED on
// every page (owner request 2026-11-25): the deployment's contact is a
// personal account. Masking is by value, so a hospital whose own contact
// email is that same address is masked too; every other address (hospitals'
// office emails, which patients need) shows in full. The address is never
// written into this repo — it comes from the environment.
//
// Note: the env value is still part of the built site's JavaScript. This hides
// it from the page (and from scrapers reading page text and links), not from
// someone reading the code. A role address (e.g. a MAPA network inbox) in
// Vercel is the real fix; set VITE_ORG_CONTACT_EMAIL to it and nothing needs
// masking — then set VITE_MASK_CONTACT_EMAIL=false.
const env = typeof import.meta !== 'undefined' ? (import.meta.env ?? {}) : {}
const MASK_ON = String(env.VITE_MASK_CONTACT_EMAIL ?? 'true').toLowerCase() !== 'false'
const NETWORK_CONTACT = String(env.VITE_ORG_CONTACT_EMAIL ?? '').trim().toLowerCase()

// "juan.dela.cruz@gmail.com" -> "j••••••••••••z@gmail.com" (at least 3 dots).
export function maskEmail(email) {
  const s = String(email ?? '')
  const at = s.lastIndexOf('@')
  if (at < 1) return s
  const local = s.slice(0, at)
  const hidden = '•'.repeat(Math.max(3, local.length - 2))
  return local.length <= 2 ? `${local[0]}${hidden}${s.slice(at)}` : `${local[0]}${hidden}${local[local.length - 1]}${s.slice(at)}`
}

// Whether this address is the one to keep off the page.
export function isMaskedEmail(email, network = NETWORK_CONTACT, on = MASK_ON) {
  return on && !!network && String(email ?? '').trim().toLowerCase() === network
}

// The text to show for an address.
export function displayEmail(email, network = NETWORK_CONTACT, on = MASK_ON) {
  return isMaskedEmail(email, network, on) ? maskEmail(email) : (email ?? '')
}
