// One-time cleanup (owner decision 2026-11-16): guarantee letters still
// "issued" whose agency no longer exists (agencies deleted in the
// hospital-1 merge: ambag, doh, dswd, pcso). No agency staff can redeem or
// expire them, and the glExpirySweep transaction fails on the missing
// agency doc. Each is marked expired (no budget release: the agency is
// gone); the syncRequestFinancials trigger then recomputes the parent
// request. An audit entry is written per letter for the hospital.
//
// Dry run by default; pass --apply to write.
//   GOOGLE_APPLICATION_CREDENTIALS=service-account.json node scripts/close-orphan-gls.mjs [--apply]
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')
initializeApp({ credential: applicationDefault() })
const db = getFirestore()

const agencyIds = new Set((await db.collection('agencies').get()).docs.map(d => d.id))
const open = (await db.collection('applications').where('glStatus', '==', 'issued').get()).docs
const orphans = open.filter(d => !agencyIds.has(d.data().agencyId))
const rows = []
for (const d of orphans) {
  const a = d.data()
  rows.push({ appId: d.id, agencyId: a.agencyId, amount: a.approvedAmount ?? 0, requestId: a.requestId ?? null })
  if (!APPLY) continue
  await d.ref.update({
    glStatus: 'expired',
    glExpiredAt: FieldValue.serverTimestamp(),
    glExpiredBy: 'cleanup_deleted_agency',
    updatedAt: FieldValue.serverTimestamp(),
  })
  await db.collection('auditLog').add({
    action: 'gl_expired', actorId: 'system', actorName: 'System (cleanup)', actorRole: 'system',
    targetType: 'application', targetId: d.id, targetName: a.patientName ?? '',
    details: `Guarantee letter closed: its agency (${a.agencyId}) no longer exists. ₱${Number(a.approvedAmount ?? 0).toLocaleString()} no longer committed.`,
    requestId: a.requestId ?? null, patientId: a.patientId ?? null,
    ...(a.tenantId ? { tenantId: a.tenantId } : {}),
    createdAt: FieldValue.serverTimestamp(),
  })
}
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', openLetters: open.length, orphans: rows }, null, 1))
