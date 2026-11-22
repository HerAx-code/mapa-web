#!/usr/bin/env node
// One-off repair for Phase 2 (decision P2-D): recompute each agency's
// budget.committed and budget.disbursed from its slices, the same definitions
// the money functions use (committedOf / disbursedOf in src/shared/caseState.js,
// bundled into functions/src/generated/shared.cjs).
//
// Before Phase 2 PR 2.3 the counts moved only when an allocation was set, and
// the browser sweep, the server sweep and the agency pages did the arithmetic
// differently (gap M3), so live counts drifted.
//
//   committed = approved letters still open (issued, not redeemed or expired)
//   disbursed = what providers billed on letters redeemed in the CURRENT
//               budget period (budget.periodStart; all of them if none is set).
//               A redeemed letter with no redemption date is counted, and listed.
//
// Each agency is fixed in its own transaction that re-reads the agency and its
// slices, so an approval landing at the same moment is not lost.
//
// Report-only by default; pass --write to apply.
//
//   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
//   node scripts/reconcile-agency-budgets.mjs            # report
//   node scripts/reconcile-agency-budgets.mjs --write    # apply
//   ... --skip=agencyId[,agencyId]                       # leave these agencies alone
import { createRequire } from 'node:module'
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const { committedOf, disbursedOf } = createRequire(import.meta.url)('../functions/src/generated/shared.cjs')
const write = process.argv.includes('--write')
const skip = new Set((process.argv.find((a) => a.startsWith('--skip=')) ?? '').slice('--skip='.length).split(',').filter(Boolean))

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

const millis = (ts) => (ts?.toMillis ? ts.toMillis() : ts?.toDate ? ts.toDate().getTime() : typeof ts?.seconds === 'number' ? ts.seconds * 1000 : null)
const peso = (n) => `₱${(Number(n) || 0).toLocaleString('en-PH')}`

function expected(agency, slices) {
  const periodStart = millis(agency.budget?.periodStart)
  let committed = 0
  let disbursed = 0
  const undated = []
  for (const s of slices) {
    committed += committedOf(s)
    const d = disbursedOf(s)
    if (!d) continue
    const at = millis(s.glRedeemedAt)
    if (at == null) { undated.push(s.appId ?? '?'); disbursed += d; continue }
    if (periodStart == null || at >= periodStart) disbursed += d
  }
  return { committed, disbursed, undated }
}

const agencies = await db.collection('agencies').get()
let off = 0
let fixed = 0
for (const a of agencies.docs) {
  const agency = a.data()
  const name = agency.name ?? a.id
  if (skip.has(a.id)) { console.log(`  – ${name}: skipped (--skip)`); continue }
  const slices = (await db.collection('applications').where('agencyId', '==', a.id).get()).docs.map((d) => d.data())
  const want = expected(agency, slices)
  const have = { committed: Number(agency.budget?.committed) || 0, disbursed: Number(agency.budget?.disbursed) || 0 }
  const same = have.committed === want.committed && have.disbursed === want.disbursed
  const note = want.undated.length ? `  (redeemed without a date, counted: ${want.undated.join(', ')})` : ''
  if (same) { console.log(`  = ${name}: committed ${peso(have.committed)}, disbursed ${peso(have.disbursed)}${note}`); continue }
  off++
  console.log(`  ≠ ${name} [${a.id}]: committed ${peso(have.committed)} → ${peso(want.committed)}, disbursed ${peso(have.disbursed)} → ${peso(want.disbursed)}`
    + ` · allocation ${agency.budget?.allocated ? peso(agency.budget.allocated) : 'none'}${note}`)
  if (!write) continue
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(a.ref)
    const live = (await tx.get(db.collection('applications').where('agencyId', '==', a.id))).docs.map((d) => d.data())
    const now = expected(fresh.data(), live)
    tx.update(a.ref, { 'budget.committed': now.committed, 'budget.disbursed': now.disbursed })
  })
  fixed++
}

console.log(`\n${agencies.size} agencies; ${off} with counts that differ from their slices.`)
if (!write) {
  console.log('Report only. Run with --write to apply.')
} else {
  console.log(`Written: ${fixed}.`)
}
process.exit(0)
