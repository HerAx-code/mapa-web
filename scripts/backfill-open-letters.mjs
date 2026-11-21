#!/usr/bin/env node
// One-off backfill for Phase 2 PR 2.1 (decision D4): stamp `openLetters` on
// every request, so a fully funded case with a letter still open counts as
// active (not finished) from now on. syncRequestFinancials keeps it current
// after this, on every slice write.
//
// Report-only by default; pass --write to apply.
//
//   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
//   node scripts/backfill-open-letters.mjs            # report
//   node scripts/backfill-open-letters.mjs --write    # apply
//
// Uses the same shared definition as the functions (functions/src/generated/
// shared.cjs, built from src/shared/caseState.js).
import { createRequire } from 'node:module'
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const { openLettersOf, isRequestFinished } = createRequire(import.meta.url)('../functions/src/generated/shared.cjs')
const write = process.argv.includes('--write')

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

const [requests, slices] = await Promise.all([db.collection('requests').get(), db.collection('applications').get()])
const byRequest = new Map()
for (const s of slices.docs) {
  const id = s.data().requestId
  if (!id) continue
  if (!byRequest.has(id)) byRequest.set(id, [])
  byRequest.get(id).push(s.data())
}

let changed = 0
let reopened = 0
const batch = db.batch()
for (const r of requests.docs) {
  const req = r.data()
  const open = openLettersOf(byRequest.get(r.id) ?? [])
  if ((req.openLetters ?? 0) === open && req.openLetters !== undefined) continue
  const wasFinished = isRequestFinished(req)
  const nowFinished = isRequestFinished({ ...req, openLetters: open })
  if (wasFinished && !nowFinished) {
    reopened++
    console.log(`  ↺ ${req.requestId ?? r.id}: fully funded with ${open} open letter(s) — active until they are settled`)
  }
  batch.update(r.ref, { openLetters: open })
  changed++
}

console.log(`\n${requests.size} requests; ${changed} get openLetters; ${reopened} fully funded case(s) become active again (D4).`)
if (!write) {
  console.log('Report only. Run with --write to apply.')
  process.exit(0)
}
if (changed) await batch.commit()
console.log('Written.')
process.exit(0)
