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
 * It also seeds the two-hospital demo network (scripts/demo-hospitals.js):
 * the hospitals, their access-code prefix claims, the public hospital list
 * and sample PATIENT-BOUND access codes (2026-11-15: a code is issued to a
 * named patient; claiming it needs their last name + birthdate). Agencies,
 * document types and assistance types still come from the /seed page.
 *
 * DEV / EMULATOR ONLY. The demo passwords are published in this repo, so the
 * script refuses to run against the production project (mapa-crmc) unless
 * the Firestore emulator is in use.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { USERS } from './demo-accounts.js'
import { DEMO_HOSPITALS, DEMO_CODES } from './demo-hospitals.js'
import { codeProof } from '../src/utils/codeIssue.js'

// Never seed published demo passwords into production.
const PRODUCTION_PROJECT = 'mapa-crmc'
function targetProject() {
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT
  try { return JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')).project_id } catch { return null }
}
if (!process.env.FIRESTORE_EMULATOR_HOST && targetProject() === PRODUCTION_PROJECT) {
  console.error(`[bootstrap-users] Refusing to run against ${PRODUCTION_PROJECT}: these demo accounts have published passwords. Use the emulator or a dev project.`)
  process.exit(1)
}

initializeApp({ credential: applicationDefault() })
const auth = getAuth()
const db = getFirestore()

// The demo network: hospitals, prefix claims, the public list, and sample
// patient-bound codes. Idempotent (merge / skip existing codes).
async function seedDemoNetwork() {
  for (const { id, ...h } of DEMO_HOSPITALS) {
    await db.doc(`hospitals/${id}`).set({ ...h, createdAt: new Date() }, { merge: true })
    await db.doc(`accessCodePrefixes/${h.accessCodePrefix}`).set({ tenantId: id }, { merge: true })
    const { facilityName, shortName, accessCodePrefix, enabled, gatewayName, address, region, contactEmail } = h
    await db.doc(`hospitalsPublic/${id}`).set({ facilityName, shortName, accessCodePrefix, enabled, gatewayName, address, region, contactEmail, updatedAt: new Date() })
  }
  let issued = 0
  for (const c of DEMO_CODES) {
    const ref = db.doc(`hospitalIds/${c.id}`)
    if ((await ref.get()).exists) continue
    const { firstName, lastName, birthdate } = c.patient
    const nameParts = { firstName, middleName: '', lastName, suffix: '' }
    const batch = db.batch()
    batch.set(ref, { status: 'available', patId: null, bound: true, tenantId: c.tenantId, date: '', time: '', createdAt: new Date() })
    batch.set(db.doc(`hospitalIds/${c.id}/privateInfo/issued`), {
      name: `${firstName} ${lastName}`, nameParts, birthdate, proof: codeProof(lastName, birthdate),
      contact: null, visitDate: new Date().toISOString().slice(0, 10), caseNumber: null,
      idType: 'PhilSys National ID', idLast4: null,
      issuedBy: 'Demo seed', issuedByUid: 'demo-seed', issuedAt: new Date(),
    })
    await batch.commit()
    issued++
  }
  console.log(`[bootstrap-users] Demo network: ${DEMO_HOSPITALS.length} hospitals, ${issued} new patient-bound codes (of ${DEMO_CODES.length}).`)
}

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

seedDemoNetwork().then(main).then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})