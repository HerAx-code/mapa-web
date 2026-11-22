#!/usr/bin/env node
// One-off seed for Phase 3 PR 3.4 (P3-F, gap M10): the per-prefix access-code
// counter that issueAccessCode draws from. For every prefix + year already in
// use (from existing hospitalIds), it sets accessCodeCounters/{PREFIX}__{YEAR}
// to one past the highest number issued, so the server never reissues a number
// (including a deleted one) and two desks can't collide.
//
// Idempotent: it only ever raises a counter, never lowers one, so re-running is
// safe. A brand-new prefix with no codes needs no seed — issueAccessCode starts
// its counter at 1 on its own the first time (the transaction creates it when
// the prefix has no codes for that year).
//
// Report-only by default; pass --write to apply.
//
//   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
//   node scripts/seed-code-counters.mjs            # report
//   node scripts/seed-code-counters.mjs --write    # apply
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const write = process.argv.includes('--write')
initializeApp({ credential: applicationDefault() })
const db = getFirestore()

// id shape: <PREFIX>-<YYYY>-<NNNNN>
const CODE_RE = /^([A-Z][A-Z0-9]{1,9})-(\d{4})-(\d{5})$/

const highest = new Map() // `${prefix}__${year}` -> max number seen
const snap = await db.collection('hospitalIds').get()
for (const d of snap.docs) {
  const m = CODE_RE.exec(d.id)
  if (!m) continue
  const key = `${m[1]}__${m[2]}`
  const num = parseInt(m[3], 10)
  if (!highest.has(key) || num > highest.get(key)) highest.set(key, num)
}

if (highest.size === 0) {
  console.log('No existing access codes found — nothing to seed. New prefixes start at 1 automatically.')
  process.exit(0)
}

let changed = 0
let kept = 0
for (const [key, max] of [...highest.entries()].sort()) {
  const ref = db.doc(`accessCodeCounters/${key}`)
  const cur = await ref.get()
  const curNext = cur.exists ? Number(cur.data().next) || 0 : 0
  const want = max + 1
  if (curNext >= want) {
    kept++
    console.log(`  = ${key}: counter ${curNext} already ≥ ${want} (highest code ${String(max).padStart(5, '0')})`)
    continue
  }
  changed++
  console.log(`  ${write ? '✓' : '→'} ${key}: next ${curNext || '(none)'} → ${want} (highest code ${String(max).padStart(5, '0')})`)
  if (write) await ref.set({ next: want, updatedAt: new Date(), seededFrom: max }, { merge: true })
}

console.log(`\n${changed} counter(s) ${write ? 'seeded' : 'to seed'}, ${kept} already current.`)
if (!write && changed) console.log('Re-run with --write to apply.')
process.exit(0)
