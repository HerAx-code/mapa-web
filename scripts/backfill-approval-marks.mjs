// One-time backfill for the 30-day approval cooldown (2026-11-15).
//
// Writes approvalMarks/{agencyId}__{patientId} = { agencyId, patientId,
// requestId, sliceId, lastApprovedAt } from the approvals already in
// applications, so approvals made before the rule still count:
//   - approved / certificate slices: approvedAt;
//   - reversed slices (approvedAt cleared): cooldownUntilAt − 30 days.
// Per agency + patient the latest approval wins. An existing mark is replaced
// only when the backfilled approval is newer.
//
// Dry run by default; pass --apply to write. Prints counts only (no names).
//   GOOGLE_APPLICATION_CREDENTIALS=service-account.json node scripts/backfill-approval-marks.mjs [--apply]
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')
const COOLDOWN_MS = 30 * 86400000

initializeApp({ credential: applicationDefault() })
const db = getFirestore()

const slices = (await db.collection('applications').get()).docs
const latest = new Map()
let skippedNoIds = 0
for (const d of slices) {
  const a = d.data()
  let at = null
  if (['approved', 'certificate'].includes(a.status) && a.approvedAt?.toMillis) at = a.approvedAt.toMillis()
  else if (!a.approvedAt && a.cooldownUntilAt?.toMillis) at = a.cooldownUntilAt.toMillis() - COOLDOWN_MS
  if (at == null) continue
  if (!a.agencyId || !a.patientId) { skippedNoIds++; continue }
  const key = `${a.agencyId}__${a.patientId}`
  if (!latest.has(key) || latest.get(key).at < at) {
    latest.set(key, { at, agencyId: a.agencyId, patientId: a.patientId, requestId: a.requestId ?? null, sliceId: d.id })
  }
}

let write = 0, keep = 0, inWindow = 0
const batch = db.batch()
for (const [key, m] of latest) {
  if (Date.now() - m.at < COOLDOWN_MS) inWindow++
  const ref = db.collection('approvalMarks').doc(key)
  const cur = await ref.get()
  if (cur.exists && (cur.data().lastApprovedAt?.toMillis?.() ?? 0) >= m.at) { keep++; continue }
  write++
  batch.set(ref, {
    agencyId: m.agencyId, patientId: m.patientId, requestId: m.requestId,
    sliceId: m.sliceId, lastApprovedAt: Timestamp.fromMillis(m.at),
  })
}
if (APPLY && write > 0) await batch.commit()

const openNoRequest = slices.filter(d => !d.data().requestId &&
  !['approved', 'certificate', 'rejected', 'closed'].includes(d.data().status)).length
console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry-run',
  slices: slices.length,
  marks: latest.size,
  written: APPLY ? write : 0,
  wouldWrite: APPLY ? 0 : write,
  alreadyCurrent: keep,
  stillInCooldownWindow: inWindow,
  skippedNoIds,
  openSlicesWithoutRequest: openNoRequest,
}, null, 1))
