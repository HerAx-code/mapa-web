#!/usr/bin/env node
/**
 * backfill-agencies-public.js
 *
 * One-time backfill for the `agenciesPublic` projection introduced to close
 * audit SEC-3 (the rich `agencies` collection was world-readable, leaking
 * budget / fundSource / contacts / signatories to the public Landing page).
 *
 * Going forward the `onAgencyWritten` Cloud Function keeps `agenciesPublic` in
 * sync on every agency write. But existing agencies won't fire that trigger
 * until they're next edited, so this script seeds the projection for all of
 * them once. It copies ONLY the non-sensitive public fields (name + slots +
 * enabled) — never budget or contacts.
 *
 * Idempotent: re-running overwrites each projection with the current values.
 *
 * Run this BEFORE (or right after) deploying — the Landing teaser stays empty,
 * never broken, until it completes.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/backfill-agencies-public.js
 *
 * PowerShell:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "./service-account.json"
 *   node scripts/backfill-agencies-public.js
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

// The one projection, from the function that maintains the listing (Phase 1:
// it is the only writer; no copies to keep in sync).
import { createRequire } from 'node:module'
const { projectPublicAgency } = createRequire(import.meta.url)('../functions/src/onAgencyWritten')

async function main() {
  initializeApp({ credential: applicationDefault() })
  const db = getFirestore()

  const snap = await db.collection('agencies').get()
  // A training agency (the Training Hospital's practice funder) is never
  // public — same rule as onAgencyWritten / resyncAgenciesPublic.
  const liveIds = new Set(snap.docs.filter(d => d.data().training !== true).map(d => d.id))
  console.log(`Found ${snap.size} agencies. Writing public projections…`)

  let written = 0
  const batch = db.batch()
  snap.docs.forEach(d => {
    if (d.data().training === true) { console.log(`  – ${d.id} → training agency, not published`); return }
    const pub = projectPublicAgency(d.data())
    batch.set(
      db.collection('agenciesPublic').doc(d.id),
      { ...pub, updatedAt: FieldValue.serverTimestamp() },
    )
    written++
    console.log(`  · ${d.id} → ${pub.name} (enabled=${pub.enabled}, slots ${pub.slots.remaining}/${pub.slots.total})`)
  })

  // Prune orphans: agenciesPublic docs whose agency no longer exists (deleted).
  // Otherwise they keep showing on the public Landing teaser forever.
  const pubSnap = await db.collection('agenciesPublic').get()
  let pruned = 0
  pubSnap.docs.forEach(d => {
    if (liveIds.has(d.id)) return
    batch.delete(db.collection('agenciesPublic').doc(d.id))
    pruned++
    console.log(`  ✗ ${d.id} → not a published agency (deleted or training) — removing`)
  })

  await batch.commit()

  console.log(`\nDone. ${written} agenciesPublic docs written, ${pruned} orphans pruned.`)
  process.exit(0)
}

main().catch(err => { console.error('Backfill failed:', err); process.exit(1) })
