#!/usr/bin/env node
/**
 * backfill-partnerships.mjs  (multi-hospital Phase 7)
 *
 * Prepares existing data for the Phase 7 rules:
 *   1. agencies without partnerHospitalIds → [hospital #1] (what the rules
 *      already assume for them, so no access changes).
 *   2. each patient's users.agencyIds ← the agencies holding a slice for them.
 *      The Phase 7 rules let an agency read a patient profile ONLY through
 *      this field, so without it agencies lose the patient's address / contact
 *      on cases already in flight.
 * The decisions live in scripts/lib/partnership-backfill-plan.mjs (unit-tested).
 * See docs/multi-hospital-network-plan.md.
 *
 * SAFETY
 *   - DRY RUN BY DEFAULT; writes only with --apply.
 *   - Idempotent and additive: an existing partner list is never touched;
 *     agencyIds only ever gains missing ids (arrayUnion), never loses any.
 *   - Reads only the fields it needs (select()).
 *   - Run AFTER backfill-tenant-id.mjs; a dry run reporting 0 to write is the
 *     verification step.
 *
 * Usage (PowerShell), from the repo root:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
 *   $env:GOOGLE_CLOUD_PROJECT = "<project-id>"
 *   node --env-file=.env scripts/backfill-partnerships.mjs            # dry run
 *   node --env-file=.env scripts/backfill-partnerships.mjs --apply    # write
 *
 * Flags: --apply · --tenant <id> (default VITE_DEFAULT_HOSPITAL_ID or hospital-1)
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldPath, FieldValue } from 'firebase-admin/firestore'
import { agencyVerdict, agenciesByPatient, missingAgencyIds } from './lib/partnership-backfill-plan.mjs'

const argv  = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const val   = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt }
const TENANT = val('--tenant', process.env.VITE_DEFAULT_HOSPITAL_ID || 'hospital-1')

const PAGE  = 500
const BATCH = 400

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

async function* scan(collection, fields) {
  let last = null
  for (;;) {
    let q = db.collection(collection).select(...fields).orderBy(FieldPath.documentId()).limit(PAGE)
    if (last) q = q.startAfter(last)
    const snap = await q.get()
    for (const d of snap.docs) yield d
    if (snap.size < PAGE) return
    last = snap.docs[snap.docs.length - 1]
  }
}

// Collects updates and commits them in batches (only with --apply).
function writer() {
  let batch = db.batch(), pending = 0
  return {
    async update(ref, data) {
      if (!APPLY) return
      batch.update(ref, data)
      if (++pending === BATCH) { await batch.commit(); batch = db.batch(); pending = 0 }
    },
    async flush() { if (APPLY && pending) await batch.commit() },
  }
}

async function main() {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '(from credentials)'
  console.log(`[backfill-partnerships] ${APPLY ? 'APPLYING' : 'DRY RUN — no writes'} · project ${project} · default partner = "${TENANT}"\n`)

  const hospital = await db.doc(`hospitals/${TENANT}`).get()
  if (!hospital.exists) {
    console.warn(`[backfill-partnerships] ⚠ hospitals/${TENANT} does not exist. Run scripts/seed-default-hospital.mjs first.`)
    if (APPLY) process.exit(1)
  }

  // 1. Agencies
  const w1 = writer()
  const agencyCounts = { stamp: 0, already: 0 }
  for await (const d of scan('agencies', ['partnerHospitalIds'])) {
    const verdict = agencyVerdict(d.data())
    agencyCounts[verdict]++
    if (verdict === 'stamp') await w1.update(d.ref, { partnerHospitalIds: [TENANT] })
  }
  await w1.flush()
  console.log(`agencies             stamp ${agencyCounts.stamp}  already ${agencyCounts.already}`)

  // 2. Patients' agencyIds, from every slice
  const slices = []
  for await (const d of scan('applications', ['patientId', 'agencyId'])) slices.push(d.data())
  const wanted = agenciesByPatient(slices)

  const w2 = writer()
  const patientCounts = { update: 0, already: 0, noProfile: 0 }
  const seen = new Set()
  for await (const d of scan('users', ['role', 'agencyIds'])) {
    if (!wanted.has(d.id)) continue
    seen.add(d.id)
    const missing = missingAgencyIds(d.get('agencyIds'), wanted.get(d.id))
    if (!missing.length) { patientCounts.already++; continue }
    patientCounts.update++
    await w2.update(d.ref, { agencyIds: FieldValue.arrayUnion(...missing) })
  }
  await w2.flush()
  for (const id of wanted.keys()) if (!seen.has(id)) patientCounts.noProfile++
  console.log(`patients (agencyIds) update ${patientCounts.update}  already ${patientCounts.already}  no profile ${patientCounts.noProfile}`)

  const toWrite = agencyCounts.stamp + patientCounts.update
  console.log('')
  if (!APPLY) {
    console.log(toWrite
      ? `[backfill-partnerships] WOULD write ${toWrite} doc(s). Re-run with --apply.`
      : '[backfill-partnerships] ✅ Nothing to write — partnerships and agencyIds are complete.')
  } else {
    console.log(`[backfill-partnerships] ✅ Wrote ${toWrite} doc(s). Run again without --apply to verify (expect 0).`)
  }
  if (patientCounts.noProfile) {
    console.log(`  (${patientCounts.noProfile} slice patient(s) have no users doc — deleted accounts; nothing to stamp.)`)
  }
}

main().catch((err) => { console.error('[backfill-partnerships] FATAL:', err); process.exit(1) })
