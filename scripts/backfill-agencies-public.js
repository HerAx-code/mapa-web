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

// Mirror of projectPublicAgency() in functions/src/onAgencyWritten.js — keep in
// sync. Only non-sensitive fields.
function projectPublicAgency(data = {}) {
  const slots = data.slots ?? {}
  return {
    name:    data.name ?? '',
    enabled: data.enabled !== false,
    slots: {
      total:     Number(slots.total) || 0,
      remaining: Number(slots.remaining) || 0,
    },
  }
}

async function main() {
  initializeApp({ credential: applicationDefault() })
  const db = getFirestore()

  const snap = await db.collection('agencies').get()
  console.log(`Found ${snap.size} agencies. Writing public projections…`)

  let written = 0
  const batch = db.batch()
  snap.docs.forEach(d => {
    const pub = projectPublicAgency(d.data())
    batch.set(
      db.collection('agenciesPublic').doc(d.id),
      { ...pub, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
    written++
    console.log(`  · ${d.id} → ${pub.name} (enabled=${pub.enabled}, slots ${pub.slots.remaining}/${pub.slots.total})`)
  })
  await batch.commit()

  console.log(`\nDone. ${written} agenciesPublic docs written.`)
  process.exit(0)
}

main().catch(err => { console.error('Backfill failed:', err); process.exit(1) })
