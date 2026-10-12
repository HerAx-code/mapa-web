// On-device screen/photo-recapture heuristic — ADVISORY ONLY, never blocks.
//
// A weak hint to the social worker that a "live" selfie may actually be a photo
// of a screen or a printed photo (a presentation attack). Per the research
// (ISO/IEC 30107-3; passive PAD generalises poorly and real accuracy needs a
// labelled attack dataset + certified vendor testing), this is NOT certified
// liveness — the camera-only capture (no file upload for the selfie) plus the
// social worker's confirmation remain the real control. This only surfaces a
// soft "possible recapture" chip for the worker to look closer.
//
// Two cheap cues, combined:
//   • moiré / banding — recapturing a screen (or a fine print grid) injects a
//     periodic pattern; a 1D DFT of the row/column luma profile concentrates
//     energy at a few frequencies, unlike a natural face.
//   • specular highlights — glossy screens / laminated prints throw large
//     near-saturated bright regions.
//
// Thresholds are PROVISIONAL (unvalidated, like FACE_MATCH_HI before
// calibration) — tune RECAPTURE_HI against a real labelled set before trusting
// the flag. Fails null, never throws into the capture/submit flow.

import { RECAPTURE_HI } from './constants'

const clamp01 = (n) => Math.max(0, Math.min(1, n))

// ── Pure, testable helpers ──────────────────────────────────────────────────

// Periodicity of a 1D profile: peak single-frequency magnitude / total spectral
// energy, over k = kMin..N/2 (kMin skips the low-frequency lighting gradient).
// ~1 for a near-pure sinusoid (strong banding), low for broadband/natural signal.
export function periodicityRatio(profile, kMin = 3) {
  const n = profile?.length ?? 0
  if (n < 2 * kMin + 2) return 0
  const mean = profile.reduce((a, b) => a + b, 0) / n
  const c = profile.map(v => v - mean)
  let total = 0, peak = 0
  const kMax = Math.floor(n / 2)
  for (let k = 1; k <= kMax; k++) {
    let re = 0, im = 0
    const w = (2 * Math.PI * k) / n
    for (let i = 0; i < n; i++) { re += c[i] * Math.cos(w * i); im -= c[i] * Math.sin(w * i) }
    const mag = Math.sqrt(re * re + im * im)
    total += mag
    if (k >= kMin && mag > peak) peak = mag
  }
  return total > 0 ? clamp01(peak / total) : 0
}

// Combine the cues into a 0..1 recapture-suspicion score. Moiré weighted higher
// (more specific to recapture); specular is supporting evidence. 15% clipped
// pixels reads as a full specular signal.
export function computeRecaptureScore({ moireRatio = 0, specularFraction = 0 } = {}) {
  const moire = clamp01(moireRatio)
  const spec = clamp01(specularFraction / 0.15)
  return clamp01(0.7 * moire + 0.3 * spec)
}

export function recaptureVerdict(score) {
  if (score == null || Number.isNaN(score)) return null
  return score >= RECAPTURE_HI
}

// ── Browser wrapper (fails null) ─────────────────────────────────────────────

async function toGrayCanvas(file, maxDim = 256) {
  let bmp = null, img = null
  try {
    if (typeof createImageBitmap === 'function') {
      try { bmp = await createImageBitmap(file) } catch { /* fall through */ }
    }
    if (!bmp) {
      img = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file)
        const i = new Image()
        i.onload = () => { URL.revokeObjectURL(url); resolve(i) }
        i.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
        i.src = url
      })
    }
    const src = bmp || img
    const scale = Math.min(1, maxDim / Math.max(src.width, src.height))
    const w = Math.max(1, Math.round(src.width * scale))
    const h = Math.max(1, Math.round(src.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(src, 0, 0, w, h)
    return canvas
  } finally {
    bmp?.close?.()
  }
}

/**
 * Advisory recapture check on a captured selfie still.
 * Returns { recaptureScore, recaptureSuspected } or a neutral null result.
 */
export async function detectScreenRecapture(file) {
  const NEUTRAL = { recaptureScore: null, recaptureSuspected: null }
  if (!file) return NEUTRAL
  try {
    const canvas = await toGrayCanvas(file)
    if (!canvas) return NEUTRAL
    const { width: w, height: h } = canvas
    const ctx = canvas.getContext('2d')
    const d = ctx.getImageData(0, 0, w, h).data
    const luma = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]

    const rowMeans = new Array(h).fill(0)
    const colMeans = new Array(w).fill(0)
    let clipped = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const L = luma((y * w + x) * 4)
        rowMeans[y] += L; colMeans[x] += L
        if (L > 245) clipped++
      }
    }
    for (let y = 0; y < h; y++) rowMeans[y] /= w
    for (let x = 0; x < w; x++) colMeans[x] /= h

    const moireRatio = Math.max(periodicityRatio(rowMeans), periodicityRatio(colMeans))
    const specularFraction = clipped / (w * h)
    const recaptureScore = computeRecaptureScore({ moireRatio, specularFraction })
    return { recaptureScore, recaptureSuspected: recaptureVerdict(recaptureScore) }
  } catch {
    return NEUTRAL
  }
}
