#!/usr/bin/env node
/**
 * seed-demo-agencies.mjs — DEMO-ONLY agency overlay for the emulator.
 *
 * The canonical agency seed (src/data/agencies.seed.js, written by
 * bootstrap-reference-data.js) keeps the real model: PhilHealth is first-charge
 * coverage (enabled:false, not endorsable) and Malasakit is not a funder at all.
 * For the two-hospital demo network we want six symmetric, fully-working funding
 * agencies, three partnered to each hospital. This overlay — run only against the
 * emulator, after bootstrap-reference-data.js — makes that true WITHOUT touching
 * the canonical file:
 *
 *   - enables all six agencies and stamps partnerHospitalIds (3 per hospital);
 *   - creates the Malasakit agency doc (absent from the canonical seed).
 *
 * The functions emulator's onAgencyWritten mirrors each write to agenciesPublic,
 * so patients see all six without any manual mirror write.
 *
 * Split:
 *   demo-hospital-a (DGH): doh, philhealth, ambag
 *   demo-hospital-b (DPH): pcso, dswd, malasakit
 *
 * Usage (handled for you by scripts/seed-emulator.mjs):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-demo-agencies.mjs
 *
 * DEV / EMULATOR ONLY. Refuses to run against production (mapa-crmc) unless the
 * Firestore emulator is in use — the same guard as bootstrap-users.js.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { INITIAL_BUDGET } from '../src/data/agencies.seed.js'

const PRODUCTION_PROJECT = 'mapa-crmc'
function targetProject() {
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT
  try { return JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')).project_id } catch { return null }
}
if (!process.env.FIRESTORE_EMULATOR_HOST && targetProject() === PRODUCTION_PROJECT) {
  console.error(`[seed-demo-agencies] Refusing to run against ${PRODUCTION_PROJECT}: this is a demo overlay (enables PhilHealth, adds Malasakit as a funder). Use the emulator.`)
  process.exit(1)
}

// Three agencies per hospital. Each agency partners exactly one demo hospital.
const PARTNERS = {
  doh:        ['demo-hospital-a'],
  philhealth: ['demo-hospital-a'],
  ambag:      ['demo-hospital-a'],
  pcso:       ['demo-hospital-b'],
  dswd:       ['demo-hospital-b'],
  malasakit:  ['demo-hospital-b'],
}

// Malasakit is not in the canonical seed, so the overlay provides a full doc.
const MALASAKIT = {
  name: 'Malasakit Center', initials: 'MC', color: 'bg-rose-600', logoUrl: null,
  description: 'Demo funder: guarantee letters for indigent patients’ hospital bills, medicines and laboratory tests.',
  province: 'Cotabato City', city: 'Cotabato City',
  officeName: 'Malasakit Center Desk', location: 'Malasakit Center Desk, Hospital Ground Floor, Cotabato City',
  phone: '064-421-3100', slots: { total: 25, remaining: 25 },
  requirements: ['Barangay Certificate of Indigency', 'Valid ID'],
  assistanceTypes: ['Hospital Bills / Hospitalization', 'Medicines', 'Laboratory Tests'],
  eligibility: { residencyScope: 'nationwide' }, processingTime: 'Same Day', enabled: true,
}

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

async function main() {
  console.log(`[seed-demo-agencies] project=${targetProject() ?? '(emulator)'}  applying 6-funder demo overlay\n`)

  // 1. Create the Malasakit agency doc (idempotent; budget only on first write).
  const malRef = db.doc('agencies/malasakit')
  const malExists = (await malRef.get()).exists
  await malRef.set({
    ...MALASAKIT,
    partnerHospitalIds: PARTNERS.malasakit,
    ...(malExists ? {} : { budget: { ...INITIAL_BUDGET }, createdAt: new Date() }),
  }, { merge: true })
  console.log(`  ${malExists ? '↻' : '✓'} agencies/malasakit (${MALASAKIT.name})`)

  // 2. Enable + partner the five canonical agencies (merge: keeps their budget
  //    and other fields; only flips enabled and sets the hospital split).
  for (const id of ['doh', 'philhealth', 'ambag', 'pcso', 'dswd']) {
    const ref = db.doc(`agencies/${id}`)
    if (!(await ref.get()).exists) { console.log(`  · absent  agencies/${id} (run bootstrap-reference-data.js first)`); continue }
    await ref.set({ enabled: true, partnerHospitalIds: PARTNERS[id] }, { merge: true })
    console.log(`  ✓ agencies/${id}  enabled, partners ${PARTNERS[id].join(', ')}`)
  }

  console.log('\n[seed-demo-agencies] Done. All six demo agencies are enabled and partnered 3-per-hospital.')
  console.log('[seed-demo-agencies] The functions emulator mirrors each to agenciesPublic for the patient view.')
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1) })
