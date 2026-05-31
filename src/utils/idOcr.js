// On-device ID OCR — advisory only.
//
// Reads the text off an uploaded ID image with tesseract.js (lazy-loaded so
// the ~MB wasm/worker isn't in the main bundle) and does a fuzzy match of the
// patient's expected name against that text. The image never leaves the
// device. This is a *hint* for the CRMC social worker — it never blocks a
// submission, and any failure resolves to a neutral { match: null } result.
//
// The pipeline:
//   1. Preprocess the image (downscale + grayscale + contrast) so OCR runs
//      faster and reads cleaner text off colored ID backgrounds.
//   2. Recognize with the eng+fil language combo so Filipino names + Tagalog
//      text on government IDs (UMID, PhilHealth, etc.) parse correctly.
//   3. Fuzzy-match the patient's name, Unicode-normalized so 'n with tilde'
//      and other diacritics don't get stripped to spaces.

// ̀-ͯ is the Unicode Combining Diacritical Marks block. NFD
// decomposes accented characters into base + combining mark; we then drop
// the marks. Without this step "Pena with tilde" became "PE A" -- the
// tilde turned into a space, breaking the fuzzy match for any patient
// with an accented or tilde'd name (common in Philippine names: Jose,
// Maria, Pena, Nino, Dona, etc.).
const normalize = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // strip combining marks left behind by NFD
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

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

// Decode an image File to a drawable source, preferring createImageBitmap
// (GPU-resident, much lower JS-heap footprint than new Image() + URL.create-
// ObjectURL). The Image() fallback is kept for older browsers without
// createImageBitmap support.
//
// Why this matters: a 12MP phone photo via the Image() path materializes
// the full decoded bitmap in JS heap (~48 MB just for the pixels). On older
// Android phones with 2-3 GB RAM and other tabs open this can OOM-crash.
// createImageBitmap keeps the decoded image GPU-side until drawImage(), and
// we close() it immediately after to release that memory.
async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file) } catch { /* fall through */ }
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const i = new Image()
    i.onload = () => { URL.revokeObjectURL(url); resolve(i) }
    i.onerror = (err) => { URL.revokeObjectURL(url); reject(err) }
    i.src = url
  })
}

// Preprocess a phone-camera photo to give tesseract its best shot:
//   - Downscale anything larger than 2000px on the long edge. Phones produce
//     12MP+ images; tesseract is slow on them and OCR accuracy plateaus well
//     below that resolution for ID-sized text. 2000px keeps text legible
//     while cutting OCR time roughly in half on big images.
//   - Grayscale + contrast boost. Most Philippine government IDs print dark
//     text on a colored background (PhilHealth pink, Driver's License
//     yellow-green, PhilSys blue). Stripping color and pushing contrast
//     makes the text more separable from the background.
// Returns a Blob if processing succeeded, or the original file as a fallback
// if anything went wrong (canvas unavailable, image load failed, etc.) so
// the caller can still feed something to tesseract.
async function preprocessImage(file) {
  const MAX_DIM = 2000
  const CONTRAST = 1.4 // 1.0 = unchanged; >1 widens dark/light separation
  try {
    const img = await loadImage(file)
    const srcW = img.width, srcH = img.height
    const scale = Math.min(1, MAX_DIM / Math.max(srcW, srcH))
    const w = Math.round(srcW * scale)
    const h = Math.round(srcH * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { img.close?.(); return file }
    ctx.drawImage(img, 0, 0, w, h)
    // Release the decoded bitmap immediately — we have the pixels we need
    // on the canvas now, and on low-RAM devices holding both is wasteful.
    img.close?.()
    const imgData = ctx.getImageData(0, 0, w, h)
    const d = imgData.data
    const intercept = 128 * (1 - CONTRAST)
    for (let i = 0; i < d.length; i += 4) {
      // Luminance-weighted grayscale (Rec. 709)
      const gray = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722
      // Linear contrast around mid-gray (128), clamped to [0, 255]
      const adj = Math.max(0, Math.min(255, gray * CONTRAST + intercept))
      d[i] = d[i + 1] = d[i + 2] = adj
      // alpha (d[i+3]) untouched
    }
    ctx.putImageData(imgData, 0, 0)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    return blob || file
  } catch {
    return file
  }
}

// Runs OCR on an image File. Returns { text, match } where match is the
// fuzzy name-check result. Images only (PDFs are skipped → { match: null }).
export async function runIdOcr(file, expectedName = '') {
  if (!file || !file.type?.startsWith('image/')) return { text: '', match: null }
  try {
    const processed = await preprocessImage(file)
    const mod = await import('tesseract.js')
    const recognize = mod.recognize || mod.default?.recognize
    // 'eng+fil' loads BOTH language packs on first run (~10 MB combined,
    // cached by the browser thereafter). Filipino covers Tagalog text on
    // government IDs and improves name recognition for Filipino-script
    // contexts. English alone misses some characters and word boundaries.
    const { data } = await recognize(processed, 'eng+fil')
    const text = (data?.text ?? '').trim()
    return { text, match: nameMatches(text, expectedName) }
  } catch {
    return { text: '', match: null }
  }
}