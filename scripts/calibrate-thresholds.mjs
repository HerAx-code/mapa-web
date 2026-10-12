#!/usr/bin/env node
/**
 * calibrate-thresholds.mjs
 *
 * Reads the advisory face-match / liveness SCORES already stored on selfie
 * `documents` (never biometric templates — see src/utils/uploadDocument.js) and
 * the social worker's verify/reject verdict (the ground-truth label), and prints
 * FAR/FRR curves + a recommended operating point for FACE_MATCH_HI / LIVENESS_HI.
 *
 * This is how the provisional thresholds in src/utils/constants.js get replaced
 * with data-derived ones (id-verification-plan §7). Read-only: it writes nothing.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/calibrate-thresholds.mjs [--far 0.01]
 *
 * PowerShell:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "./service-account.json"
 *   node scripts/calibrate-thresholds.mjs --far 0.01
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { sweepThresholds, sampleFromDoc } from '../src/utils/calibration.js'

const argFar = (() => {
  const i = process.argv.indexOf('--far')
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(v) && v > 0 && v < 1 ? v : 0.01
})()

function report(label, scoreKey, docs, targetFar) {
  const samples = docs.map(d => sampleFromDoc(d, scoreKey)).filter(Boolean)
  const { counts, operatingPoint, eer } = sweepThresholds(samples, { targetFar })

  console.log(`\n── ${label} (${scoreKey}) ──`)
  console.log(`  labelled samples: ${counts.genuine} verified (genuine) · ${counts.impostor} rejected (impostor)`)
  if (counts.genuine + counts.impostor < 30) {
    console.log('  ⚠ Too few labelled samples (<30) — thresholds below are NOT yet trustworthy.')
  }
  if (eer)            console.log(`  EER (system comparison only): ~${(eer.far * 100).toFixed(1)}% @ threshold ${eer.threshold}`)
  if (operatingPoint) {
    console.log(`  → operating point for FAR ≤ ${(targetFar * 100).toFixed(2)}%: threshold ${operatingPoint.threshold}` +
                ` (measured FAR ${(operatingPoint.far * 100).toFixed(2)}%, FRR ${(operatingPoint.frr != null ? (operatingPoint.frr * 100).toFixed(1) : '—')}%)`)
    console.log(`     set in constants.js / env accordingly (${scoreKey === 'faceMatchScore' ? 'FACE_MATCH_HI' : 'LIVENESS_HI'} = ${operatingPoint.threshold})`)
  } else {
    console.log('  → no operating point (need rejected/impostor samples to measure FAR).')
  }
}

async function main() {
  initializeApp({ credential: applicationDefault() })
  const db = getFirestore()

  // Selfie docs carry faceMatchScore; pull every reviewed one. We fetch broadly
  // and filter in sampleFromDoc so a missing field or odd status just skips.
  const snap = await db.collection('documents').get()
  const docs = snap.docs.map(d => d.data())
  const selfieDocs = docs.filter(d => typeof d.faceMatchScore === 'number' || typeof d.livenessScore === 'number')

  console.log(`[calibrate-thresholds] scanned ${docs.length} documents; ${selfieDocs.length} carry a face/liveness score.`)
  console.log('Ground-truth labels: status "verified" = genuine, "rejected" = impostor.')
  console.log('⚠ Rejections can mean "unclear photo" not only "wrong person" — treat FAR as a loose upper bound.')

  report('Face match', 'faceMatchScore', selfieDocs, argFar)
  report('Liveness',   'livenessScore',  selfieDocs, argFar)
  console.log('')
}

main().then(() => process.exit(0)).catch(err => {
  console.error('[calibrate-thresholds] failed:', err)
  process.exit(1)
})
