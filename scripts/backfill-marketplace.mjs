#!/usr/bin/env node
/**
 * backfill-marketplace.mjs  (patient marketplace)
 *
 * Prepares existing data for the marketplace rules + client
 * (docs/patient-marketplace-plan.md):
 *   1. users/{patient}.tenantIds ← their tenantId + every request's hospital.
 *      Hospitals list and read patients through this field from now on; a
 *      patient without it disappears from their hospital's Patients page.
 *   2. hospitalIds/{code}.requestId ← the request the code already backs, so
 *      it can't back another (one code = one request).
 *   3. hospitalsPublic/{id} re-synced with the marketplace fields (office,
 *      address, region, contact email).
 * The decisions live in scripts/lib/marketplace-backfill-plan.mjs (unit-tested).
 *
 * SAFETY
 *   - DRY RUN BY DEFAULT; writes only with --apply.
 *   - Idempotent and additive: tenantIds only gains ids; a code already bound
 *     is never re-bound; a code held by someone else is never bound.
 *   - Reads only the fields it needs (select()).
 *   - Run BEFORE merging the marketplace PR; a dry run reporting 0 to write is
 *     the verification step.
 *
 * Usage (PowerShell), from the repo root:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
 *   $env:GOOGLE_CLOUD_PROJECT = "<project-id>"
 *   node --env-file=.env scripts/backfill-marketplace.mjs            # dry run
 *   node --env-file=.env scripts/backfill-marketplace.mjs --apply    # write
 *
 * Flags: --apply · --tenant <id> (default VITE_DEFAULT_HOSPITAL_ID or hospital-1)
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldPath, FieldValue } from 'firebase-admin/firestore'
import {
  hospitalsByPatient, patientTenantIds, requestByCode, codeVerdict,
  projectPublicHospital, publicNeedsSync,
} from './lib/marketplace-backfill-plan.mjs'

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

function writer() {
  let batch = db.batch(), pending = 0
  const bump = async () => { if (++pending === BATCH) { await batch.commit(); batch = db.batch(); pending = 0 } }
  return {
    async update(ref, data) { if (!APPLY) return; batch.update(ref, data); await bump() },
    async set(ref, data)    { if (!APPLY) return; batch.set(ref, data);    await bump() },
    async flush() { if (APPLY && pending) await batch.commit() },
  }
}

async function main() {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '(from credentials)'
  console.log(`[backfill-marketplace] ${APPLY ? 'APPLYING' : 'DRY RUN — no writes'} · project ${project} · legacy hospital = "${TENANT}"\n`)

  const requests = []
  for await (const d of scan('requests', ['patientId', 'tenantId', 'patientHospitalId', 'submittedAt'])) {
    const r = d.data()
    requests.push({ id: d.id, ...r, submittedAt: r.submittedAt?.toMillis?.() ?? 0 })
  }

  // 1. Patients' tenantIds
  const byPatient = hospitalsByPatient(requests, TENANT)
  const w1 = writer()
  const pc = { update: 0, already: 0 }
  for await (const d of scan('users', ['role', 'tenantId', 'tenantIds'])) {
    const next = patientTenantIds(d.data(), byPatient.get(d.id))
    if (!next) { if (d.get('role') === 'patient') pc.already++; continue }
    pc.update++
    await w1.update(d.ref, { tenantIds: FieldValue.arrayUnion(...next) })
  }
  await w1.flush()
  console.log(`patients (tenantIds)   update ${pc.update}  already ${pc.already}`)

  // 2. Codes already backing a request
  const w2 = writer()
  const cc = { bind: 0, already: 0, mismatch: 0, missing: 0 }
  for (const [code, req] of requestByCode(requests)) {
    const snap = await db.doc(`hospitalIds/${code}`).get()
    const verdict = snap.exists ? codeVerdict(snap.data(), req) : 'missing'
    cc[verdict === 'skip' ? 'missing' : verdict]++
    if (verdict === 'bind') await w2.update(snap.ref, { requestId: req.id })
    if (verdict === 'mismatch') console.log(`  ⚠ ${code} backs request ${req.id} but is held by another patient — left unbound`)
  }
  await w2.flush()
  console.log(`codes (requestId)      bind ${cc.bind}  already ${cc.already}  mismatch ${cc.mismatch}  no code doc ${cc.missing}`)

  // 3. hospitalsPublic
  const w3 = writer()
  const hc = { sync: 0, already: 0 }
  const hospitals = await db.collection('hospitals').get()
  for (const h of hospitals.docs) {
    const pubRef = db.doc(`hospitalsPublic/${h.id}`)
    const pub = await pubRef.get()
    if (!publicNeedsSync(h.data(), pub.exists ? pub.data() : null)) { hc.already++; continue }
    hc.sync++
    await w3.set(pubRef, { ...projectPublicHospital(h.data()), updatedAt: FieldValue.serverTimestamp() })
  }
  await w3.flush()
  console.log(`hospitalsPublic        sync ${hc.sync}  already ${hc.already}`)

  const toWrite = pc.update + cc.bind + hc.sync
  console.log('')
  console.log(!APPLY
    ? (toWrite ? `[backfill-marketplace] WOULD write ${toWrite} doc(s). Re-run with --apply.`
               : '[backfill-marketplace] ✅ Nothing to write — marketplace data is complete.')
    : `[backfill-marketplace] ✅ Wrote ${toWrite} doc(s). Run again without --apply to verify (expect 0).`)
}

main().catch((err) => { console.error('[backfill-marketplace] FATAL:', err); process.exit(1) })
