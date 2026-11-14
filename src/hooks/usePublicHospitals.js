import { useEffect, useState } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

// Participating hospitals for signed-out pages (Landing, Register): the public
// projection hospitalsPublic (hospitals/{id} itself needs sign-in). Only
// hospitals taking sign-ups, with a name and an access-code prefix. Empty
// until a hospital is synced — callers fall back to the deployment prefix.
export function usePublicHospitals() {
  const [hospitals, setHospitals] = useState([])
  useEffect(() => onSnapshot(
    query(collection(db, 'hospitalsPublic'), where('enabled', '==', true)),
    (snap) => setHospitals(snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((h) => h.facilityName && h.accessCodePrefix)
      .sort((a, b) => a.facilityName.localeCompare(b.facilityName))),
    () => {},
  ), [])
  return hospitals
}
