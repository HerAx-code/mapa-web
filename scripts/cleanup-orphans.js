#!/usr/bin/env node
/**
 * cleanup-orphans.js
 *
 * Audits Firestore for storage waste and (optionally) cleans it up.
 * Run periodically (weekly) from an admin workstation with the Firebase
 * Admin SDK service-account credentials in $GOOGLE_APPLICATION_CREDENTIALS.
 *
 * What it finds:
 *  - documentContents/{id} with no matching documents/{id} (orphans from
 *    failed deletes; each is ~900KB of permanent garbage in Firestore)
 *  - documents/{id} with no matching documentContents/{id} (less common —
 *    metadata that won't render in viewers; safe to leave but worth knowing)
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/cleanup-orphans.js           # dry-run audit only
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/cleanup-orphans.js --delete  # actually delete orphans
 *
 * Get a service account key:
 *   Firebase Console → Project Settings → Service Accounts → Generate new
 *   private key. Save outside the repo; never commit it.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const DELETE = process.argv.includes('--delete')

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

async function main() {
  console.log(DELETE ? '[cleanup-orphans] DELETE mode' : '[cleanup-orphans] DRY-RUN mode (pass --delete to remove)')

  const [docMeta, docContent] = await Promise.all([
    db.collection('documents').select().get(),
    db.collection('documentContents').select().get(),
  ])

  const metaIds    = new Set(docMeta.docs.map(d => d.id))
  const contentIds = new Set(docContent.docs.map(d => d.id))

  const orphanContent = [...contentIds].filter(id => !metaIds.has(id))
  const orphanMeta    = [...metaIds].filter(id => !contentIds.has(id))

  console.log(`\nScanned ${metaIds.size} documents, ${contentIds.size} contents`)
  console.log(`  Orphan documentContents (waste): ${orphanContent.length}`)
  console.log(`  Orphan documents      (broken):  ${orphanMeta.length}`)

  if (orphanContent.length > 0) {
    console.log('\nOrphan content IDs (first 20):')
    orphanContent.slice(0, 20).forEach(id => console.log('  ' + id))
    if (DELETE) {
      console.log(`\nDeleting ${orphanContent.length} orphan content docs...`)
      // Batch in chunks of 500 (Firestore batch limit)
      for (let i = 0; i < orphanContent.length; i += 500) {
        const batch = db.batch()
        orphanContent.slice(i, i + 500).forEach(id =>
          batch.delete(db.collection('documentContents').doc(id))
        )
        await batch.commit()
      }
      console.log('Done.')
    }
  }

  if (orphanMeta.length > 0) {
    console.log('\nOrphan metadata IDs (first 20):')
    orphanMeta.slice(0, 20).forEach(id => console.log('  ' + id))
    console.log('\n(Orphan metadata is not auto-deleted by this script — review manually.)')
  }

  // NOTE: this scan reads document IDs only (.select() above), so it does
  // NOT measure byte size. A previous version multiplied the count by a
  // hard-coded 900 KB/doc and printed it as "Estimated reclaimable
  // storage" — that was a ~45x overestimate (real orphans on 2026-07-23
  // averaged ~20 KB/doc: 12,149 docs ≈ 236 MB, not the ~10.7 GB it
  // claimed). Report the reliable figure (the count) and don't fabricate
  // a size the cheap scan can't know.
  console.log(`\n${orphanContent.length} orphan content doc(s) would be reclaimed.`)
  console.log(`(Byte size not measured — this scan reads IDs only. Fetch the`)
  console.log(`\`content\` field if you need an exact reclaimable-storage figure.)`)
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})