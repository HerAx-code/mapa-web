#!/usr/bin/env node
/**
 * seed-demo-scenario.js
 *
 * Creates one fresh in-flight assistance request for the demo patient
 * (patient@gmail.com) so a thesis-defense panel sees the system in
 * motion instead of an empty workspace.
 *
 * Scenario produced:
 *   - A submitted request from Baher Blah for ₱25,000 (Hospital Bills /
 *     Hospitalization) describing a real-sounding medical situation
 *   - Three attached document records (Valid ID, Barangay Certificate
 *     of Indigency, Hospital Billing Statement) in 'pending' state,
 *     each with a placeholder text-as-base64 documentContent so the
 *     CRMC verifier can see SOMETHING when they open the viewer
 *   - No interview scheduled, no agencies endorsed yet
 *
 * That state is the cleanest demo starting point: the demonstrator
 * can walk the panel through document verification -> intake sheet
 * -> interview scheduling -> agency endorsement -> approval -> GL
 * issuance live, hitting every major UI surface in 10 minutes.
 *
 * This is ADDITIVE -- it does not delete or modify any existing
 * requests or documents the patient already has. Re-running the
 * script just adds another fresh request to the queue.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/seed-demo-scenario.js
 *
 * PowerShell:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "./service-account.json"
 *   node scripts/seed-demo-scenario.js
 *
 * Add --dry-run to preview without writing.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const DRY_RUN = process.argv.includes('--dry-run')

initializeApp({ credential: applicationDefault() })
const auth = getAuth()
const db = getFirestore()

const PATIENT_EMAIL = 'patient@gmail.com'

// Deterministic-ish ID for the request so the defense narrative can
// reference it by name. Different timestamp each run keeps re-runs
// from colliding.
const requestId = () => {
  const year = new Date().getFullYear()
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase()
  return `REQ-${year}-${String(Date.now()).slice(-6)}${rand}`
}

// Minimal "image" content -- a tiny base64-encoded text blob that the
// DocViewer can render. The point is to give the verifier something
// to see, not to be a real ID scan.
const placeholderContent = (label) => {
  const text = `[Demo document for the defense: ${label}]\n\nThis is placeholder content. A real patient upload would be a JPG / PNG / PDF of the actual document. The CRMC verifier UI works identically -- approve / reject / re-review buttons drive the same lifecycle.`
  return 'data:text/plain;base64,' + Buffer.from(text).toString('base64')
}

const ATTACHED_DOC_SPECS = [
  {
    typeName: 'Valid ID',
    displayName: 'PhilSys National ID',
  },
  {
    typeName: 'Barangay Certificate of Indigency',
    displayName: 'Barangay Cert (Cotabato City)',
  },
  {
    typeName: 'Hospital Billing Statement',
    displayName: 'CRMC Billing Statement',
  },
]

async function findPatient() {
  try {
    const record = await auth.getUserByEmail(PATIENT_EMAIL)
    const profile = await db.doc(`users/${record.uid}`).get()
    if (!profile.exists) {
      throw new Error(`Auth user ${PATIENT_EMAIL} exists but Firestore profile is missing. Run scripts/repair-demo-accounts.js first.`)
    }
    return { uid: record.uid, ...profile.data() }
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      throw new Error(`Patient ${PATIENT_EMAIL} not found in Firebase Auth. Run scripts/bootstrap-users.js first.`)
    }
    throw e
  }
}

// R38: demo announcements so the dashboard "What's new" card is non-empty
// during a defense walkthrough. The component hides itself on an empty
// items list, so without seeded content the panel sees nothing.
//
// Two seeded:
//   1. CRMC info-level on surface 'both' -- visible on dashboard card AND
//      top strip; targets every non-admin role
//   2. Malasakit promotion on surface 'feed' -- patient-only dashboard
//      card, no top strip
//
// Both expire 14 days out. Re-running this script adds new copies; the
// hook dedupes by id at render time so the card stays clean.
async function seedAnnouncements() {
  const now = Date.now()
  const startAt = new Date(now)
  const endAt   = new Date(now + 14 * 24 * 60 * 60 * 1000)

  const crmc = {
    type:        'info',
    title:       'Office hours updated for the holidays',
    message:     'CRMC Malasakit Center will be open 9am-12nn on December 24 and December 31. Regular hours resume January 2.',
    startAt,
    endAt,
    surface:     'both',
    targetRoles: ['patient', 'agency', 'agency_admin'],
    source:      'crmc',
    active:      true,
    reminderSent: true,
    createdAt:   FieldValue.serverTimestamp(),
    createdBy:   'Demo Seed',
    createdById: 'seed-script',
  }

  let malasakitId = null
  try {
    const malasakitSnap = await db.collection('agencies')
      .where('name', '==', 'Malasakit Center').limit(1).get()
    if (!malasakitSnap.empty) malasakitId = malasakitSnap.docs[0].id
  } catch { /* tolerate */ }

  const malasakit = malasakitId ? {
    type:        'info',
    title:       'New: Bilirubin therapy assistance available this month',
    message:     'Malasakit Center is now covering bilirubin lights and phototherapy supplies for indigent newborns. Walk in or apply through MAPA -- ask your social worker.',
    startAt,
    endAt,
    surface:     'feed',
    audience:    'patients',
    targetRoles: ['patient'],
    source:      'agency',
    agencyId:    malasakitId,
    agencyName:  'Malasakit Center',
    active:      true,
    reminderSent: true,
    createdAt:   FieldValue.serverTimestamp(),
    createdBy:   'Demo Seed',
    createdById: 'seed-script',
  } : null

  console.log(`\n[seed-demo-scenario] Announcements:`)
  if (!DRY_RUN) {
    await db.collection('announcements').add(crmc)
  }
  console.log(`  ${DRY_RUN ? '➕ WOULD CREATE' : '✅'} CRMC info: "${crmc.title}" (surface: both)`)

  if (malasakit) {
    if (!DRY_RUN) await db.collection('announcements').add(malasakit)
    console.log(`  ${DRY_RUN ? '➕ WOULD CREATE' : '✅'} Malasakit promo: "${malasakit.title}" (surface: feed)`)
  } else {
    console.log(`  ⚠️  Skipped Malasakit promo -- no agency named "Malasakit Center" found. Run scripts/bootstrap-reference-data.js first.`)
  }
}

