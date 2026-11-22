#!/usr/bin/env node
// One-off resync for Phase 5 PR 5.2 (P5-B): make hospitalsPublic equal the
// hospitals now, with the same projection the onHospitalWritten trigger uses
// (src/shared/hospitalPublic.js, bundled into functions/src/generated/shared.cjs).
// Lists listings to write, ones that differ, and ones to remove (deleted
// hospitals, the training hospital).
//
// Report-only by default; pass --write to apply.
//
//   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
//   node scripts/resync-hospitals-public.mjs            # report
//   node scripts/resync-hospitals-public.mjs --write    # apply
import { createRequire } from 'node:module'
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const { projectPublicHospital, isPublishedHospital } = createRequire(import.meta.url)('../functions/src/generated/shared.cjs')
const write = process.argv.includes('--write')
initializeApp({ credential: applicationDefault() })
const db = getFirestore()

const [hospitals, listed] = await Promise.all([db.collection('hospitals').get(), db.collection('hospitalsPublic').get()])
const listedById = new Map(listed.docs.map((d) => [d.id, d.data()]))
// Compare field by field, ignoring key order and updatedAt.
const canon = (o) => { const { updatedAt, ...rest } = o ?? {}; return JSON.stringify(Object.keys(rest).sort().map((k) => [k, rest[k]])) }
let toWrite = 0, toRemove = 0, same = 0
const keep = new Set()
for (const h of hospitals.docs) {
  if (!isPublishedHospital(h.data())) continue
  keep.add(h.id)
  const want = projectPublicHospital(h.data())
  const have = listedById.get(h.id)
  if (have && canon(have) === canon(want)) { same++; continue }
  toWrite++
  console.log(`  ${have ? '≠' : '+'} ${h.id}: ${have ? 'differs' : 'missing'} → ${want.facilityName} (${want.accessCodePrefix}, ${want.enabled ? 'open' : 'paused'})`)
  if (write) await db.doc(`hospitalsPublic/${h.id}`).set({ ...want, updatedAt: FieldValue.serverTimestamp() })
}
for (const id of listedById.keys()) {
  if (keep.has(id)) continue
  toRemove++
  console.log(`  − ${id}: no published hospital — remove`)
  if (write) await db.doc(`hospitalsPublic/${id}`).delete()
}
console.log(`\n${hospitals.size} hospitals; ${same} listings current, ${toWrite} to write, ${toRemove} to remove.`)
console.log(write ? 'Written.' : 'Report only. Run with --write to apply.')
process.exit(0)
