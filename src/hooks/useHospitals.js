import { useEffect, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

// Live list of hospitals (tenants), for partner pickers and hospital labels
// (multi-hospital Phase 7). Hospital docs carry branding only — no PII — and
// any signed-in user may read them. Small collection (one doc per hospital).
export const hospitalLabel = (h) => h?.shortName || h?.facilityName || h?.id || ''

export function useHospitals() {
  const [hospitals, setHospitals] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => onSnapshot(collection(db, 'hospitals'), (snap) => {
    setHospitals(snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.facilityName || a.id).localeCompare(String(b.facilityName || b.id))))
    setLoading(false)
  }, (err) => {
    console.error('[useHospitals] snapshot error:', err)
    setLoading(false)
  }), [])
  return { hospitals, loading }
}
