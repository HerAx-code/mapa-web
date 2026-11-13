// Hospital (tenant) loading — multi-hospital Phase 1.
// See docs/multi-hospital-network-plan.md.
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { applyHospital, DEFAULT_HOSPITAL_ID } from '../config/org'

// Which hospital a signed-in user belongs to. Users carry no hospitalId until
// Phase 2 writes it, so everyone falls back to the default (hospital #1).
export const hospitalIdFor = (user) => user?.hospitalId || DEFAULT_HOSPITAL_ID

// Load hospitals/{id} and apply it to ORG. Never throws: a missing doc,
// a rules denial or an offline read keeps the env defaults, so a hospital
// config problem can never block sign-in.
export async function loadHospital(hospitalId = DEFAULT_HOSPITAL_ID) {
  try {
    const snap = await getDoc(doc(db, 'hospitals', hospitalId))
    applyHospital(snap.exists() ? snap.data() : null, hospitalId)
  } catch (err) {
    console.warn(`[hospitals] could not load hospitals/${hospitalId}; using env defaults`, err)
    applyHospital(null)
  }
}

// Back to env defaults (sign-out).
export const clearHospital = () => applyHospital(null)
