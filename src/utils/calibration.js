// ── Biometric threshold calibration (pure, testable) ────────────────────────
//
// Turns the advisory face-match / liveness SCORES already logged on selfie
// documents (never biometric templates — see uploadDocument.js) plus the social
// worker's verify/reject verdict (the ground-truth label) into FAR/FRR curves,
// so FACE_MATCH_HI / LIVENESS_HI can be set from measured data instead of a
// provisional guess.
//
// Methodology (grounded in NIST FRTE 1:1 + cross-domain ID↔selfie literature):
//   • FAR (false accept) = impostor comparisons scoring >= threshold.
//   • FRR (false reject)  = genuine comparisons scoring  <  threshold.
//   • Pick the OPERATING POINT from a FAR target on a held-out, domain-matched
//     set, then report FRR there. EER is only for comparing systems, never for
//     setting a production threshold.
//   ⚠ Label caveat: "genuine" = the worker VERIFIED the selfie, "impostor" =
//     they REJECTED it — but a rejection can mean "too blurry", not only
//     "wrong person", so impostor labels are noisy. Treat FAR as a loose upper
//     bound and always sanity-check sample counts before trusting a threshold.
//   ⚠ Population caveat: calibrate on the real patient population (NIST shows
//     higher false-match rates for women / elderly / children); a threshold
//     tuned elsewhere can fail here.

const r4 = (n) => Math.round(n * 10000) / 10000

/**
 * Sweep thresholds over labelled score samples.
 * @param samples  [{ score: number(0..1), genuine: boolean }]
 * @param opts.step        threshold granularity (default 0.01)
 * @param opts.targetFar   desired max false-accept rate for the operating point (default 0.01)
 * @returns {
 *   counts: { genuine, impostor },
 *   rows:   [{ threshold, far, frr }],   // far/frr null when that class is empty
 *   operatingPoint: { threshold, far, frr } | null,  // lowest threshold with far <= targetFar
 *   eer:    { threshold, far, frr } | null,          // where |far - frr| is smallest
 * }
 */
export function sweepThresholds(samples = [], { step = 0.01, targetFar = 0.01 } = {}) {
  const clean = samples
    .filter(s => s && typeof s.score === 'number' && Number.isFinite(s.score))
    .map(s => ({ score: Math.max(0, Math.min(1, s.score)), genuine: !!s.genuine }))

  const genuine = clean.filter(s => s.genuine).map(s => s.score)
  const impostor = clean.filter(s => !s.genuine).map(s => s.score)
  const counts = { genuine: genuine.length, impostor: impostor.length }

  const rows = []
  for (let t = 0; t <= 1 + 1e-9; t += step) {
    const th = r4(t)
    const far = impostor.length ? r4(impostor.filter(s => s >= th).length / impostor.length) : null
    const frr = genuine.length ? r4(genuine.filter(s => s < th).length / genuine.length) : null
    rows.push({ threshold: th, far, frr })
  }

  // Operating point: the LOWEST threshold whose FAR <= target (meets the
  // security cap while keeping FRR as low as possible). Needs impostor data.
  let operatingPoint = null
  if (impostor.length) {
    operatingPoint = rows.find(row => row.far != null && row.far <= targetFar) ?? null
  }

  // EER: threshold minimising |FAR - FRR| (for system comparison / reporting).
  let eer = null
  if (genuine.length && impostor.length) {
    eer = rows.reduce((best, row) => {
      if (row.far == null || row.frr == null) return best
      const gap = Math.abs(row.far - row.frr)
      return best == null || gap < best.gap ? { ...row, gap } : best
    }, null)
    if (eer) { const { gap, ...rest } = eer; eer = rest }
  }

  return { counts, rows, operatingPoint, eer }
}

/**
 * Map a selfie `documents` record to a calibration sample, or null to skip.
 * genuine = worker verified; impostor = worker rejected; pending/other skipped.
 * Only records that carry the given score key are usable.
 */
export function sampleFromDoc(docData, scoreKey = 'faceMatchScore') {
  if (!docData) return null
  const score = docData[scoreKey]
  if (typeof score !== 'number' || !Number.isFinite(score)) return null
  if (docData.status === 'verified') return { score, genuine: true }
  if (docData.status === 'rejected') return { score, genuine: false }
  return null // pending / unreviewed — no ground-truth label yet
}
