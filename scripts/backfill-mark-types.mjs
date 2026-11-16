// Phase 1 backfill (2026-11-16): adds byType to existing approvalMarks so an
// agency that switches its repeat limit to "per assistance type" also sees
// approvals made before. For each mark without byType it records
// byType[<the marked request's assistanceType>] = { at: lastApprovedAt,
// requestId }. Marks that already have byType are left alone.
//
// Dry run by default; pass --apply to write. Counts only.
//   GOOGLE_APPLICATION_CREDENTIALS=service-account.json node scripts/backfill-mark-types.mjs [--apply]
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')
initializeApp({ credential: applicationDefault() })
const db = getFirestore()

const marks = (await db.collection('approvalMarks').get()).docs
let toWrite = 0, hasByType = 0, noType = 0
const batch = db.batch()
for (const m of marks) {
  const d = m.data()
  if (d.byType) { hasByType++; continue }
  const req = d.requestId ? await db.collection('requests').doc(d.requestId).get() : null
  const type = req?.exists ? (req.data().assistanceType ?? '') : ''
  if (!type) { noType++; continue }
  toWrite++
  batch.update(m.ref, { byType: { [type]: { at: d.lastApprovedAt, requestId: d.requestId } } })
}
if (APPLY && toWrite) await batch.commit()
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', marks: marks.length, [APPLY ? 'written' : 'wouldWrite']: toWrite, alreadyHasByType: hasByType, noAssistanceType: noType }, null, 1))
