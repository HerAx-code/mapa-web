#!/usr/bin/env node
/**
 * repair-demo-accounts.js
 *
 * Force-restore EVERY demo account to its canonical state. Unlike
 * bootstrap-users.js (which is idempotent and won't touch existing
 * Auth passwords or existing Firestore profiles), this script
 * AGGRESSIVELY overwrites both:
 *
 *   - Auth: re-sets the password to the canonical value via
 *     admin.auth().updateUser(uid, { password }). Existing UID is
 *     preserved so audit-log entries / conversations / requests that
 *     reference it keep working.
 *
 *   - Firestore: setDoc with { merge: true } so canonical fields
 *     overwrite drift but extra fields the profile accumulated
 *     (address, photoURL, hospitalId on a patient, etc.) survive.
 *     Without merge we'd wipe real test data on accounts that have
 *     been exercised through the patient flow. Preserves createdAt
 *     if already set so the audit story of "when was this account
 *     first seeded?" survives the repair.
 *
 * USE WHEN:
 *   - A demo account's password drifted (manual reset, console
 *     change, /admin/accounts Reset Password fired against a real
 *     inbox the test team can't access)
 *   - A demo account's Firestore profile drifted (someone changed the
 *     role / agencyId via /admin/accounts; a patient registration
 *     accidentally reused a demo email and overwrote the profile)
 *   - Before a thesis-defense run, to guarantee the login page's
 *     demo cards work exactly as labeled
 *
 * DO NOT USE WHEN:
 *   - You have real (non-demo) accounts using any of these emails.
 *     The script does not distinguish "real" from "drifted demo" --
 *     it overwrites unconditionally. For the MAPA pilot where these
 *     11 emails are demo-only, that's safe.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/repair-demo-accounts.js
 *
 * Add --dry-run to see what would change without writing anything:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/repair-demo-accounts.js --dry-run
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { USERS } from './demo-accounts.js'

const DRY_RUN = process.argv.includes('--dry-run')

initializeApp({ credential: applicationDefault() })
const auth = getAuth()
const db   = getFirestore()

// Pretty-print the diff between current and canonical so the operator
// sees exactly what would change. Since we use { merge: true }, only
// fields PRESENT in canonical are written -- extras in `current`
// (address, photoURL, etc.) are preserved, not deleted, so the diff
// should not flag them as changes.
function profileDiff(current, canonical) {
  const changes = []
  for (const k of Object.keys(canonical)) {
    if (k === 'createdAt' || k === 'email') continue
    const a = current?.[k]
    const b = canonical[k]
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push(`${k}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`)
    }
  }
  return changes
}

async function main() {
  console.log(`[repair-demo-accounts] ${DRY_RUN ? 'DRY RUN -- no writes' : 'APPLYING repairs'}`)
  console.log(`[repair-demo-accounts] Processing ${USERS.length} accounts...\n`)

  let authReset = 0
  let authCreated = 0
  let profileRewrote = 0
  let profileClean = 0
  let failed = 0

  for (const u of USERS) {
    let uid
    let authExisted = false

    // 1. Resolve / create the Auth user
    try {
      const record = await auth.getUserByEmail(u.email)
      uid = record.uid
      authExisted = true
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        if (DRY_RUN) {
          authCreated++
          console.log(`  ➕ ${u.email}: WOULD CREATE Auth user (was missing)`)
          continue
        }
        try {
          const record = await auth.createUser({
            email: u.email, password: u.password, displayName: u.profile.name,
          })
          uid = record.uid
          authCreated++
          console.log(`  ✅ ${u.email}: created fresh Auth user`)
        } catch (createErr) {
          console.error(`  ❌ ${u.email}: failed to create Auth user — ${createErr.message}`)
          failed++
          continue
        }
      } else {
        console.error(`  ❌ ${u.email}: failed Auth lookup — ${e.message}`)
        failed++
        continue
      }
    }

    // 2. Force-reset the Auth password (no diff check -- we can't read
    //    the existing password, and the whole point of this script is
    //    to guarantee the canonical value works)
    if (authExisted) {
      if (DRY_RUN) {
        authReset++
        console.log(`  🔑 ${u.email}: WOULD RESET Auth password to "${u.password}"`)
      } else {
        try {
          await auth.updateUser(uid, { password: u.password, displayName: u.profile.name })
          authReset++
        } catch (e) {
          console.error(`  ❌ ${u.email}: Auth password reset failed — ${e.message}`)
          failed++
          continue
        }
      }
    }

    // 3. Read current Firestore profile and compare to canonical
    try {
      const ref = db.doc(`users/${uid}`)
      const snap = await ref.get()
      const current = snap.exists ? snap.data() : null
      // active comes from the canonical profile so a repair does not
      // silently re-enable a deliberately deactivated demo account (the
      // reframed malasakit hub logins are active:false). Default true.
      const canonical = { ...u.profile, email: u.email, active: u.profile.active ?? true }

      const changes = profileDiff(current, canonical)

      if (changes.length === 0 && current) {
        profileClean++
        console.log(`  ${authExisted ? '🔑' : '✅'} ${u.email}: Auth ${authExisted ? 'password reset' : 'created'}, profile already clean`)
        continue
      }

      if (DRY_RUN) {
        profileRewrote++
        console.log(`  🔧 ${u.email}: WOULD REWRITE profile`)
        for (const c of changes) console.log(`       ${c}`)
        continue
      }

      // Preserve createdAt if it was set; stamp it fresh if this is a
      // new profile. Use { merge: true } so any extra profile fields
      // the account has accumulated (address, photoURL, hospitalId,
      // patientId, etc.) survive the repair -- we only want to fix
      // drift on the canonical fields, not wipe real test data.
      const createdAt = current?.createdAt ?? new Date()
      await ref.set({ ...canonical, createdAt }, { merge: true })
      profileRewrote++
      console.log(`  🔧 ${u.email}: profile merged (${changes.length} field${changes.length === 1 ? '' : 's'} changed; extras preserved)`)
      for (const c of changes) console.log(`       ${c}`)
    } catch (e) {
      console.error(`  ❌ ${u.email}: Firestore write failed — ${e.message}`)
      failed++
    }
  }

  console.log(`\n[repair-demo-accounts] Summary:`)
  const verb = DRY_RUN ? 'would' : 'did'
  console.log(`  Auth password resets ${verb}:  ${authReset}`)
  console.log(`  Auth users created ${verb}:    ${authCreated}`)
  console.log(`  Profile merges ${verb}:        ${profileRewrote}`)
  console.log(`  Profiles already OK:           ${profileClean}`)
  console.log(`  Failures:                      ${failed}`)
  if (DRY_RUN) {
    console.log(`\n  This was a DRY RUN. Re-run without --dry-run to apply.`)
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})