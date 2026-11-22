import { doc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

// The patient's Proceed: they accept the coverage plan and every given
// `endorsed` slice moves into its agency's funding queue (`reviewing`).
// One implementation for both places the patient can do it
// (RequestAssistance — all slices; TrackStatus — one slice). Phase 1, R5.
//
// One batch, so the patient is never left half-accepted. The agencies are
// notified, and the case timeline's audit entry is written, on the server by
// onSliceProceeded (Phase 5 PR 5.1: patients write no audit entries).
export async function proceedSlices(user, slices) {
  const toProceed = (slices ?? []).filter((s) => s?.status === 'endorsed')
  if (!toProceed.length) return 0
  const batch = writeBatch(db)
  for (const s of toProceed) {
    batch.update(doc(db, 'applications', s.id), { status: 'reviewing', updatedAt: serverTimestamp() })
  }
  await batch.commit()
  return toProceed.length
}
