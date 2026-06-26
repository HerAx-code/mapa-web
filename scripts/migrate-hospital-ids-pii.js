#!/usr/bin/env node
/**
 * migrate-hospital-ids-pii.js  (Phase 0.3)
 *
 * One-off migration: move the `usedBy` patient-name field off every
 * existing hospitalIds/{id} doc into a sub-doc at
 *   hospitalIds/{id}/privateInfo/details
 * and then remove `usedBy` from the parent.
 *
 * Why: hospitalIds allows unauthenticated GET (needed during
 * registration verification, before patient signs in). Leaving the
 * patient name on the parent doc let anyone enumerate the access-code
 * range and pair codes with names -- a ready-made phishing kit.
 *
 * The full fix (rule + Register + admin UI) is already deployed. This
 * script is only needed to clean up pre-fix records.
 *
 * The script is idempotent: re-running it is safe (it skips any doc
 * that has no `usedBy` field).
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/migrate-hospital-ids-pii.js
 *
 *   PowerShell:
 *     $env:GOOGLE_APPLICATION_CREDENTIALS = "./service-account.json"
 *     node scripts/migrate-hospital-ids-pii.js
 *
 * Add --dry-run to preview without writing.
 *
 * Output sample:
 *   [migrate] Scanning hospitalIds...
 *   [migrate]   ✅ CRMC-2026-00001 -- usedBy "Maria Santos" -> sub-doc
 *   [migrate]   ⏭️  CRMC-2026-00002 -- no usedBy, skipped
 *   [migrate] Done.
 *     migrated: 7
 *     skipped:  13
 *     errors:   0
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const DRY_RUN = process.argv.includes('--dry-run')

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

async function main() {
  console.log(`[migrate] ${DRY_RUN ? 'DRY RUN -- no writes' : 'APPLYING migration'}`)
  console.log('[migrate] Scanning hospitalIds...\n')

  const snap = await db.collection('hospitalIds').get()
  let migrated = 0, skipped = 0, errors = 0

  for (const docSnap of snap.docs) {
    const id   = docSnap.id
    const data = docSnap.data()

    if (!data.usedBy) {
      console.log(`  ⏭️  ${id} -- no usedBy, skipped`)
      skipped++
      continue
    }

    try {
      if (!DRY_RUN) {
        // Atomic: create the sub-doc + clear the field on the parent in
        // a single batch. If either fails, neither happens -- safer than
        // sequential writes that could leave the parent half-migrated.
        const batch = db.batch()
        batch.set(
          db.doc(`hospitalIds/${id}/privateInfo/details`),
          {
            usedBy:    data.usedBy,
            usedById:  data.patId ?? null,
            createdAt: FieldValue.serverTimestamp(),
            migratedFromParent: true,
          },
          { merge: true },  // re-runnable: don't overwrite if sub-doc already exists from a prior partial run
        )
        batch.update(db.doc(`hospitalIds/${id}`), {
          usedBy: FieldValue.delete(),
        })
        await batch.commit()
      }
      console.log(`  ${DRY_RUN ? '➕ WOULD MIGRATE' : '✅'} ${id} -- usedBy "${data.usedBy}" -> sub-doc`)
      migrated++
    } catch (err) {
      console.error(`  ❌ ${id} -- ${err.message}`)
      errors++
    }
  }

  console.log(`\n[migrate] Done.`)
  console.log(`  migrated: ${migrated}`)
  console.log(`  skipped:  ${skipped}`)
  console.log(`  errors:   ${errors}`)
  if (DRY_RUN) {
    console.log(`\n  This was a DRY RUN. Re-run without --dry-run to apply.`)
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error('[migrate] failed:', err.message)
  process.exit(1)
})
