import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

/**
 * hospitalsPublic — the public, sign-in-free projection of each hospital
 * (multi-hospital), so the Landing page can list participating hospitals and
 * show a real access-code prefix. hospitals/{id} itself needs sign-in.
 *
 * Only these four fields, and the rules require them to EQUAL the hospital
 * doc (getAfter), so the projection can never drift from or contradict it.
 * Same belt-and-braces mirroring as agenciesPublic: every client path that
 * changes a hospital's public fields re-syncs it, best-effort.
 */
export function projectPublicHospital(h = {}) {
  return {
    facilityName:     h.facilityName ?? '',
    shortName:        h.shortName ?? '',
    accessCodePrefix: h.accessCodePrefix ?? '',
    enabled:          h.enabled !== false,
  }
}

// Never throws — a failed mirror must not break the hospital write before it.
export async function syncHospitalPublic(hospitalId, hospitalData) {
  if (!hospitalId) return
  try {
    await setDoc(doc(db, 'hospitalsPublic', hospitalId),
      { ...projectPublicHospital(hospitalData), updatedAt: serverTimestamp() })
  } catch (err) {
    console.warn('[hospitalsPublic] sync failed for', hospitalId, err)
  }
}
