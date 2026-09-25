// On-device face match + liveness — advisory only.
//
// Mirrors idOcr.js: the face models (@vladmandic/face-api, a maintained
// face-api.js fork) are lazy-loaded so the ~6.6 MB of weights + the tfjs
// runtime stay out of the main bundle, the image never leaves the device, and
// EVERY function fails to a neutral null result — it must never throw into the
// submit flow. This is a *hint* for the CRMC social worker, exactly like the
// OCR name-check: it never blocks a submission, and the worker always makes the
// final call. See docs/id-verification-plan.md.
//
// Two public checks, both fail-null:
//   compareFaces(idFile, selfieFile) -> { faceMatch, faceMatchScore }
//     Detects one face in each image, embeds both to 128-d descriptors, and
//     returns the cosine similarity + an advisory verdict. null when either
//     image has no single clear face, or the models can't run.
//   checkLiveness(selfieFile)        -> { liveness, livenessScore }
//     A passive heuristic on the captured still: exactly one face present,
//     filling a reasonable share of the frame, reasonably sharp. This is NOT a
//     certified presentation-attack check (screen/print spoofing is out of
//     reach without a trained PAD model — that's Phase 1.5); it only nudges the
//     patient toward a usable capture and flags an unclear one for the worker.
//
// Models are served from /public/models (see public/models/). If that ~6.6 MB
// doesn't download on a weak connection, every function returns null and the
// flow proceeds unaided — the advisory contract, never blocking care.

import { FACE_MATCH_HI, LIVENESS_HI } from './constants'

const MODEL_URL = '/models'

// ── Pure, testable helpers ─────────────────────────────────────────────────

const clamp01 = (n) => Math.max(0, Math.min(1, n))

// Cosine similarity of two equal-length numeric vectors (face descriptors are
// Float32Array(128)). Returns a number in [-1, 1], or null on bad/mismatched
// input. Callers clamp to [0, 1] for the stored score — face descriptors of
// real faces sit well inside the positive range; a negative would only mean
// "very dissimilar", which is already the low end of our scale.
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length == null || a.length !== b.length || a.length === 0) return null
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i]
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    dot += x * y; na += x * x; nb += y * y
  }
  if (na === 0 || nb === 0) return null
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// score (cosine, 0..1) -> advisory face-match verdict. No 'fail'/block state:
// anything below HI is 'unclear' ("verify manually"), mirroring ocrMatch===false.
// null score (no face / couldn't run) -> null verdict.
export function faceMatchVerdict(score) {
  if (score == null || Number.isNaN(score)) return null
  return score >= FACE_MATCH_HI ? 'pass' : 'unclear'
}

// score (0..1) -> advisory liveness verdict, same banding as face match.
export function livenessVerdict(score) {
  if (score == null || Number.isNaN(score)) return null
  return score >= LIVENESS_HI ? 'pass' : 'unclear'
}

// Passive liveness score from cheap frame metrics — pure so the banding is
// unit-testable without a browser/model:
//   faceCount     : faces the detector found (null = couldn't run)
//   faceAreaRatio : detected face box area / frame area (0..1) — a real, close
//                   selfie fills a good share of the frame; a photo-of-a-photo
//                   held at arm's length usually fills less.
//   sharpness     : 0..1 focus proxy (variance-of-gradient, normalised).
// Returns null only when it couldn't run; 0 faces or >1 face -> 0 (drops to
// 'unclear', never 'fail'); one face -> weighted size + sharpness.
export function computeLivenessScore({ faceCount, faceAreaRatio = 0, sharpness = 0.5 } = {}) {
  if (faceCount == null) return null
  if (faceCount !== 1) return 0
  const sizeF  = clamp01((faceAreaRatio - 0.03) / (0.22 - 0.03)) // 3%..22% -> 0..1
  const sharpF = clamp01(sharpness)
  return clamp01(0.6 * sizeF + 0.4 * sharpF)
}

// ── Lazy model init (mirror of idOcr's shared-worker pattern) ───────────────
// A single in-flight promise loads face-api + the three model nets once and is
// shared by every call. On failure it resets so a later call can retry, rather
// than inheriting a rejected promise forever.
let _faceApiPromise = null
async function getFaceApi() {
  if (_faceApiPromise) return _faceApiPromise
  _faceApiPromise = (async () => {
    const faceapi = await import('@vladmandic/face-api')
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ])
    return faceapi
  })().catch((err) => { _faceApiPromise = null; throw err })
  return _faceApiPromise
}

