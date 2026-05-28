// Generates a strong random temporary password for newly-created staff
// accounts. The account holder is expected to set their own password via the
// reset email, so this only needs to clear Firebase's 6-char minimum and be
// hard to guess. Ambiguous glyphs (0/O, 1/l/I) are excluded so the password
// stays readable if it has to be shared manually.
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%'

export function generateTempPassword(length = 14) {
  const arr = new Uint32Array(length)
  crypto.getRandomValues(arr)
  let out = ''
  for (let i = 0; i < length; i++) out += CHARS[arr[i] % CHARS.length]
  return out
}