#!/usr/bin/env node
/**
 * bootstrap-reference-data.js
 *
 * Admin-SDK companion to bootstrap-users.js. Seeds (or repairs) the
 * non-user reference collections:
 *
 *   - agencies          (4 partner agencies the slices route to)
 *   - documentTypes     (8 patient-uploadable document categories)
 *   - assistanceTypes   (8 categories of medical assistance)
 *   - hospitalIds       (20 demo CRMC Access Codes)
 *
 * This used to live inside src/pages/Seed.jsx and ran in the browser
 * with a super_admin session. That flow stayed compatible after the
 * 2026-06-01 users/create rule tightening, but it still requires
 * super_admin login + VITE_ENABLE_SEED=true. This script bypasses
 * both — Admin SDK ignores Firestore rules entirely, and the script
 * runs from the CLI like its sibling bootstrap-users.js does for
 * user accounts.
 *
 * USE WHEN:
 *   - Bootstrapping a fresh Firestore database
 *   - Recovering reference data after a manual Firebase Console
 *     deletion (the agencies collection went empty during a
 *     2026-06-05 maintenance session and this script was the fix)
 *   - Routine drift check before a thesis-defense run
 *
 * SAFETY: Every write is `setDoc(..., { merge: true })`. Existing
 * fields are preserved unless the canonical seed overwrites them.
 * Re-running the script is a no-op on already-correct data.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/bootstrap-reference-data.js
 *
 * PowerShell:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "./service-account.json"
 *   node scripts/bootstrap-reference-data.js
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

// ── Canonical reference data ─────────────────────────────────────
// Kept in sync with src/pages/Seed.jsx by convention. If a row drifts
// between the two, the browser /seed page and this CLI script will
// produce different states — same risk we addressed for USERS by
// extracting to scripts/demo-accounts.js. A future refactor could
// hoist these into scripts/reference-data.js shared with Seed.jsx,
// but Seed.jsx is largely a fallback now that the admin-SDK path
// exists.

const SEED_AGENCIES = [
  {
    id:              'malasakit',
    name:            'Malasakit Center',
    initials:        'MC',
    color:           'bg-brand-500',
    description:     'Consolidates DOH, DSWD, PhilHealth, and PCSO services for zero balance billing of indigent patients.',
    location:        'CRMC Ground Floor, Cotabato City',
    phone:           '064-421-2500',
    slots:           { total: 25, remaining: 25 },
    requirements:    ['Barangay Certificate of Indigency','Hospital Billing Statement','Valid ID','Medical Abstract'],
    assistanceTypes: ['Hospital Bills / Hospitalization','Medicines','Laboratory Tests'],
    processingTime:  'Same Day',
    enabled:         true,
  },
  {
    id:              'ambag',
    name:            'AMBaG Program',
    initials:        'AM',
    color:           'bg-purple-600',
    description:     'Zero balance billing for marginalized patients at CRMC and partner hospitals under the BARMM government.',
    location:        'BARMM Admin Building, Cotabato City',
    phone:           '064-421-3000',
    slots:           { total: 25, remaining: 25 },
    requirements:    ['Barangay Certificate of Indigency','PhilHealth ID','Valid ID'],
    assistanceTypes: ['Hospital Bills / Hospitalization','Medicines'],
    processingTime:  '3–5 Days',
    enabled:         true,
  },
  {
    id:              'pcso',
    name:            'PCSO MAP',
    initials:        'PC',
    color:           'bg-red-600',
    description:     'Issues guarantee letters covering chemotherapy, radiation therapy, and essential medicines.',
    location:        'Social Services Department, CRMC',
    phone:           '064-421-2600',
    slots:           { total: 20, remaining: 20 },
    requirements:    ['Medical Certificate','Laboratory Results','PhilHealth ID','Valid ID'],
    assistanceTypes: ['Chemotherapy','Medicines','Laboratory Tests'],
    processingTime:  '5–7 Days',
    enabled:         true,
  },
  {
    id:              'dswd',
    name:            'DSWD AICS',
    initials:        'DS',
    color:           'bg-blue-600',
    description:     'Cash assistance and medicine vouchers for individuals in crisis situations through community social workers.',
    location:        'Social Welfare Office, CRMC',
    phone:           '064-421-2700',
    slots:           { total: 25, remaining: 25 },
    requirements:    ['Barangay Certificate of Indigency','Valid ID','Crisis Documentation'],
    assistanceTypes: ['Hospital Bills / Hospitalization','Medicines','Emergency Medical Assistance'],
    processingTime:  'Same Day',
    enabled:         true,
  },
]

const SEED_DOC_TYPES = [
  { name: 'Valid ID',                          description: 'Any government-issued ID',                    required: true,  order: 0 },
  { name: 'Barangay Certificate of Indigency', description: 'Issued by the barangay',                      required: true,  order: 1 },
  { name: 'Hospital Billing Statement',        description: 'Statement of account from the hospital',       required: true,  order: 2 },
  { name: 'Medical Abstract',                  description: 'Summary of medical condition and treatment',   required: false, order: 3 },
  { name: 'PhilHealth ID',                     description: 'PhilHealth membership card',                   required: false, order: 4 },
  { name: 'Medical Certificate',               description: 'Certified by a licensed physician',            required: false, order: 5 },
  { name: 'Laboratory Results',                description: 'Latest diagnostic or lab results',             required: false, order: 6 },
  { name: 'Crisis Documentation',              description: 'Documentation proving crisis situation',        required: false, order: 7 },
]

const SEED_ASSISTANCE_TYPES = [
  { name: 'Hospital Bills / Hospitalization', description: 'Financial assistance for hospital confinement and related expenses', order: 0 },
  { name: 'Medicines',                        description: 'Support for prescription medications',                               order: 1 },
  { name: 'Chemotherapy',                     description: 'Support for cancer treatment and chemotherapy sessions',             order: 2 },
  { name: 'Dialysis',                         description: 'Assistance for kidney dialysis treatments',                         order: 3 },
  { name: 'Laboratory Tests',                 description: 'Coverage for diagnostic tests and laboratory procedures',            order: 4 },
  { name: 'Surgery / Medical Procedures',     description: 'Financial support for surgical operations',                         order: 5 },
  { name: 'Emergency Medical Assistance',     description: 'Immediate support for emergency medical situations',                 order: 6 },
  { name: 'Burial Assistance',                description: 'Financial support for funeral and burial expenses',                  order: 7 },
]

const SEED_IDS = [
  'CRMC-2026-00001', 'CRMC-2026-00002', 'CRMC-2026-00003',
  'CRMC-2026-00004', 'CRMC-2026-00005', 'CRMC-2026-00006',
  'CRMC-2026-00007', 'CRMC-2026-00008', 'CRMC-2026-00009',
  'CRMC-2026-00010', 'CRMC-2026-00011', 'CRMC-2026-00012',
  'CRMC-2026-00013', 'CRMC-2026-00014', 'CRMC-2026-00015',
  'CRMC-2026-00016', 'CRMC-2026-00017', 'CRMC-2026-00018',
  'CRMC-2026-00019', 'CRMC-2026-00020',
]

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

// Slugify a name into a deterministic doc id so re-running is idempotent.
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_')

async function seedAgencies() {
  let written = 0
  for (const a of SEED_AGENCIES) {
    const { id, ...data } = a
    await db.doc(`agencies/${id}`).set({
      ...data,
      // Initialize the budget block so the agency lists/filters don't
      // render NaN for first-time seed. Coordinator allocation flow
      // takes over from here -- merge:true preserves any later edits.
      budget: { allocated: 0, committed: 0, disbursed: 0, period: 'monthly' },
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    written++
    console.log(`  ✅ agencies/${id} (${a.name})`)
  }
  return written
}

async function seedDocTypes() {
  let written = 0
  for (const dt of SEED_DOC_TYPES) {
    const id = slug(dt.name)
    await db.doc(`documentTypes/${id}`).set({
      ...dt,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    written++
  }
  console.log(`  ✅ documentTypes (${written} rows)`)
  return written
}

async function seedAssistanceTypes() {
  let written = 0
  for (const at of SEED_ASSISTANCE_TYPES) {
    const id = slug(at.name)
    await db.doc(`assistanceTypes/${id}`).set({
      ...at,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    written++
  }
  console.log(`  ✅ assistanceTypes (${written} rows)`)
  return written
}

async function seedHospitalIds() {
  let written = 0
  for (const id of SEED_IDS) {
    await db.doc(`hospitalIds/${id}`).set({
      status:  'available',
      usedBy:  null,
      patId:   null,
      date:    new Date().toLocaleDateString(),
      time:    '',
    }, { merge: true })
    written++
  }
  console.log(`  ✅ hospitalIds (${written} rows)`)
  return written
}

async function main() {
  console.log('[bootstrap-reference-data] Seeding reference collections...\n')
  console.log('Agencies:')
  const a = await seedAgencies()
  console.log()
  console.log('Document types + assistance types + hospital IDs:')
  const dt = await seedDocTypes()
  const at = await seedAssistanceTypes()
  const ids = await seedHospitalIds()
  console.log()
  console.log('[bootstrap-reference-data] Summary:')
  console.log(`  Agencies seeded:        ${a}`)
  console.log(`  Document types seeded:  ${dt}`)
  console.log(`  Assistance types seeded: ${at}`)
  console.log(`  Hospital IDs seeded:    ${ids}`)
  console.log(`  Total writes:           ${a + dt + at + ids}`)
}

main().then(() => process.exit(0)).catch(err => {
  console.error('[bootstrap-reference-data] failed:', err)
  process.exit(1)
})