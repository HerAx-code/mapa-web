import { useEffect, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

// Hospitals asking to join the network (the public "For hospitals" form).
// Platform admin only — the rules deny everyone else, so pass enabled=false
// for any other role to avoid a denied listener.
export function useOnboardingRequests(enabled = true) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(enabled)
  useEffect(() => {
    if (!enabled) { setRequests([]); setLoading(false); return undefined }
    return onSnapshot(collection(db, 'onboardingRequests'), (snap) => {
      setRequests(snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)))
      setLoading(false)
    }, (err) => {
      console.error('[useOnboardingRequests] snapshot error:', err)
      setLoading(false)
    })
  }, [enabled])
  return { requests, loading, newCount: requests.filter((r) => r.status === 'new').length }
}
