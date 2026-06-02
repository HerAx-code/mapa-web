#!/usr/bin/env node
/**
 * migrate-doc-content-to-storage.js
 *
 * Tier-2 item 8 migration: moves every documentContents/{docId} base64
 * payload to Cloud Storage at /documents/{patientId}/{docId}/{file},
 * stamps storagePath onto the corresponding documents/{docId} doc, and
 * (with --delete) removes the documentContents Firestore doc.
 *
 * Idempotent: re-running skips docs already migrated. Safe to interrupt
 * and resume.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/migrate-doc-content-to-storage.js          # dry-run
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/migrate-doc-content-to-storage.js --apply  # actually
 *                                                              upload +
 *                                                              stamp
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/migrate-doc-content-to-storage.js --apply --delete
 *     # same as above PLUS delete documentContents docs after the
 *     Storage upload succeeds. The Firestore deletion is gated on a
 *     successful Storage upload + storagePath stamp.
 *
 * Pattern mirrors scripts/cleanup-orphans.js and scripts/cleanup-injection-audit.js.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

const APPLY  = process.argv.includes('--apply')
const DELETE = process.argv.includes('--delete')

initializeApp({ credential: applicationDefault() })
const db = getFirestore()
const bucket = getStorage().bucket()

const sanitizeFilename = (name) => {
  const clean = (name || 'file').replace(/[^\w.\-]+/g, '_').replace(/^_+|_+$/g, '')
  return clean.slice(0, 80) || 'file'
}

function dataUrlToBuffer(dataUrl) {
  if (typeof dataUrl !== 'string') return null
  const idx = dataUrl.indexOf(',')
  if (idx < 0) return null
  const meta = dataUrl.slice(0, idx)
  const b64  = dataUrl.slice(idx + 1)
  const m = meta.match(/data:([^;]+);base64/)
  const contentType = m?.[1] ?? 'application/octet-stream'
  return { buffer: Buffer.from(b64, 'base64'), contentType }
}

async function main() {
  console.log(APPLY
    ? `[migrate-doc-content] APPLY mode${DELETE ? ' (with --delete of source docs)' : ''}`
    : '[migrate-doc-content] DRY-RUN mode (pass --apply to actually upload + stamp)')

  console.log('\nScanning documentContents...')
  const snap = await db.collection('documentContents').get()
  console.log(`  ${snap.size} legacy content docs found.`)

  // Cross-reference each documentContents with its parent documents/{docId}.
  let migrated = 0
  let skippedAlreadyMigrated = 0
  let skippedNoParent = 0
  let skippedBadContent = 0
  let failed = 0
  let deletedSource = 0

  for (const contentDoc of snap.docs) {
    const docId = contentDoc.id
    const data  = contentDoc.data() ?? {}
    const content   = data.content
    const patientId = data.patientId
    if (!patientId) { skippedBadContent++; continue }
    if (!content)   { skippedBadContent++; continue }

    // Read the metadata doc to get the original filename (and check if
    // storagePath is already stamped, meaning a previous run migrated this
    // entry but the source delete didn't happen).
    const metaSnap = await db.doc(`documents/${docId}`).get()
    if (!metaSnap.exists) { skippedNoParent++; continue }
    const meta = metaSnap.data() ?? {}
    if (meta.storagePath) {
      skippedAlreadyMigrated++
      // If --delete was passed and the source still exists, clean it.
      if (DELETE && APPLY) {
        await contentDoc.ref.delete()
        deletedSource++
        console.log(`  🧹 ${docId}: storagePath already present, deleted leftover documentContents doc`)
      }
      continue
    }

    const parsed = dataUrlToBuffer(content)
    if (!parsed) { skippedBadContent++; continue }

    const cleanName   = sanitizeFilename(meta.fileName || `file.${(parsed.contentType.split('/')[1] || 'bin')}`)
    const storagePath = `documents/${patientId}/${docId}/${cleanName}`

    if (!APPLY) {
      console.log(`  📤 ${docId}: would upload ${parsed.buffer.length} B (${parsed.contentType}) to ${storagePath}`)
      continue
    }

    try {
      const file = bucket.file(storagePath)
      await file.save(parsed.buffer, {
        contentType: parsed.contentType,
        resumable: false,
        metadata: { metadata: { migratedFrom: 'documentContents', migratedAt: new Date().toISOString() } },
      })
      await metaSnap.ref.update({ storagePath })
      migrated++
      console.log(`  ✅ ${docId}: uploaded + stamped (${parsed.buffer.length} B, ${parsed.contentType})`)

      if (DELETE) {
        await contentDoc.ref.delete()
        deletedSource++
      }
    } catch (err) {
      failed++
      console.error(`  ❌ ${docId}: ${err.message}`)
    }
  }

  console.log(`\nDone. migrated=${migrated} alreadyMigrated=${skippedAlreadyMigrated} ` +
              `badContent=${skippedBadContent} noParent=${skippedNoParent} ` +
              `failed=${failed} deletedSource=${deletedSource}`)

  if (!APPLY) {
    console.log('\nThis was a dry run. Pass --apply to actually upload + stamp.')
    console.log('Pass --apply --delete to also remove the legacy documentContents docs.')
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})
