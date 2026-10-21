#!/usr/bin/env node
/**
 * bootstrap-reference-data.js
 *
 * Admin-SDK companion to bootstrap-users.js. Seeds (or repairs) the
 * non-user reference collections:
 *
 *   - agencies          (5 funders; PhilHealth seeded disabled as first-charge deduction)
 *   - documentTypes     (8 patient-uploadable document categories)
 *   - assistanceTypes   (8 categories of medical assistance)
 *   - hospitalIds       (20 demo Patient Access Codes)
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
// Single source of truth for the catalogs (shared with the app + src/pages/Seed.jsx).
import { DOCUMENT_TYPES, ASSISTANCE_TYPES, CORE_DOC_IDS } from '../src/data/referenceData.js'
import { AGENCIES, INITIAL_BUDGET } from '../src/data/agencies.seed.js'

// Agencies come from src/data/agencies.seed.js (imported above) — the canonical

// Document + assistance catalogs come from src/data/referenceData.js (imported
// above) — no inline copies here. The legacy flat checklist still needs a
// `required` flag + `order`, derived from the canonical core set + array order.

// 20 demo access codes under the active issuing prefix (MAPA-YYYY-NNNNN).
const CODE_PREFIX = process.env.ACCESS_CODE_PREFIX || 'MAPA'
const CODE_YEAR = new Date().getFullYear()
const SEED_IDS = Array.from({ length: 20 }, (_, i) =>
  `${CODE_PREFIX}-${CODE_YEAR}-${String(i + 1).padStart(5, '0')}`
)

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

// Doc ids are the canonical slugs defined in referenceData.js; agency ids are
// explicit. No local slug helper needed.

async function seedAgencies() {
  let written = 0
  for (const a of AGENCIES) {
    const { id, ...data } = a
    await db.doc(`agencies/${id}`).set({
      ...data,
      // Initialize the budget block so the agency lists/filters don't
      // render NaN for first-time seed. Coordinator allocation flow
      // takes over from here -- merge:true preserves any later edits.
      budget: { ...INITIAL_BUDGET },
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    written++
    console.log(`  ✅ agencies/${id} (${a.name})`)
  }
  return written
}

async function seedDocTypes() {
  let written = 0
  // Derive the legacy flat-checklist fields from the canonical catalog:
  // core docs are `required: true`, order follows the array.
  for (const [i, dt] of DOCUMENT_TYPES.entries()) {
    await db.doc(`documentTypes/${dt.id}`).set({
      name:        dt.name,
      description: dt.description,
      reusable:    !!dt.reusable,
      required:    CORE_DOC_IDS.includes(dt.id),
      order:       i,
      createdAt:   FieldValue.serverTimestamp(),
    }, { merge: true })
    written++
  }
  console.log(`  ✅ documentTypes (${written} rows)`)
  return written
}

async function seedAssistanceTypes() {
  let written = 0
  for (const at of ASSISTANCE_TYPES) {
    await db.doc(`assistanceTypes/${at.id}`).set({
      name:        at.name,
      description: at.description,
      order:       at.order,
      createdAt:   FieldValue.serverTimestamp(),
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