// On-device ID OCR — advisory only.
//
// Reads the text off an uploaded ID image with tesseract.js (lazy-loaded so
// the ~MB wasm/worker isn't in the main bundle) and does a fuzzy match of the
// patient's expected name against that text. The image never leaves the
// device. This is a *hint* for the CRMC social worker — it never blocks a
// submission, and any failure resolves to a neutral { match: null } result.

const normalize = (s) =>
  (s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

// Does the expected name plausibly appear in the OCR text? Returns
// true / false / null (couldn't tell). Fuzzy: at least half of the name's
// significant tokens (length >= 3) must be present, to tolerate OCR noise,
// middle names, and ordering differences.
export function nameMatches(text, expectedName) {
  const t = normalize(text)
  const tokens = normalize(expectedName).split(' ').filter((w) => w.length >= 3)
  if (!t || tokens.length === 0) return null
  const hits = tokens.filter((w) => t.includes(w)).length
  return hits >= Math.ceil(tokens.length / 2)
}

// True for document-type names that look like an ID (so we only OCR those).
export const isIdType = (name) => /\bid\b|identification/i.test(name || '')

// Runs OCR on an image File. Returns { text, match } where match is the
// fuzzy name-check result. Images only (PDFs are skipped → { match: null }).
export async function runIdOcr(file, expectedName = '') {
  if (!file || !file.type?.startsWith('image/')) return { text: '', match: null }
  try {
    const mod = await import('tesseract.js')
    const recognize = mod.recognize || mod.default?.recognize
    const { data } = await recognize(file, 'eng')
    const text = (data?.text ?? '').trim()
    return { text, match: nameMatches(text, expectedName) }
  } catch {
    return { text: '', match: null }
  }
}