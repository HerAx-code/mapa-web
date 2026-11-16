// Phase 2A (2026-11-16): reference data for outpatient requests.
//   - documentTypes: charge_slip_from_the_hospital_unit, doctor_s_order,
//     philhealth_dialysis_sessions_certificate (required only for outpatients via
//     requiredWhen; `required` stays false so the pre-Phase-2 site, which
//     lists required == true, never asks inpatients for them);
//   - documentTypes/hospital_billing_statement: careSetting 'inpatient';
//   - assistanceTypes/dialysis: the Dialysis type.
// Values come from src/data/referenceData.js. Existing records are only
// extended (merge), never replaced. Safe to run before the web deploy.
//
// Dry run by default; pass --apply to write.
//   GOOGLE_APPLICATION_CREDENTIALS=service-account.json node scripts/add-outpatient-reference-data.mjs [--apply]
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { DOCUMENT_TYPES, ASSISTANCE_TYPES } from '../src/data/referenceData.js'

const APPLY = process.argv.includes('--apply')
initializeApp({ credential: applicationDefault() })
const db = getFirestore()

const NEW_DOCS = ['charge_slip_from_the_hospital_unit', 'doctor_s_order', 'philhealth_dialysis_sessions_certificate']
const ORDER = { charge_slip_from_the_hospital_unit: 3, doctor_s_order: 4, philhealth_dialysis_sessions_certificate: 5 }
const plan = []

for (const id of NEW_DOCS) {
  const d = DOCUMENT_TYPES.find(t => t.id === id)
  const ref = db.collection('documentTypes').doc(id)
  const cur = await ref.get()
  if (cur.exists) { plan.push(`documentTypes/${id}: exists, skipped`); continue }
  plan.push(`documentTypes/${id}: create`)
  if (APPLY) await ref.set({
    name: d.name, description: d.description, required: false, reusable: false,
    requiredWhen: d.requiredWhen, order: ORDER[id], createdAt: FieldValue.serverTimestamp(),
  })
}

const bsRef = db.collection('documentTypes').doc('hospital_billing_statement')
const bs = await bsRef.get()
if (bs.exists && bs.data().careSetting !== 'inpatient') {
  plan.push('documentTypes/hospital_billing_statement: set careSetting inpatient')
  if (APPLY) await bsRef.set({ careSetting: 'inpatient' }, { merge: true })
} else plan.push('documentTypes/hospital_billing_statement: already inpatient or missing, skipped')

const dial = ASSISTANCE_TYPES.find(t => t.id === 'dialysis')
const dRef = db.collection('assistanceTypes').doc('dialysis')
if ((await dRef.get()).exists) plan.push('assistanceTypes/dialysis: exists, skipped')
else {
  plan.push('assistanceTypes/dialysis: create')
  if (APPLY) await dRef.set({ id: 'dialysis', name: dial.name, description: dial.description, order: dial.order, createdAt: FieldValue.serverTimestamp() })
}

console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', plan }, null, 1))
