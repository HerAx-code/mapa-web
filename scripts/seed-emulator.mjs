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
import net from 'node:net'

const env = {
  ...process.env,
  FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080',
  // The functions emulator host:port. We wait for this too (below) so Firestore
  // triggers — onHospitalWritten, onAgencyWritten, assignPatientId — are wired
  // before we write; otherwise the seed's creates land before the triggers are
  // listening and the public mirrors (hospitalsPublic/agenciesPublic) stay empty.
  FUNCTIONS_EMULATOR_HOST: process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001',
  // The project id the emulator and the app share. A local label only — the
  // emulator never contacts the real project. Keep it equal to the app's
  // VITE_FIREBASE_PROJECT_ID so Auth tokens line up.
  GCLOUD_PROJECT: process.env.GCLOUD_PROJECT || 'mapa-crmc',
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT || 'mapa-crmc',
}

console.log(`[seed:emulator] Auth=${env.FIREBASE_AUTH_EMULATOR_HOST}  Firestore=${env.FIRESTORE_EMULATOR_HOST}  project=${env.GCLOUD_PROJECT}\n`)

// Wait for both emulators to accept connections before seeding. On a first run
// `firebase emulators:start` downloads the storage/UI jars, so Firestore can be
// up while Auth is still starting — seeding then fails every Auth call with
// ECONNREFUSED. This blocks until both ports answer (or times out with a hint).
const tcpOk = (host, port) => new Promise((resolve) => {
  const s = net.connect({ host, port }, () => { s.destroy(); resolve(true) })
  s.on('error', () => resolve(false))
  s.setTimeout(1000, () => { s.destroy(); resolve(false) })
})
const [aHost, aPort] = env.FIREBASE_AUTH_EMULATOR_HOST.split(':')
const [fHost, fPort] = env.FIRESTORE_EMULATOR_HOST.split(':')
const [fnHost, fnPort] = env.FUNCTIONS_EMULATOR_HOST.split(':')
const waitFor = async (host, port, name, timeoutMs = 90000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await tcpOk(host, Number(port))) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  console.error(`\n[seed:emulator] The ${name} emulator at ${host}:${port} is not responding.`)
  console.error(`[seed:emulator] Start it first with 'npm run emulators' and wait for "All emulators ready!", then re-run this.\n`)
  process.exit(1)
}
console.log('[seed:emulator] Waiting for the emulators to be ready…')
await waitFor(fHost, fPort, 'Firestore')
await waitFor(aHost, aPort, 'Auth')
await waitFor(fnHost, fnPort, 'Functions')
// The functions port opens a beat before every trigger finishes wiring, so give
// the Firestore triggers a moment to register before the first write lands.
await new Promise((r) => setTimeout(r, 3000))
console.log('[seed:emulator] Emulators are up.\n')

// bootstrap-users.js seeds the hospitals + demo accounts; bootstrap-reference-data.js
// seeds the canonical agencies and reference data; seed-demo-agencies.mjs then
// applies the DEMO 6-funder overlay (enables all six, partners 3 per hospital,
// adds the Malasakit doc) WITHOUT touching src/data/agencies.seed.js. Admin SDK
// (rules-bypassing), idempotent.
for (const script of ['bootstrap-users.js', 'bootstrap-reference-data.js', 'seed-demo-agencies.mjs']) {
  console.log(`\n=== ${script} ===`)
  execFileSync(process.execPath, [`scripts/${script}`], { stdio: 'inherit', env })
}

console.log('\n[seed:emulator] Done. Log in on localhost with the accounts in scripts/demo-accounts.js (e.g. admin@mapa.gov.ph / admin123).')
