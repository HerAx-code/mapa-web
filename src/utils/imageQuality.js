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

// Field-tunable thresholds. These are reasoned defaults (no real CRMC ID-photo
// corpus exists yet to calibrate against), so they're overridable per deploy via
// VITE_IDQ_* env vars — CRMC can adjust them against real traffic with a Vercel
// setting + redeploy, no code change. Each is read by its literal name so Vite
// inlines it; a missing/invalid value falls back to the default. See .env.example.
const envNum = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback }

// Fraction of pixels brighter than this counts as "blown out" (glare).
const BRIGHT = 245
// Fraction of pixels darker than this counts as "crushed" (too dark).
const DARK = 20
// Thresholds chosen conservatively so a normal photo never trips them:
// >35% blown-out = strong glare; mean luminance <45 = genuinely dark.
export const GLARE_FRACTION = envNum(import.meta.env?.VITE_IDQ_GLARE_FRACTION, 0.35)
export const DARK_MEAN = envNum(import.meta.env?.VITE_IDQ_DARK_MEAN, 45)

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

// ── Sharpness (ADVISORY — added for guided ID capture, Phase 2) ──────────────
// The original module deliberately omitted blur detection because a hard blur
// gate false-warns on cheap cameras. This is used ONLY as an auto-capture HINT
// in GuidedIdCapture: the manual Capture + Upload paths never require it, so a
// low-end-camera user is never blocked. Threshold is PROVISIONAL + tunable, and
// errs LOW so it only flags an obviously-blurry frame. Pure + unit-tested.

// Mean absolute luma gradient (right + down neighbour). A focused photo has
// strong edges (high gradient); a blurry one is smooth (low gradient).
export function sharpnessStats(data, width) {
  if (!data || !width) return { gradient: 0 }
  const lumAt = (i) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  const h = Math.floor((data.length / 4) / width)
  let sum = 0, n = 0
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = (y * width + x) * 4
      const l = lumAt(i)
      sum += Math.abs(l - lumAt(i + 4)) + Math.abs(l - lumAt(i + width * 4))
      n++
    }
  }
  return { gradient: n ? sum / n : 0 }
}

// Below this mean-gradient the frame reads as blurry. Deliberately low so only an
// obviously out-of-focus frame fails; tune on real device frames before trusting.
export const SHARP_MIN = envNum(import.meta.env?.VITE_IDQ_SHARP_MIN, 5)

export function sharpnessVerdict(stats) {
  if (!stats) return null
  return stats.gradient < SHARP_MIN ? 'blurry' : null
}

// Combined live-frame assessment for guided capture: the three chips shown on
// screen (sharp / bright enough / glare) from one pass over RGBA bytes.
export function assessFrame(data, width) {
  const exp = exposureStats(data)
  const shp = sharpnessStats(data, width)
  return {
    sharp:  shp.gradient >= SHARP_MIN,
    bright: exp.meanLum >= DARK_MEAN,
    glare:  exp.brightFrac > GLARE_FRACTION,
    stats:  { ...exp, ...shp },
  }
}

// ── Combined capture quality (ID hardening) ─────────────────────────────────
// Broadens the advisory check beyond exposure to also catch an out-of-focus or
// too-small ID photo — the three things that most often make an ID unreadable
// for OCR and the CRMC verifier. Still ADVISORY: it drives a "retake?" nudge the
// patient can override, never a hard reject (CLAUDE.md: don't lock out indigent
// patients on poor cameras).

// An ID photo whose long edge is below this reads as too low-resolution to be
// reliably legible. Phone cameras produce >1000px; this only trips a thumbnail
// or a heavily-cropped gallery pick.
export const MIN_LONG_EDGE = envNum(import.meta.env?.VITE_IDQ_MIN_LONG_EDGE, 600)

// Classify combined stats into a single advisory verdict, worst-first:
// 'small' | 'dark' | 'glare' | 'blurry' | null (ok). Resolution is checked first
// because the other stats are unreliable on a tiny image.
export function qualityVerdict({ longEdge, meanLum, brightFrac, gradient } = {}) {
  if (typeof longEdge === 'number' && longEdge < MIN_LONG_EDGE) return 'small'
  if (typeof meanLum === 'number' && meanLum < DARK_MEAN) return 'dark'
  if (typeof brightFrac === 'number' && brightFrac > GLARE_FRACTION) return 'glare'
  if (typeof gradient === 'number' && gradient < SHARP_MIN) return 'blurry'
  return null
}

// Memory-safe decode preferring createImageBitmap (GPU-resident) over new Image()
// so a 12MP phone photo doesn't materialize ~48 MB in JS heap on a low-RAM phone.
async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file) } catch { /* fall through */ }
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const i = new Image()
    i.onload = () => { URL.revokeObjectURL(url); resolve(i) }
    i.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    i.src = url
  })
}

// Assess an image File for capture quality (exposure + sharpness + resolution).
// Stats are measured on a centre crop so a dark border / background around the
// card doesn't skew exposure or sharpness. Returns
// { verdict, longEdge, meanLum, brightFrac, darkFrac, gradient } or null on any
// failure (which, being advisory, simply shows no nudge).
export async function assessImageQuality(file) {
  if (typeof document === 'undefined' || !file?.type?.startsWith('image/')) return null
  try {
    const img = await loadBitmap(file)
    const srcW = img.width || 0, srcH = img.height || 0
    const longEdge = Math.max(srcW, srcH)
    const S = 200
    const scale = Math.min(1, S / Math.max(srcW || S, srcH || S))
    const w = Math.max(1, Math.round((srcW || S) * scale))
    const h = Math.max(1, Math.round((srcH || S) * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0, w, h)
    img.close?.()
    // Centre crop (inset 8%) so the card, not its surroundings, drives the stats.
    const cx = Math.round(w * 0.08), cy = Math.round(h * 0.08)
    const cw = Math.max(1, w - cx * 2), ch = Math.max(1, h - cy * 2)
    const d = ctx.getImageData(cx, cy, cw, ch).data
    const exp = exposureStats(d)
    const shp = sharpnessStats(d, cw)
    const stats = { longEdge, ...exp, ...shp }
    return { verdict: qualityVerdict(stats), ...stats }
  } catch {
    return null
  }
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
