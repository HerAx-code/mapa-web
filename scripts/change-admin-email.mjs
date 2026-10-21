#!/usr/bin/env node
/**
 * change-admin-email.mjs  (one-off operational migration)
 *
 * Changes a user's login email in BOTH Firebase Auth and their
 * users/{uid} Firestore doc, atomically from the operator's point of
 * view (Auth first, then the doc). Built for the de-CRMC super-admin
 * rename: admin@crmc.gov.ph -> admin@mapa.gov.ph. Password is untouched.
 *
 * Idempotent: if `--from` no longer exists but `--to` already does, it
 * reports "already changed" and exits 0.
 *
 * Usage (PowerShell):
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
 *   $env:GOOGLE_CLOUD_PROJECT = "mapa-crmc"
 *   node scripts/change-admin-email.mjs --dry-run      # preview
 *   node scripts/change-admin-email.mjs                # apply
 *
 * Override the addresses:
 *   node scripts/change-admin-email.mjs --from old@x.ph --to new@y.ph
 *
 * Flags:
 *   --dry-run   preview, no writes
 *   --from <e>  current email (default admin@crmc.gov.ph)
 *   --to   <e>  new email     (default admin@mapa.gov.ph)
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const FROM = argVal('--from', 'admin@crmc.gov.ph')
const TO   = argVal('--to',   'admin@mapa.gov.ph')

initializeApp({ credential: applicationDefault() })
const auth = getAuth()
const db   = getFirestore()

async function main() {
  console.log(`[email] ${DRY_RUN ? 'DRY RUN -- no writes' : 'APPLYING'}: ${FROM} -> ${TO}\n`)

  // 1. Resolve the account. Idempotency: if FROM is gone but TO exists, done.
  let user
  try {
    user = await auth.getUserByEmail(FROM)
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      try {
        const already = await auth.getUserByEmail(TO)
        console.log(`[email] '${FROM}' not found, but '${TO}' already exists (uid ${already.uid}). Nothing to do.`)
        return
      } catch {
        console.error(`[email] FATAL: neither '${FROM}' nor '${TO}' exists. Check the --from address.`)
        process.exitCode = 1; return
      }
    }
    throw err
  }

  const uid = user.uid
  console.log(`[email] Found uid ${uid} (role check: users/${uid})`)

  // 2. Guard: make sure TO isn't already taken by a DIFFERENT account.
  try {
    const clash = await auth.getUserByEmail(TO)
    if (clash.uid !== uid) {
      console.error(`[email] FATAL: '${TO}' is already used by a different account (uid ${clash.uid}). Aborting.`)
      process.exitCode = 1; return
    }
  } catch { /* not found -- good, TO is free */ }

  // 3. Peek at the user doc.
  const docRef = db.doc(`users/${uid}`)
  const snap = await docRef.get()
  const docEmail = snap.exists ? snap.data().email : '(no users doc!)'
  const role = snap.exists ? snap.data().role : '(unknown)'
  console.log(`[email] users/${uid}: role=${role}  email=${docEmail}`)

  if (DRY_RUN) {
    console.log(`\n[email] WOULD update Auth email -> ${TO} (emailVerified=true)`)
    console.log(`[email] WOULD update users/${uid}.email -> ${TO}`)
    console.log('\n[email] Dry run complete. Re-run without --dry-run to apply.')
    return
  }

  // 4. Apply: Auth first (the source of truth for login), then the doc.
  await auth.updateUser(uid, { email: TO, emailVerified: true })
  console.log(`[email] ✅ Auth email updated -> ${TO}`)
  if (snap.exists) {
    await docRef.update({ email: TO })
    console.log(`[email] ✅ users/${uid}.email updated -> ${TO}`)
  } else {
    console.warn(`[email] ⚠ no users/${uid} doc to update (Auth changed only).`)
  }
  console.log(`\n[email] Done. Sign in with ${TO} (password unchanged).`)
}

main().catch((err) => { console.error('[email] FATAL:', err); process.exit(1) })
