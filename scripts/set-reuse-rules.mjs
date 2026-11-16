// Phase 2B (2026-11-16): reuse rules per document type (src/utils/documentReuse.js).
//   valid_id, philhealth_id                     reusable, 12 months from verification
//   doctor_s_order,
//   barangay_certificate_of_indigency           reusable, 3 months from the date on it
// Run AFTER the 2B web deploy: the earlier site reuses every reusable type for
// 12 months from verification, which would be wrong for the 3-month types.
//
// Dry run by default; pass --apply to write.
//   GOOGLE_APPLICATION_CREDENTIALS=service-account.json node scripts/set-reuse-rules.mjs [--apply]
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')
initializeApp({ credential: applicationDefault() })
const db = getFirestore()

const RULES = {
  valid_id:                          { reusable: true, reuseMonths: 12, reuseFrom: 'verified' },
  philhealth_id:                     { reusable: true, reuseMonths: 12, reuseFrom: 'verified' },
  doctor_s_order:                    { reusable: true, reuseMonths: 3,  reuseFrom: 'issued' },
  barangay_certificate_of_indigency: { reusable: true, reuseMonths: 3,  reuseFrom: 'issued' },
}
const changes = []
for (const [id, want] of Object.entries(RULES)) {
  const ref = db.collection('documentTypes').doc(id)
  const snap = await ref.get()
  if (!snap.exists) { changes.push({ id, skipped: 'missing' }); continue }
  const cur = snap.data()
  const diff = Object.fromEntries(Object.entries(want).filter(([k, v]) => cur[k] !== v))
  if (Object.keys(diff).length === 0) continue
  changes.push({ id, set: diff })
  if (APPLY) await ref.set(diff, { merge: true })
}
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', changes }, null, 1))
