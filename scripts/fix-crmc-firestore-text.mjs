#!/usr/bin/env node
/**
 * fix-crmc-firestore-text.mjs  (one-off de-CRMC data cleanup)
 *
 * The de-CRMC genericization cleaned the CODE (0 "CRMC" in src), but some
 * seeded Firestore config predates it and still carries the literal "CRMC" in
 * its text. The patient document checklist reads documentTypes descriptions
 * straight from Firestore (legacy flat path, VITE_PER_TYPE_DOCS off), so the
 * Live Selfie card still showed "…so CRMC can confirm your photo matches your
 * ID." even though no code contains that string.
 *
 * This scans the seeded config collections and replaces every "CRMC" token in
 * their top-level string fields with the configured gateway name (default
 * "Medical Social Services", matching ORG.gatewayName), so the live copy reads
 * like the rest of the UI. User-entered collections are NOT touched.
 *
 * Usage (PowerShell):
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
 *   $env:GOOGLE_CLOUD_PROJECT = "mapa-crmc"
 *   node scripts/fix-crmc-firestore-text.mjs --dry-run     # preview every change
 *   node scripts/fix-crmc-firestore-text.mjs               # apply
 *
 * Flags:
 *   --dry-run            preview only, no writes
 *   --gateway <name>     replacement text (default "Medical Social Services")
 *   --collections a,b    override the scanned set (default documentTypes,assistanceTypes)
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const GATEWAY = argVal('--gateway', 'Medical Social Services')
const COLLECTIONS = argVal('--collections', 'documentTypes,assistanceTypes')
  .split(',').map(s => s.trim()).filter(Boolean)

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

async function main() {
  console.log(`[fix-crmc] ${DRY_RUN ? 'DRY RUN -- no writes' : 'APPLYING'}`)
  console.log(`[fix-crmc] replace "CRMC" -> "${GATEWAY}" in: ${COLLECTIONS.join(', ')}\n`)

  let scanned = 0, changed = 0

  for (const col of COLLECTIONS) {
    const snap = await db.collection(col).get()
    for (const doc of snap.docs) {
      scanned++
      const data = doc.data()
      const update = {}
      for (const [key, val] of Object.entries(data)) {
        if (typeof val === 'string' && val.includes('CRMC')) {
          update[key] = val.replaceAll('CRMC', GATEWAY)
        }
      }
      if (Object.keys(update).length === 0) continue
      changed++
      console.log(`[fix-crmc] ${col}/${doc.id}`)
      for (const [key, next] of Object.entries(update)) {
        console.log(`             ${key}: "${data[key]}"`)
        console.log(`                 -> "${next}"`)
      }
      if (!DRY_RUN) await doc.ref.update(update)
    }
  }

  console.log(`\n[fix-crmc] scanned ${scanned} docs, ${changed} ${changed === 1 ? 'doc' : 'docs'} with "CRMC"${DRY_RUN ? ' (none written -- dry run)' : ' updated'}.`)
  if (DRY_RUN && changed > 0) console.log('[fix-crmc] Re-run without --dry-run to apply.')
}

main().catch((err) => { console.error('[fix-crmc] FATAL:', err); process.exit(1) })
