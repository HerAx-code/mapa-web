#!/usr/bin/env node
/**
 * compute-network-stats.mjs  (multi-hospital Phase 9)
 *
 * Builds networkStats/current — per-hospital counts for the platform admin's
 * Network page (patients, requests by stage, approved slices, peso approved; no
 * patient data). The scheduled Cloud Function refreshNetworkStats does this
 * every 6 hours once functions are deployed; until then run this by hand.
 * Same code: functions/src/networkStats.js. See docs/multi-hospital-network-plan.md.
 *
 * Prints the numbers by default; writes the summary doc only with --apply.
 * Read-only otherwise (count/sum aggregation queries, no document downloads).
 *
 * Usage (PowerShell), from the repo root:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
 *   $env:GOOGLE_CLOUD_PROJECT = "<project-id>"
 *   node scripts/compute-network-stats.mjs            # print
 *   node scripts/compute-network-stats.mjs --apply    # print + save
 */

import { createRequire } from 'node:module'
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, AggregateField, FieldValue } from 'firebase-admin/firestore'

const require = createRequire(import.meta.url)
const { computeNetworkStats, writeNetworkStats } = require('../functions/src/networkStats.js')

const APPLY = process.argv.slice(2).includes('--apply')

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

const peso = (n) => `₱${Math.round(n).toLocaleString('en-PH')}`

async function main() {
  const deps = { db, AggregateField, serverTimestamp: () => FieldValue.serverTimestamp() }
  const stats = APPLY ? await writeNetworkStats(deps) : await computeNetworkStats(deps)

  console.log('hospital             patients  in-review  in-funding  funded  closed  approved  ₱ approved')
  const row = (name, s) => console.log(
    `${name.padEnd(20)} ${String(s.patients).padStart(8)}  ${String(s.requests.inReview).padStart(9)}  ` +
    `${String(s.requests.inFunding).padStart(10)}  ${String(s.requests.funded).padStart(6)}  ` +
    `${String(s.requests.closed).padStart(6)}  ${String(s.approvedSlices).padStart(8)}  ${peso(s.amountApproved).padStart(11)}`)
  for (const [id, s] of Object.entries(stats.hospitals)) row(id, s)
  row('NETWORK', stats.totals)
  console.log(APPLY
    ? '\n[network-stats] ✅ Saved networkStats/current.'
    : '\n[network-stats] Printed only. Re-run with --apply to save networkStats/current.')
}

main().catch((err) => { console.error('[network-stats] FATAL:', err); process.exit(1) })
