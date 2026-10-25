#!/usr/bin/env node
/**
 * restore-super-admin.mjs  (one-off recovery)
 *
 * Recovers a super_admin whose Firebase Auth login was deleted directly in
 * the console (which does NOT cascade to the Firestore users/{uid} doc, so
 * the profile is left orphaned — still role super_admin, just no login).
 *
 * Primary path: recreate the Auth user with the SAME uid, which re-links it
 * to the existing orphaned users/{uid} doc. No doc rewrite needed.
 * Fallback: if the users doc is also gone, create a fresh Auth user + write
 * a new super_admin profile doc.
 *
 * Password: pass --password, or one is generated and PRINTED so you can sign
 * in and change it. The account is created emailVerified.
 *
 * Usage (PowerShell):
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
 *   $env:GOOGLE_CLOUD_PROJECT = "mapa-crmc"
 *   node scripts/restore-super-admin.mjs --dry-run     # preview state + plan
 *   node scripts/restore-super-admin.mjs               # apply (prints password)
 *   node scripts/restore-super-admin.mjs --password "YourStrongPass123!"
 *
 * Flags: --dry-run · --uid <id> · --email <e> · --password <pw>
 * Defaults target the known deleted super_admin.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import crypto from 'node:crypto'

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')
const val = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 && argv[i+1] ? argv[i+1] : dflt }

const UID   = val('--uid',   'ojDmbVEJGxZ0d0NCoWQJCIqPI9y1')
const EMAIL = val('--email', 'admin@mapa.gov.ph')
let   PASSWORD = val('--password', null)
let   GENERATED = false
if (!PASSWORD) {
  // strong, readable-ish random password
  PASSWORD = 'Mapa-' + crypto.randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, '') + '!2'
  GENERATED = true
}

initializeApp({ credential: applicationDefault() })
const auth = getAuth()
const db   = getFirestore()

async function main() {
  console.log(`[restore] ${DRY_RUN ? 'DRY RUN -- no writes' : 'APPLYING'}: restore super_admin ${EMAIL} (uid ${UID})\n`)

  // 1. If the login already exists, there's nothing to restore.
  try {
    const existing = await auth.getUserByEmail(EMAIL)
    console.log(`[restore] '${EMAIL}' already exists (uid ${existing.uid}). Nothing to restore.`)
    console.log(`[restore] If you still can't sign in, the issue is the password or the users/${existing.uid} doc — not a missing account.`)
    return
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err
  }

  // 2. Inspect the orphaned profile doc.
  const docRef = db.doc(`users/${UID}`)
  const snap = await docRef.get()
  const docExists = snap.exists
  const role = docExists ? snap.data().role : null
  console.log(`[restore] users/${UID}: ${docExists ? `exists (role=${role}, email=${snap.data().email})` : 'MISSING'}`)

  const plan = docExists
    ? `recreate Auth with SAME uid ${UID} -> re-links to the existing profile doc${role !== 'super_admin' ? ' (and set role=super_admin)' : ''}`
    : `create a FRESH Auth user + write a new super_admin profile doc`

  if (DRY_RUN) {
    console.log(`\n[restore] WOULD: ${plan}`)
    console.log(`[restore] password: ${GENERATED ? '(auto-generated, printed on apply)' : '(provided via --password)'}`)
    console.log('\n[restore] Dry run complete. Re-run without --dry-run to apply.')
    return
  }

  if (docExists) {
    await auth.createUser({ uid: UID, email: EMAIL, password: PASSWORD, emailVerified: true })
    console.log(`[restore] ✅ Auth login recreated with uid ${UID} (re-linked to the existing profile).`)
    if (role !== 'super_admin') {
      await docRef.update({ role: 'super_admin' })
      console.log(`[restore] ✅ users/${UID}.role -> super_admin`)
    }
  } else {
    const created = await auth.createUser({ email: EMAIL, password: PASSWORD, emailVerified: true })
    await db.doc(`users/${created.uid}`).set({
      name: 'Super Admin', role: 'super_admin', rank: 'high',
      agencyId: null, contact: null, cooldown: 0, deletion: false,
      email: EMAIL, createdAt: FieldValue.serverTimestamp(),
    })
    console.log(`[restore] ✅ Fresh super_admin created (new uid ${created.uid}) + profile doc written.`)
  }

  console.log(`\n[restore] Done. Sign in:`)
  console.log(`           email:    ${EMAIL}`)
  console.log(`           password: ${PASSWORD}`)
  console.log(`[restore] Change this password after signing in.`)
}

main().catch((err) => { console.error('[restore] FATAL:', err); process.exit(1) })
