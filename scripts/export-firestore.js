#!/usr/bin/env node
/**
 * export-firestore.js
 *
 * Full-database backup via the Admin SDK. Walks every top-level
 * collection in the project plus the two known subcollection paths
 * (`notifications/{uid}/items` and `conversations/{id}/messages`),
 * writes each as a JSON file under ./backups/{ISO-timestamp}/.
 *
 * Built explicitly for the Spark plan use case: there's no Firebase
 * automated backup on Spark, so this is the operator's only rollback
 * mechanism short of "hope nothing got deleted." Recommended to run
 * before any destructive operation (admin/Patients cascade delete,
 * cleanup-orphans.js, Firebase Console manual deletion, etc.) AND
 * before each thesis-defense run.
 *
 * Restore is intentionally out of scope. JSON in, manual review out
 * --- if you ever need to restore, read the JSON and write a focused
 * restore script for the affected collection (the structure mirrors
 * what bootstrap-users.js / bootstrap-reference-data.js already do).
 *
 * Output format: one JSON file per collection, plus a manifest.json
 * summarising the run. Timestamps are converted from Firestore
 * Timestamp -> ISO-8601 strings so the JSON can be diffed by eye
 * without protobuf-encoded blobs.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/export-firestore.js
 *
 * PowerShell:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "./service-account.json"
 *   node scripts/export-firestore.js
 *
 * Output goes to ./backups/{YYYY-MM-DDTHH-mm-ss}/. The backups
 * directory is gitignored (added to .gitignore in the same commit
 * as this script) so backups never end up in the repo.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Top-level collections the system writes to. Keep this list in
// sync with firestore.rules + the data model documentation in
// docs/thesis-documentation.md §6.
const TOP_LEVEL_COLLECTIONS = [
  'users',
  'hospitalIds',
  'agencies',
  'requests',
  'applications',
  'documents',
  'documentContents',
  'documentTypes',
  'assistanceTypes',
  'certificates',
  'conversations',
  'notifications',
  'reports',
  'announcements',
  'auditLog',
  'docReviewPresence',
]

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

// Convert any Firestore Timestamp or Date value in a doc tree into an
// ISO string, recursively. Leaves everything else (strings, numbers,
// nulls, arrays, plain objects) alone. Makes the JSON greppable.
function normaliseValue(v) {
  if (v === null || v === undefined) return v
  if (v instanceof Timestamp) return v.toDate().toISOString()
  if (v instanceof Date)      return v.toISOString()
  if (Array.isArray(v))       return v.map(normaliseValue)
  if (typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v)) out[k] = normaliseValue(v[k])
    return out
  }
  return v
}

async function exportCollection(path) {
  const snap = await db.collection(path).get()
  const docs = snap.docs.map(d => ({ id: d.id, ...normaliseValue(d.data()) }))
  return docs
}

async function main() {
  const startedAt = new Date()
  // Filesystem-safe ISO: 2026-06-06T11-30-15
  const stamp = startedAt.toISOString().slice(0, 19).replace(/:/g, '-')
  const outDir = join('backups', stamp)
  await mkdir(outDir, { recursive: true })

  console.log(`[export-firestore] Writing to ${outDir}\n`)

  const manifest = {
    startedAt: startedAt.toISOString(),
    projectId: process.env.FIREBASE_PROJECT_ID || db.databaseId || 'unknown',
    collections: {},
    totalDocs: 0,
    durationMs: 0,
  }

  // 1. Top-level collections
  for (const name of TOP_LEVEL_COLLECTIONS) {
    try {
      const docs = await exportCollection(name)
      const file = join(outDir, `${name}.json`)
      await writeFile(file, JSON.stringify(docs, null, 2))
      manifest.collections[name] = docs.length
      manifest.totalDocs += docs.length
      console.log(`  ${docs.length.toString().padStart(5)} docs  →  ${name}.json`)
    } catch (e) {
      console.error(`  ❌ ${name}: ${e.message}`)
      manifest.collections[name] = { error: e.message }
    }
  }

  // 2. notifications/{uid}/items subcollections.
  //    Walk each user-shaped path under notifications/ and pull its
  //    `items` subcollection. The user docs themselves don't carry
  //    payload data -- only the items do -- so we don't need to
  //    re-export the parent.
  console.log()
  const notifUsers = await db.collection('notifications').listDocuments()
  let notifItems = 0
  const notifByUser = {}
  for (const u of notifUsers) {
    const items = await db.collection(`notifications/${u.id}/items`).get()
    const docs = items.docs.map(d => ({ id: d.id, ...normaliseValue(d.data()) }))
    notifByUser[u.id] = docs
    notifItems += docs.length
  }
  await writeFile(join(outDir, 'notifications_items.json'), JSON.stringify(notifByUser, null, 2))
  manifest.collections['notifications_items'] = notifItems
  manifest.totalDocs += notifItems
  console.log(`  ${notifItems.toString().padStart(5)} docs  →  notifications_items.json (across ${notifUsers.length} users)`)

  // 3. conversations/{id}/messages subcollections.
  console.log()
  const convs = await db.collection('conversations').listDocuments()
  let convMsgs = 0
  const msgByConv = {}
  for (const c of convs) {
    const msgs = await db.collection(`conversations/${c.id}/messages`).get()
    const docs = msgs.docs.map(d => ({ id: d.id, ...normaliseValue(d.data()) }))
    msgByConv[c.id] = docs
    convMsgs += docs.length
  }
  await writeFile(join(outDir, 'conversations_messages.json'), JSON.stringify(msgByConv, null, 2))
  manifest.collections['conversations_messages'] = convMsgs
  manifest.totalDocs += convMsgs
  console.log(`  ${convMsgs.toString().padStart(5)} docs  →  conversations_messages.json (across ${convs.length} conversations)`)

  manifest.durationMs = Date.now() - startedAt.getTime()
  manifest.finishedAt = new Date().toISOString()
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  console.log(`\n[export-firestore] Done.`)
  console.log(`  Total docs:  ${manifest.totalDocs}`)
  console.log(`  Duration:    ${(manifest.durationMs / 1000).toFixed(1)}s`)
  console.log(`  Manifest:    ${join(outDir, 'manifest.json')}`)
  console.log(`\n  To restore from this snapshot: read the JSON files manually`)
  console.log(`  and write a focused restore script for the affected collection.`)
}

main().then(() => process.exit(0)).catch(err => {
  console.error('[export-firestore] failed:', err)
  process.exit(1)
})