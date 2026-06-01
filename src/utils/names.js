// Name helpers shared between auth flows (Login welcome toast, Register
// validation). Lives here as a pure module so it can be exercised by the
// Vitest suite under tests/utils/.

// Common honorific prefixes (Filipino + general). The greeting helper
// skips these so e.g. "Dr. Roberto Velasco" → "Roberto" rather than the
// previously reported "Welcome back, Dr.!".
export const HONORIFICS = new Set([
  'dr', 'dra', 'mr', 'mrs', 'ms', 'atty', 'engr',
  'hon', 'prof', 'rev', 'sr', 'br', 'fr',
])

// Returns the first non-honorific token from a full name, with trailing
// commas/semicolons stripped so the punctuation doesn't leak into the
// greeting. Falls back to the raw input if every token is an honorific
// or the input is empty.
export function firstGivenName(fullName) {
  const tokens = (fullName || '').split(/\s+/).filter(Boolean)
  for (const tok of tokens) {
    const key = tok.replace(/[.,;]+$/, '').toLowerCase()
    if (!HONORIFICS.has(key)) return tok.replace(/[,;]+$/, '')
  }
  return fullName
}

// Names that look like internal services or staff roles. Patient
// registration rejects these to keep fake "CRMC Admin" / "System
// Diagnostics" / "cascade_*" accounts out of the patient list.
export const RESERVED_NAME_TOKENS = new Set([
  'admin', 'administrator', 'system', 'crmc', 'mapa', 'malasakit',
  'diagnostic', 'diagnostics', 'recovery', 'migration', 'daemon',
  'agency', 'staff', 'super', 'root', 'test', 'nuke', 'cascade',
  'claude', 'gpt', 'bot',
])

// True if any whitespace/punctuation-separated token of the input matches
// a reserved word (case-insensitive, whole-token). "Admiral" and
// "Testarossa" pass; "Admin" and "Maria Admin" don't.
export function hasReservedToken(name) {
  const tokens = (name || '').toLowerCase().split(/[^a-zñ]+/i).filter(Boolean)
  return tokens.some(t => RESERVED_NAME_TOKENS.has(t))
}