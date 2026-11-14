#!/usr/bin/env node
/**
 * create-platform-admin.mjs  (multi-hospital Phase 6)
 *
 * Creates a network operator account (role `platform_admin`). This is the ONLY
 * way to create one: the Firestore rules let no client — not even a hospital
 * super admin — write that role. See docs/multi-hospital-network-plan.md.
 *
 * Use a dedicated account (not a hospital admin's or a patient's login): the
 * script refuses an email whose user doc already carries another role.
 *
 * DRY RUN by default; writes only with --apply. Prints a one-time password
 * setup link — hand it to the operator privately (never by chat/email to a
 * group). They must then enroll MFA (Account → Security), like all staff.
 *
 * Usage (PowerShell), from the repo root:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path .\service-account.json).Path
 *   $env:GOOGLE_CLOUD_PROJECT = "<project-id>"
 *   node scripts/create-platform-admin.mjs --email ops@example.org --name "Network Ops"
 *   node scripts/create-platform-admin.mjs --email ops@example.org --name "Network Ops" --apply
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const val = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt }
const EMAIL = val('--email', '').trim().toLowerCase()
const NAME  = val('--name', 'Super Administrator').trim()

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(EMAIL)) {
  console.error('[platform-admin] --email <address> is required.')
  process.exit(1)
}

initializeApp({ credential: applicationDefault() })
const auth = getAuth()
const db = getFirestore()

async function main() {
  console.log(`[platform-admin] ${APPLY ? 'APPLYING' : 'DRY RUN -- no writes'}: ${EMAIL} (${NAME})\n`)

  let authUser = null
  try { authUser = await auth.getUserByEmail(EMAIL) } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e
  }
  const profileSnap = authUser ? await db.doc(`users/${authUser.uid}`).get() : null
  const role = profileSnap?.exists ? profileSnap.data().role : null

  if (role && role !== 'platform_admin') {
    console.error(`[platform-admin] REFUSED: ${EMAIL} is already a '${role}' account. Use a dedicated email for the network operator.`)
    process.exit(1)
  }
  if (role === 'platform_admin') {
    console.log(`[platform-admin] ${EMAIL} is already a platform_admin (uid ${authUser.uid}). Nothing to do.`)
    return
  }

  console.log(`  Auth account: ${authUser ? `exists (uid ${authUser.uid})` : 'will be created'}`)
  console.log('  users doc:    will be created with role platform_admin (no tenantId)')
  if (!APPLY) {
    console.log('\n[platform-admin] Re-run with --apply to create it.')
    return
  }

  if (!authUser) authUser = await auth.createUser({ email: EMAIL, displayName: NAME, emailVerified: false })
  await db.doc(`users/${authUser.uid}`).set({
    name:      NAME,
    email:     EMAIL,
    role:      'platform_admin',
    agencyId:  null,
    rank:      null,
    contact:   '',
    active:    true,
    deletion:  false,
    cooldown:  0,
    createdAt: FieldValue.serverTimestamp(),
  })
  const link = await auth.generatePasswordResetLink(EMAIL)
  console.log(`\n[platform-admin] ✅ Created platform_admin ${EMAIL} (uid ${authUser.uid}).`)
  console.log('  Password setup link (share privately, single use):')
  console.log(`  ${link}`)
}

main().catch((err) => { console.error('[platform-admin] FATAL:', err); process.exit(1) })
