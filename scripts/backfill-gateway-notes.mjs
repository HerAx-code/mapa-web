#!/usr/bin/env node
/**
 * backfill-gateway-notes.mjs  (De-CRMC Phase 4a)
 *
 * One-off migration: copy the legacy `crmcNotes` field on every existing
 * applications/{id} doc into the new `gatewayNotes` field, so the reader
 * (agency ApproveModal) can read `gatewayNotes ?? crmcNotes` during the
 * transition and, after Phase 4b, read `gatewayNotes` alone.
 *
 * Context: `crmcNotes` is the optional free-text referral note the gateway
 * coordinator attaches when endorsing a slice. The de-CRMC rename moves it to
 * `gatewayNotes`. New slices are already dual-written (gatewayNotes + crmcNotes)
 * by src/pages/admin/Requests.jsx; this script fills in the pre-existing docs.
 *
 * Idempotent: re-running is safe. Skips any doc that has no `crmcNotes`, or that
 * already has a `gatewayNotes` (so it never clobbers a newer value).
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/backfill-gateway-notes.mjs
 *
 *   PowerShell:
 *     $env:GOOGLE_APPLICATION_CREDENTIALS = "./service-account.json"
 *     node scripts/backfill-gateway-notes.mjs
 *
 * Add --dry-run to preview without writing.
 *
 * Output sample:
 *   [backfill] Scanning applications...
 *   [backfill]   ✅ app_abc123 -- crmcNotes -> gatewayNotes
 *   [backfill]   ⏭️  app_def456 -- no crmcNotes, skipped
 *   [backfill]   ⏭️  app_ghi789 -- gatewayNotes already set, skipped
 *   [backfill] Done.  backfilled: 3  skipped: 20  errors: 0
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const DRY_RUN = process.argv.includes('--dry-run')

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

async function main() {
  console.log(`[backfill] ${DRY_RUN ? 'DRY RUN -- no writes' : 'APPLYING backfill'}`)
  console.log('[backfill] Scanning applications...\n')

  const snap = await db.collection('applications').get()
  let backfilled = 0, skipped = 0, errors = 0

  for (const docSnap of snap.docs) {
    const id   = docSnap.id
    const data = docSnap.data()

    if (data.crmcNotes === undefined || data.crmcNotes === null) {
      skipped++
      continue
    }
    if (data.gatewayNotes !== undefined && data.gatewayNotes !== null) {
      console.log(`  ⏭️  ${id} -- gatewayNotes already set, skipped`)
      skipped++
      continue
    }

    try {
      if (!DRY_RUN) {
        await docSnap.ref.update({ gatewayNotes: data.crmcNotes })
      }
      console.log(`  ✅ ${id} -- crmcNotes -> gatewayNotes`)
      backfilled++
    } catch (err) {
      console.error(`  ❌ ${id} -- ${err.message}`)
      errors++
    }
  }

  console.log(`\n[backfill] Done.  backfilled: ${backfilled}  skipped: ${skipped}  errors: ${errors}`)
  if (errors > 0) process.exitCode = 1
}

main().catch((err) => { console.error('[backfill] FATAL:', err); process.exit(1) })
