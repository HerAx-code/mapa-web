// On-device, advisory exposure check for ID photos.
//
// Indigent patients photograph IDs on low-end phones, often with flash glare on
// a laminated card or in a dark room. A washed-out or too-dark photo is the most
// common reason OCR (and the CRMC verifier) can't read an ID. This gives a
// gentle "retake in better light" nudge BEFORE submit.
//
// Deliberately EXPOSURE only, not sharpness/blur: over/under-exposure is a
// camera-agnostic, deterministic pixel measurement that calibrates safely.
// A blur threshold can't be tuned without a corpus of real ID photos and would
// false-warn on cheap cameras, so it's intentionally omitted. Like the OCR /
// liveness signals this is ADVISORY and fails null — it never blocks submit and
// the social worker always makes the final call (CLAUDE.md).

// Fraction of pixels brighter than this counts as "blown out" (glare).
const BRIGHT = 245
// Fraction of pixels darker than this counts as "crushed" (too dark).
const DARK = 20
// Thresholds chosen conservatively so a normal photo never trips them:
// >35% blown-out = strong glare; mean luminance <45 = genuinely dark.
export const GLARE_FRACTION = 0.35
export const DARK_MEAN = 45

// Pure: given RGBA pixel bytes, return exposure stats. Unit-tested in isolation.
export function exposureStats(data) {
  let sum = 0, bright = 0, dark = 0, n = 0
  for (let i = 0; i < data.length; i += 4) {
    // Rec. 601 luma — cheap and good enough for an exposure heuristic.
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    sum += lum
    if (lum >= BRIGHT) bright++
    if (lum <= DARK) dark++
    n++
  }
  if (n === 0) return { meanLum: 0, brightFrac: 0, darkFrac: 0 }
  return { meanLum: sum / n, brightFrac: bright / n, darkFrac: dark / n }
}

// Classify stats into an advisory verdict. Returns 'glare' | 'dark' | null.
export function exposureVerdict(stats) {
  if (!stats) return null
  if (stats.brightFrac > GLARE_FRACTION) return 'glare'
  if (stats.meanLum < DARK_MEAN) return 'dark'
  return null
}

// Assess an image File on-device. Downscales to a small canvas (exposure is a
// global statistic, so full resolution is wasted work) and returns
// { verdict: 'glare'|'dark'|null, ...stats } or null on any failure.
export function assessExposure(file) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !file?.type?.startsWith('image/')) { resolve(null); return }
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.onload = () => {
      URL.revokeObjectURL(url)
      try {
        const S = 128
        const scale = Math.min(1, S / Math.max(img.width || S, img.height || S))
        const w = Math.max(1, Math.round((img.width || S) * scale))
        const h = Math.max(1, Math.round((img.height || S) * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0, w, h)
        const stats = exposureStats(ctx.getImageData(0, 0, w, h).data)
        resolve({ verdict: exposureVerdict(stats), ...stats })
      } catch { resolve(null) }
    }
    img.src = url
  })
}
