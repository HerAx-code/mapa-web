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

// Register the way Register.jsx does (code REQUIRED, 2026-11-14): claim the
// code and create the profile in one write; the code's hospital is the
// patient's first hospital.
export function registerWithCode(db, { uid, code, tenantId, tenantIds = [tenantId], profile = {} }) {
  const b = writeBatch(db)
  b.update(doc(db, 'hospitalIds', code), { status: 'used', patId: uid })
  b.set(doc(db, 'users', uid), { role: 'patient', agencyId: null, name: 'Pat', ...profile, hospitalId: code, tenantId, tenantIds })
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
