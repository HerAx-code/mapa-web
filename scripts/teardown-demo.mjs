#!/usr/bin/env node
/**
 * teardown-demo.mjs
 *
 * Removes the demo network that was seeded onto a live project (bootstrap-users.js
 * + bootstrap-reference-data.js). Deletes:
 *   - the demo Auth accounts (demo-accounts.js USERS) and their users/{uid} profile
 *   - the two demo hospitals (demo-hospitals.js), their accessCodePrefixes claim,
 *     their hospitalsPublic listing, and their patient-bound access codes (+ the
 *     privateInfo/issued subdoc)
 *   - the demo agencies (doh, dswd, philhealth, ambag, pcso, malasakit)
 *
 * It deliberately does NOT touch shared reference data (documentTypes /
 * assistanceTypes). Those were seeded with merge:true and may overlap real
 * production values, so removing them is unsafe to do blindly — delete those by
 * hand if ever needed.
 *
 * REPORT-FIRST. The default run only lists what it would delete. Pass --write to
 * actually delete.
 *
 * Usage (PowerShell):
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
 *   node scripts/teardown-demo.mjs            # report (dry-run)
 *   node scripts/teardown-demo.mjs --write    # apply
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { USERS } from './demo-accounts.js'
import { DEMO_HOSPITALS, DEMO_CODES } from './demo-hospitals.js'

const WRITE = process.argv.includes('--write')

// Demo agency ids seeded by bootstrap-reference-data (src/data/agencies.seed.js),
// plus the reframed malasakit hub the demo accounts reference.
const DEMO_AGENCIES = ['doh', 'dswd', 'philhealth', 'ambag', 'pcso', 'malasakit']

function targetProject() {
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT
  try {
    return JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')).project_id
  } catch {
    return '(unknown)'
  }
}

initializeApp({ credential: applicationDefault() })
const auth = getAuth()
const db = getFirestore()

let n = 0
async function drop(label, fn) {
  console.log(`  ${WRITE ? '✓ deleting' : '→ would delete'}  ${label}`)
  n++
  if (WRITE) await fn()
}

async function main() {
  console.log(`[teardown-demo] project=${targetProject()}  mode=${WRITE ? 'APPLY (--write)' : 'REPORT (dry-run)'}\n`)

  // 1. Demo Auth accounts + their Firestore profile.
  console.log('Auth accounts + profiles:')
  for (const u of USERS) {
    let rec = null
    try { rec = await auth.getUserByEmail(u.email) } catch { rec = null }
    if (!rec) { console.log(`  · absent      ${u.email}`); continue }
    const uid = rec.uid
    await drop(`${u.email}  (uid ${uid}: auth + users/${uid})`, async () => {
      await db.doc(`users/${uid}`).delete().catch(() => {})
      await auth.deleteUser(uid).catch(() => {})
    })
  }

  // 2. Demo hospitals: the hospital doc, prefix claim, public listing.
  console.log('\nDemo hospitals:')
  for (const h of DEMO_HOSPITALS) {
    await drop(`hospitals/${h.id}`, () => db.doc(`hospitals/${h.id}`).delete())
    await drop(`hospitalsPublic/${h.id}`, () => db.doc(`hospitalsPublic/${h.id}`).delete())
    if (h.accessCodePrefix) {
      await drop(`accessCodePrefixes/${h.accessCodePrefix}`, () => db.doc(`accessCodePrefixes/${h.accessCodePrefix}`).delete())
    }
  }

  // 3. Demo access codes (+ the privateInfo/issued subdoc).
  console.log('\nDemo access codes:')
  for (const c of DEMO_CODES) {
    await drop(`hospitalIds/${c.id}`, async () => {
      await db.doc(`hospitalIds/${c.id}/privateInfo/issued`).delete().catch(() => {})
      await db.doc(`hospitalIds/${c.id}`).delete()
    })
  }

  // 4. Demo agencies (only if present).
  console.log('\nDemo agencies:')
  for (const id of DEMO_AGENCIES) {
    const snap = await db.doc(`agencies/${id}`).get()
    if (!snap.exists) { console.log(`  · absent      agencies/${id}`); continue }
    await drop(`agencies/${id}  ("${snap.get('name') ?? id}")`, () => db.doc(`agencies/${id}`).delete())
  }

  console.log(`\n[teardown-demo] ${WRITE ? 'Deleted' : 'Would delete'} ${n} items.`)
  if (!WRITE) console.log('[teardown-demo] Re-run with --write to apply.')
  console.log('[teardown-demo] Note: shared documentTypes/assistanceTypes are left in place (merge-seeded, may overlap real data).')
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1) })
