import { doc, writeBatch, serverTimestamp } from 'firebase/firestore'

// An agency approval is written together with its cooldown mark
// (approvalMarks/{agencyId}__{patientId}), as ApplicationDetail does.
// `slice` is the stored slice (agencyId, patientId, requestId); `changes` the
// update. mark overrides let a test tamper with the mark.
export function approveWithMark(db, sliceId, slice, changes, mark = {}) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'applications', sliceId), changes)
  batch.set(doc(db, 'approvalMarks', `${slice.agencyId}__${slice.patientId}`), {
    agencyId: slice.agencyId, patientId: slice.patientId, requestId: slice.requestId,
    sliceId, lastApprovedAt: serverTimestamp(), ...mark,
  })
  return batch.commit()
}
