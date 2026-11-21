import { doc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { logAudit } from './auditLog'

// The patient's Proceed: they accept the coverage plan and every given
// `endorsed` slice moves into its agency's funding queue (`reviewing`).
// One implementation for both places the patient can do it
// (RequestAssistance — all slices; TrackStatus — one slice). Phase 1, R5.
//
// One batch, so the patient is never left half-accepted. The agencies are
// notified on the server by onSliceProceeded (the rules don't let a patient
// write into staff feeds), never from here.
export async function proceedSlices(user, slices) {
  const toProceed = (slices ?? []).filter((s) => s?.status === 'endorsed')
  if (!toProceed.length) return 0
  const batch = writeBatch(db)
  for (const s of toProceed) {
    batch.update(doc(db, 'applications', s.id), { status: 'reviewing', updatedAt: serverTimestamp() })
  }
  await batch.commit()
  // Best-effort: a failed audit entry doesn't undo the proceed.
  for (const s of toProceed) {
    logAudit(user, {
      action:     'patient_proceeded',
      targetType: 'application',
      targetId:   s.id,
      targetName: s.patientName ?? user?.name ?? '',
      details:    `Patient confirmed coverage plan; slice handed off to ${s.agencyName ?? 'agency'} for funding review`,
      requestId:  s.requestId ?? null,
      patientId:  user?.uid ?? null,
    })
  }
  return toProceed.length
}
