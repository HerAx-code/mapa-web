#!/usr/bin/env node
/**
 * check-demo-accounts.js
 *
 * Read-only health check for the 11 demo accounts. For each account:
 *   1. Try to sign in via Firebase Auth with the canonical password
 *   2. If sign-in succeeds, read users/{uid} and report the role/name
 *   3. If sign-in fails, report the Auth error code
 *
 * Designed to run without service-account.json -- it uses the same
 * Firebase Web SDK + .env config the React app uses, so any machine
 * that can `npm run dev` can run this.
 *
 * Usage:
 *   node scripts/check-demo-accounts.js
 *
 * Output is a per-account verdict (OK / WRONG_ROLE / BAD_PASSWORD /
 * NO_PROFILE / etc.) plus a summary. Use the output to decide whether
 * to run scripts/repair-demo-accounts.js (which needs service-account
 * credentials) or fix individual accounts via the Firebase Console.
 *
 * Side effect: signs the local Firebase Auth session in and out for
 * each account. If you have a real browser session open against the
 * same Firebase project, this won't disturb it -- the script runs in
 * its own Node Auth context.
 */

import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { getFirestore, doc, getDoc } from 'firebase/firestore'
import { USERS } from './demo-accounts.js'

// Load .env values into process.env without requiring `dotenv`.
function loadDotenv(path) {
  try {
    const text = readFileSync(path, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const key = line.slice(0, eq).trim()
      const val = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
      if (!(key in process.env)) process.env[key] = val
    }
  } catch (e) {
    console.error(`[check-demo-accounts] could not read .env at ${path}: ${e.message}`)
    process.exit(1)
  }
}

loadDotenv('.env')

const firebaseConfig = {
  apiKey:            process.env.VITE_FIREBASE_API_KEY,
  authDomain:        process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.VITE_FIREBASE_APP_ID,
}

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error('[check-demo-accounts] missing VITE_FIREBASE_* in .env')
  process.exit(1)
}

const app  = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db   = getFirestore(app)

function verdict(symbol, label, detail) {
  console.log(`  ${symbol} ${label.padEnd(42)} ${detail}`)
}

async function checkOne(u) {
  const expected = u.profile.role
  const expectedName = u.profile.name

  // Step 1: Auth check
  let cred
  try {
    cred = await signInWithEmailAndPassword(auth, u.email, u.password)
  } catch (e) {
    const code = e.code ?? 'unknown'
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      verdict('🔑', u.email, `BAD_PASSWORD  (expected "${u.password}")`)
      return { ok: false, kind: 'bad_password' }
    }
    if (code === 'auth/user-not-found') {
      verdict('❓', u.email, `AUTH_USER_MISSING  (Auth account doesn't exist)`)
      return { ok: false, kind: 'missing' }
    }
    if (code === 'auth/too-many-requests') {
      verdict('⏸️ ', u.email, `RATE_LIMITED  (Firebase throttled this email; wait + retry)`)
      return { ok: false, kind: 'rate_limited' }
    }
    verdict('❌', u.email, `AUTH_ERROR  (${code})`)
    return { ok: false, kind: 'auth_error' }
  }

  // Step 2: Firestore profile check
  const uid = cred.user.uid
  let snap
  try {
    snap = await getDoc(doc(db, 'users', uid))
  } catch (e) {
    await signOut(auth).catch(() => {})
    verdict('❌', u.email, `FIRESTORE_READ_FAILED  (${e.code ?? e.message})`)
    return { ok: false, kind: 'firestore_error' }
  }

  await signOut(auth).catch(() => {})

  if (!snap.exists()) {
    verdict('🕳️ ', u.email, `NO_PROFILE  (Auth OK but users/${uid.slice(0, 6)}… missing)`)
    return { ok: false, kind: 'no_profile' }
  }

  const data = snap.data()
  const actualRole = data.role ?? '<missing>'
  const actualName = data.name ?? '<missing>'

  if (actualRole !== expected) {
    verdict('⚠️ ', u.email, `WRONG_ROLE   (expected ${expected}, got ${actualRole})`)
    return { ok: false, kind: 'wrong_role' }
  }
  if (actualName !== expectedName) {
    verdict('⚠️ ', u.email, `WRONG_NAME   (expected "${expectedName}", got "${actualName}")`)
    return { ok: false, kind: 'wrong_name' }
  }

  // Optional: flag soft-delete / cooldown so the operator knows the
  // account would route to the deletion error message at login time.
  if (data.deletion === true) {
    verdict('🛑', u.email, `MARKED_FOR_DELETION  (role=${actualRole}, but deletion=true)`)
    return { ok: false, kind: 'marked_for_deletion' }
  }
  if (Number(data.cooldown) > 0) {
    verdict('⚠️ ', u.email, `ON_HOLDING_PERIOD  (role=${actualRole}, cooldown=${data.cooldown})`)
    return { ok: false, kind: 'holding' }
  }

  verdict('✅', u.email, `OK  (${actualRole} · "${actualName}")`)
  return { ok: true }
}

async function main() {
  console.log(`[check-demo-accounts] Checking ${USERS.length} demo accounts against ${firebaseConfig.projectId}...\n`)

  const results = []
  for (const u of USERS) {
    const r = await checkOne(u)
    results.push({ email: u.email, ...r })
  }

  const ok      = results.filter(r => r.ok).length
  const bad     = results.filter(r => !r.ok)
  console.log(`\n[check-demo-accounts] Summary:`)
  console.log(`  ✅ OK:      ${ok} / ${USERS.length}`)
  if (bad.length > 0) {
    console.log(`  ❌ Issues:  ${bad.length}`)
    const byKind = {}
    for (const b of bad) byKind[b.kind] = (byKind[b.kind] ?? 0) + 1
    for (const [kind, n] of Object.entries(byKind)) {
      console.log(`     - ${kind}: ${n}`)
    }
    console.log(`\n  To fix: run scripts/repair-demo-accounts.js with`)
    console.log(`  GOOGLE_APPLICATION_CREDENTIALS pointing at your`)
    console.log(`  service-account.json. (See top of that script for usage.)`)
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})