async function main() {
  console.log(`[seed-demo-scenario] ${DRY_RUN ? 'DRY RUN -- no writes' : 'APPLYING seed'}`)

  const patient = await findPatient()
  console.log(`[seed-demo-scenario] Target patient: ${patient.name} (${PATIENT_EMAIL}, uid ${patient.uid.slice(0,8)}...)`)

  await seedAnnouncements()

  const reqId = requestId()
  const reqRefId = DRY_RUN ? '<not-written>' : (db.collection('requests').doc()).id

  const attachedDocuments = []
  console.log(`\n[seed-demo-scenario] Documents:`)
  for (const spec of ATTACHED_DOC_SPECS) {
    const docId = DRY_RUN ? `<would-create>` : db.collection('documents').doc().id

    if (!DRY_RUN) {
      await db.doc(`documents/${docId}`).set({
        patientId:        patient.uid,
        name:             spec.displayName,
        documentTypeName: spec.typeName,
        status:           'pending',
        date:             new Date().toISOString().slice(0, 10),
        size:             1024,
        agencyIds:        [],
        createdAt:        FieldValue.serverTimestamp(),
        updatedAt:        FieldValue.serverTimestamp(),
      })
      await db.doc(`documentContents/${docId}`).set({
        patientId: patient.uid,
        content:   placeholderContent(spec.displayName),
        createdAt: FieldValue.serverTimestamp(),
      })
    }

    attachedDocuments.push({
      documentId:       docId,
      name:             spec.displayName,
      documentTypeName: spec.typeName,
      status:           'pending',
      date:             new Date().toISOString().slice(0, 10),
    })
    console.log(`  ${DRY_RUN ? '➕ WOULD CREATE' : '✅'} documents/${docId.slice(0,8)}... -- ${spec.typeName} (${spec.displayName})`)
  }

  console.log(`\n[seed-demo-scenario] Request:`)
  const requestData = {
    requestId:         reqId,
    patientId:         patient.uid,
    patientName:       patient.name ?? 'Baher Blah',
    patientContact:    patient.contact ?? '09324324344',
    patientAddress:    patient.address ?? '2nd Street, Rosary Heights V, Cotabato City',
    patientHospitalId: patient.hospitalId ?? 'CRMC-2026-00014',
    assistanceType:    'Hospital Bills / Hospitalization',
    description:       'Father admitted at CRMC ICU for severe pneumonia (Day 5 of admission). Requesting assistance to cover the outstanding balance after PhilHealth deduction. Family has exhausted personal savings; community fundraising covered the first 4 days. Doctor advises 3-5 more days of inpatient care including continued IV antibiotics.',
    // PhilHealth-first bill model (Order of Charging): a ₱40k bill reduced by
    // PhilHealth first, leaving a ₱25k residual the agencies co-fund. See
    // docs/philhealth-first-plan.md.
    totalBill:         40000,
    philhealthCovered: 15000,
    otherCovered:      0,
    amountNeeded:      25000,
    amountCommitted:   0,
    agencyIds:         [],
    status:            'submitted',
    attachedDocuments,
    filedBy:           null,
    submittedAt:       FieldValue.serverTimestamp(),
    updatedAt:         FieldValue.serverTimestamp(),
  }

  if (!DRY_RUN) {
    await db.doc(`requests/${reqRefId}`).set(requestData)
  }

  console.log(`  ${DRY_RUN ? '➕ WOULD CREATE' : '✅'} requests/${reqRefId} -- ${reqId}`)
  console.log(`       patient:        ${requestData.patientName}`)
  console.log(`       type:           ${requestData.assistanceType}`)
  console.log(`       total bill:     ₱${requestData.totalBill.toLocaleString()}`)
  console.log(`       PhilHealth:     ₱${requestData.philhealthCovered.toLocaleString()}`)
  console.log(`       amount needed:  ₱${requestData.amountNeeded.toLocaleString()}`)
  console.log(`       status:         ${requestData.status}`)
  console.log(`       documents:      ${attachedDocuments.length}`)

  console.log(`\n[seed-demo-scenario] Demo walkthrough hints for the panel:`)
  console.log(`  1. Sign in as admin@crmc.gov.ph / admin123 -> /admin/requests`)
  console.log(`     -> open this request, click each doc, verify or reject`)
  console.log(`  2. Open the intake sheet, fill the assessment portion`)
  console.log(`  3. Schedule an interview (any Google Meet link works)`)
  console.log(`  4. Endorse to e.g. Malasakit Center + DSWD AICS`)
  console.log(`  5. Sign in as patient@gmail.com / patient123 -> /patient/status`)
  console.log(`     -> click Confirm & Proceed on each endorsed slice`)
  console.log(`  6. Sign in as coordinator@malasakit.gov.ph / agency123`)
  console.log(`     -> open the slice, click Approve, set amount, issue GL`)
  console.log(`  7. Back to patient -> see Download GL button live`)
  if (DRY_RUN) {
    console.log(`\n  This was a DRY RUN. Re-run without --dry-run to apply.`)
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error('[seed-demo-scenario] failed:', err.message)
  process.exit(1)
})