#!/usr/bin/env node
/**
 * backfill-tenant-id.mjs  (multi-hospital Phase 3)
 *
 * Sets tenantId = <hospital #1> on every EXISTING doc that belongs to a
 * hospital and doesn't have one yet — the same docs the app stamps on create
 * since Phase 2. Agency-only docs are left alone (agencies are network-level).
 * The rules of what belongs where: scripts/lib/tenant-backfill-plan.mjs.
 * See docs/multi-hospital-network-plan.md.
 *
 * SAFETY
 *   - DRY RUN BY DEFAULT: reads and reports counts, writes nothing. Writes need
 *     an explicit --apply.
 *   - Idempotent: only docs WITHOUT a tenantId are touched, and only that one
 *     field is written (no updatedAt bump). Re-running is safe; a dry run that
 *     reports 0 to stamp is the verification step.
 *   - Reads only the few fields each decision needs (select()), so the large
 *     documentContents files are never downloaded.
 *   - Firestore triggers DO fire on the updates. They're no-ops for a
 *     tenantId-only change, with one expected exception: each slice update
 *     re-runs syncRequestFinancials, which re-derives its request's
 *     amountCommitted/status — a no-op unless that request had drifted (then it
 *     is corrected, which is that trigger's job).
 *
 * Usage (PowerShell), from the repo root:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
 *   $env:GOOGLE_CLOUD_PROJECT = "mapa-crmc"
 *   node --env-file=.env scripts/backfill-tenant-id.mjs              # dry run
 *   node --env-file=.env scripts/backfill-tenant-id.mjs --apply      # write
 *
 * Flags: --apply · --tenant <id> (default VITE_DEFAULT_HOSPITAL_ID or hospital-1)
 *        --only users,requests,...  (default: every collection in the plan)
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldPath } from 'firebase-admin/firestore'
import { COLLECTIONS, decide } from './lib/tenant-backfill-plan.mjs'

const argv  = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const val   = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt }
const TENANT = val('--tenant', process.env.VITE_DEFAULT_HOSPITAL_ID || 'hospital-1')
const ONLY   = val('--only', '').split(',').map((s) => s.trim()).filter(Boolean)

const PAGE  = 500   // docs per read page
const BATCH = 400   // updates per write batch (Firestore max 500)

const unknown = ONLY.filter((c) => !COLLECTIONS[c])
if (unknown.length) {
  console.error(`[backfill-tenant] unknown collection(s): ${unknown.join(', ')}. Known: ${Object.keys(COLLECTIONS).join(', ')}`)
  process.exit(1)
}
// users first: conversations need every user's role.
const TARGETS = ONLY.length ? ONLY : Object.keys(COLLECTIONS)

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

// Page through a collection reading only `fields`, ordered by doc id.
async function* scan(collection, fields) {
  let last = null
  for (;;) {
    let q = db.collection(collection).select(...fields, 'tenantId').orderBy(FieldPath.documentId()).limit(PAGE)
    if (last) q = q.startAfter(last)
    const snap = await q.get()
    for (const d of snap.docs) yield d
    if (snap.size < PAGE) return
    last = snap.docs[snap.docs.length - 1]
  }
}

async function loadRoles() {
  const roles = new Map()
  for await (const d of scan('users', ['role'])) roles.set(d.id, d.get('role'))
  return roles
}

async function main() {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '(from credentials)'
  console.log(`[backfill-tenant] ${APPLY ? 'APPLYING' : 'DRY RUN — no writes'} · project ${project} · tenantId = "${TENANT}"\n`)

  const hospital = await db.doc(`hospitals/${TENANT}`).get()
  if (!hospital.exists) {
    console.warn(`[backfill-tenant] ⚠ hospitals/${TENANT} does not exist yet. Run scripts/seed-default-hospital.mjs first,`)
    console.warn('                   or pass --tenant <id> for the hospital these records belong to.')
    if (APPLY) process.exit(1)
    console.warn('')
  }

  const roles = TARGETS.includes('conversations') ? await loadRoles() : new Map()
  const ctx = { roleOf: (uid) => roles.get(uid) }

  const totals = { stamp: 0, already: 0, skip: 0 }
  console.log('collection            stamp   already  skip (agency-only)')
  for (const name of TARGETS) {
    const counts = { stamp: 0, already: 0, skip: 0 }
    let batch = db.batch(), pending = 0
    for await (const d of scan(name, COLLECTIONS[name].fields)) {
      const verdict = decide(name, d.data(), ctx)
      counts[verdict]++
      if (verdict !== 'stamp' || !APPLY) continue
      batch.update(d.ref, { tenantId: TENANT })
      if (++pending === BATCH) { await batch.commit(); batch = db.batch(); pending = 0 }
    }
    if (pending) await batch.commit()
    for (const k of Object.keys(totals)) totals[k] += counts[k]
    console.log(`${name.padEnd(20)} ${String(counts.stamp).padStart(6)}  ${String(counts.already).padStart(8)}  ${String(counts.skip).padStart(5)}`)
  }
  console.log(`${'TOTAL'.padEnd(20)} ${String(totals.stamp).padStart(6)}  ${String(totals.already).padStart(8)}  ${String(totals.skip).padStart(5)}\n`)

  if (!APPLY) {
    console.log(totals.stamp
      ? `[backfill-tenant] WOULD stamp ${totals.stamp} doc(s). Re-run with --apply to write.`
      : '[backfill-tenant] ✅ Nothing to stamp — every hospital record already has a tenantId.')
  } else {
    console.log(`[backfill-tenant] ✅ Stamped ${totals.stamp} doc(s). Run again without --apply to verify (expect 0 to stamp).`)
  }
}

main().catch((err) => { console.error('[backfill-tenant] FATAL:', err); process.exit(1) })
