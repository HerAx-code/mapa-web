import { doc, writeBatch } from 'firebase/firestore'

// Marketplace helpers for rules tests (docs/patient-marketplace-plan.md).

// File a request the way RequestAssistance does: the request carries the
// patient's current access code and, in the same batch, the code is bound to it.
export function fileRequest(db, { reqId, code, data }) {
  const b = writeBatch(db)
  b.set(doc(db, 'requests', reqId), { ...data, patientHospitalId: code })
  b.update(doc(db, 'hospitalIds', code), { requestId: reqId })
  return b.commit()
}

// Join a hospital by claiming its access code: the code flips available → used
// and the patient's current hospital / hospitals / code move together.
export function claimCode(db, { uid, code, tenantId, tenantIds, codeExtra = {} }) {
  const b = writeBatch(db)
  b.update(doc(db, 'hospitalIds', code), { status: 'used', patId: uid, ...codeExtra })
  b.update(doc(db, 'users', uid), { tenantId, tenantIds, hospitalId: code })
  return b.commit()
}