// Decode a File to a downscaled COLOR canvas (face-api needs color, unlike the
// grayscale OCR preprocess). Prefers createImageBitmap (GPU-resident, low JS
// heap) and closes it immediately, same low-RAM discipline as idOcr.loadImage.
async function toCanvas(file, maxDim = 640) {
  let bmp = null, img = null
  try {
    if (typeof createImageBitmap === 'function') {
      try { bmp = await createImageBitmap(file) } catch { /* fall through */ }
    }
    if (!bmp) {
      img = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file)
        const i = new Image()
        i.onload  = () => { URL.revokeObjectURL(url); resolve(i) }
        i.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
        i.src = url
      })
    }
    const src = bmp || img
    const sw = src.width, sh = src.height
    const scale = Math.min(1, maxDim / Math.max(sw, sh))
    const w = Math.max(1, Math.round(sw * scale))
    const h = Math.max(1, Math.round(sh * scale))
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

// Variance-of-gradient sharpness proxy on a canvas, normalised to ~[0, 1].
// Cheap: samples the luma gradient magnitude. A blurry/low-detail frame yields
// a low value. Browser-only (reads canvas pixels); returns 0.5 (neutral) if it
// can't read them so liveness leans on face size alone.
function estimateSharpness(canvas) {
  try {
    const { width: w, height: h } = canvas
    const ctx = canvas.getContext('2d')
    const d = ctx.getImageData(0, 0, w, h).data
    const luma = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    let sum = 0, sumSq = 0, n = 0
    // step by 2px to keep it light on big canvases
    for (let y = 1; y < h - 1; y += 2) {
      for (let x = 1; x < w - 1; x += 2) {
        const i = (y * w + x) * 4
        const gx = luma(i + 4) - luma(i - 4)
        const gy = luma(i + w * 4) - luma(i - w * 4)
        const g = Math.abs(gx) + Math.abs(gy)
        sum += g; sumSq += g * g; n++
      }
    }
    if (n === 0) return 0.5
    const variance = sumSq / n - (sum / n) ** 2
    // ~600 variance reads as crisp for a downscaled selfie; normalise + clamp.
    return clamp01(variance / 600)
  } catch {
    return 0.5
  }
}

// ── Public API (all fail-null) ──────────────────────────────────────────────

// Compare an ID portrait against a live selfie. Runs on the ORIGINAL in-memory
// Files (full quality, before the 1200px upload recompression). Returns a
// neutral null result if either image lacks a single clear face or the models
// can't run.
export async function compareFaces(idFile, selfieFile) {
  const NEUTRAL = { faceMatch: null, faceMatchScore: null }
  if (!idFile || !selfieFile) return NEUTRAL
  try {
    const faceapi = await getFaceApi()
    const [idCanvas, selfieCanvas] = await Promise.all([toCanvas(idFile), toCanvas(selfieFile)])
    if (!idCanvas || !selfieCanvas) return NEUTRAL
    const opts = new faceapi.TinyFaceDetectorOptions()
    const [idFace, selfieFace] = await Promise.all([
      faceapi.detectSingleFace(idCanvas, opts).withFaceLandmarks().withFaceDescriptor(),
      faceapi.detectSingleFace(selfieCanvas, opts).withFaceLandmarks().withFaceDescriptor(),
    ])
    if (!idFace || !selfieFace) return NEUTRAL
    const raw = cosineSimilarity(idFace.descriptor, selfieFace.descriptor)
    const score = raw == null ? null : clamp01(raw)
    return { faceMatch: faceMatchVerdict(score), faceMatchScore: score }
  } catch {
    return NEUTRAL
  }
}

// Is there a detectable human face in this image? Used for the advisory
// "doesn't look like an ID" nudge on the patient's ID upload — a real
// government ID has a portrait, a chair/receipt/blank does not. Returns
// true / false / null (couldn't run → don't warn). Fails null, never throws.
export async function hasFace(file) {
  if (!file) return null
  try {
    const faceapi = await getFaceApi()
    const canvas = await toCanvas(file)
    if (!canvas) return null
    const res = await faceapi.detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions())
    return !!res
  } catch {
    return null
  }
}

// Passive liveness heuristic on a captured selfie still. Fails null.
export async function checkLiveness(selfieFile) {
  const NEUTRAL = { liveness: null, livenessScore: null }
  if (!selfieFile) return NEUTRAL
  try {
    const faceapi = await getFaceApi()
    const canvas = await toCanvas(selfieFile)
    if (!canvas) return NEUTRAL
    const faces = await faceapi.detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions())
    const frameArea = canvas.width * canvas.height
    let faceAreaRatio = 0
    if (faces.length === 1 && frameArea > 0) {
      const b = faces[0].box
      faceAreaRatio = clamp01((b.width * b.height) / frameArea)
    }
    const score = computeLivenessScore({
      faceCount:     faces.length,
      faceAreaRatio,
      sharpness:     estimateSharpness(canvas),
    })
    return { liveness: livenessVerdict(score), livenessScore: score }
  } catch {
    return NEUTRAL
  }
}
