#!/usr/bin/env node
/**
 * bootstrap-users.js
 *
 * Creates the seed admin / agency_admin / agency / patient accounts via
 * the Firebase Admin SDK. Replaces the user-creation portion of the web
 * /seed page (src/pages/Seed.jsx), which became incompatible with the
 * tightened users/create Firestore rule.
 *
 * Background:
 *   The previous /seed page signed in as each new user (via
 *   createUserWithEmailAndPassword) then called setDoc on /users/{uid}
 *   while their own auth session was live. That worked under the old
 *   rule 'allow create: if isAuth()' because uid() == userId held for
 *   each write. After the rule is tightened to require role=='patient'
 *   on self-create, the seed flow breaks for every non-patient user.
 *
 *   This script bypasses the rule entirely (admin SDK does), creates
 *   both the Auth user and the Firestore user doc in one shot, and
 *   doesn't need to juggle web sessions.
 *
 * Idempotent: if an Auth account exists for an email, the script
 * repairs the Firestore profile if missing and leaves Auth alone. Safe
 * to re-run.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/bootstrap-users.js
 *
 * The script does NOT seed agencies, document types, assistance types,
 * or hospital IDs -- those still work fine from the /seed web page
 * because they use isAdmin paths that don't break under the new rule.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { USERS } from './demo-accounts.js'

initializeApp({ credential: applicationDefault() })
const auth = getAuth()
const db = getFirestore()

async function main() {
  console.log(`[bootstrap-users] Processing ${USERS.length} accounts...`)
  let created = 0
  let repaired = 0
  let skipped = 0
  let failed = 0

  for (const u of USERS) {
    let uid
    let authExisted = false
    try {
      const record = await auth.getUserByEmail(u.email)
      uid = record.uid
      authExisted = true
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        // Create the Auth user
        try {
          const record = await auth.createUser({ email: u.email, password: u.password, displayName: u.profile.name })
          uid = record.uid
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

    // Write/repair the Firestore profile
    try {
      const ref = db.doc(`users/${uid}`)
      const snap = await ref.get()
      // active comes from the canonical profile (deactivated demo
      // accounts, e.g. the reframed malasakit hub logins, must stay
      // active:false). Default true for older entries that omit it.
      const data = { ...u.profile, email: u.email, active: u.profile.active ?? true, createdAt: new Date() }
      if (snap.exists) {
        if (!authExisted) {
          await ref.set(data, { merge: true })
          repaired++
          console.log(`  🔧 ${u.email}: Auth created, Firestore profile already existed — merged`)
        } else {
          skipped++
          console.log(`  ⚠️  ${u.email}: already complete`)
        }
      } else {
        await ref.set(data)
        if (authExisted) {
          repaired++
          console.log(`  🔧 ${u.email}: Auth existed, Firestore profile was missing — repaired`)
        } else {
          created++
          console.log(`  ✅ ${u.email}: created`)
        }
      }
    } catch (e) {
      console.error(`  ❌ ${u.email}: Firestore write failed — ${e.message}`)
      failed++
    }
  }

  console.log(`\nDone. created=${created} repaired=${repaired} skipped=${skipped} failed=${failed}`)
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})