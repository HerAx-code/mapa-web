#!/usr/bin/env node
// Seed the LOCAL Firebase emulator suite with the two-hospital demo network and
// the demo accounts (scripts/demo-accounts.js), so `npm run dev` with
// VITE_USE_EMULATOR=true has something to log into on localhost.
//
// Emulator-only and safe: it sets FIREBASE_AUTH_EMULATOR_HOST /
// FIRESTORE_EMULATOR_HOST, so firebase-admin talks to the local emulators and
// NEVER the cloud project. bootstrap-users.js's production guard is satisfied by
// FIRESTORE_EMULATOR_HOST being set.
//
// Each seed script calls initializeApp() itself, so they run as separate child
// processes (one app per process) rather than being imported in-process.
//
//   1. npm run emulators      (start the suite — leave it running)
//   2. npm run seed:emulator  (this script)
//   3. npm run dev            (with VITE_USE_EMULATOR=true in .env.local)
import { execFileSync } from 'node:child_process'

const env = {
  ...process.env,
  FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080',
  // The project id the emulator and the app share. A local label only — the
  // emulator never contacts the real project. Keep it equal to the app's
  // VITE_FIREBASE_PROJECT_ID so Auth tokens line up.
  GCLOUD_PROJECT: process.env.GCLOUD_PROJECT || 'mapa-crmc',
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT || 'mapa-crmc',
}

console.log(`[seed:emulator] Auth=${env.FIREBASE_AUTH_EMULATOR_HOST}  Firestore=${env.FIRESTORE_EMULATOR_HOST}  project=${env.GCLOUD_PROJECT}\n`)

// bootstrap-users.js seeds the hospitals + demo accounts; bootstrap-reference-data.js
// seeds the agencies and reference data. Admin SDK (rules-bypassing), idempotent.
for (const script of ['bootstrap-users.js', 'bootstrap-reference-data.js']) {
  console.log(`\n=== ${script} ===`)
  execFileSync(process.execPath, [`scripts/${script}`], { stdio: 'inherit', env })
}

console.log('\n[seed:emulator] Done. Log in on localhost with the accounts in scripts/demo-accounts.js (e.g. admin@mapa.gov.ph / admin123).')
