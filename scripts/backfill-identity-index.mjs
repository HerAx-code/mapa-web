// Input verification Phase 1 — index every existing patient for the
// duplicate-account check (functions/src/identityIndex.js does this for new
// writes; this covers accounts made before it was deployed). Idempotent.
//
// Needs the SAME key as the IDENTITY_KEY function secret, passed in the
// environment (never commit it):
//   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
//   $env:IDENTITY_KEY = '<the secret value>'
//   node scripts/backfill-identity-index.mjs            # dry run: counts only
//   node scripts/backfill-identity-index.mjs --apply
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { initializeApp, applicationDefault } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { handleIdentityIndex, profileValues, makeHmac } = require('../functions/src/identityIndex.js')

const APPLY = process.argv.includes('--apply')
const KEY = process.env.IDENTITY_KEY
if (APPLY && !KEY) { console.error('Set IDENTITY_KEY to the function secret value.'); process.exit(1) }

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

const patients = await db.collection('users').where('role', '==', 'patient').get()
const idDocs = (await db.collection('documents').where('pcnFingerprint', '!=', null).get()).docs
  .filter(d => d.data().patientId)
console.log(`patients: ${patients.size} · ID documents with a card fingerprint: ${idDocs.length}`)
if (!APPLY) { console.log('dry run — re-run with --apply'); process.exit(0) }

const hmac = makeHmac(KEY)
let n = 0
for (const p of patients.docs) {
  await handleIdentityIndex({ db, uid: p.id, values: profileValues(p.data()), hmac, FieldValue })
  if (++n % 50 === 0) console.log(`  ${n}/${patients.size} profiles`)
}
for (const d of idDocs) {
  await handleIdentityIndex({ db, uid: d.data().patientId, values: { pcn: d.data().pcnFingerprint }, hmac, FieldValue })
}
const flagged = (await db.collection('identityFlags').get()).docs.filter(d => d.data().matches?.length).length
console.log(`Indexed ${patients.size} patients and ${idDocs.length} ID cards. Flags with a possible match: ${flagged}.`)
