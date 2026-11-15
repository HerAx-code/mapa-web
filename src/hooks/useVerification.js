import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { currentTenantId } from '../utils/hospitals'

// Input verification. Both read docs keyed by the signed-in staff member's
// hospital (rules allow only that hospital's gateway staff).

// identityFlags/{tenant}__{uid}: undefined while loading, null = not checked yet.
export function useIdentityFlag(patientId) {
  const tenant = currentTenantId()
  const [flag, setFlag] = useState(undefined)
  useEffect(() => {
    if (!patientId || !tenant) return undefined
    return onSnapshot(doc(db, 'identityFlags', `${tenant}__${patientId}`),
      snap => setFlag(snap.exists() ? snap.data() : null),
      () => setFlag(null))
  }, [patientId, tenant])
  return flag
}

// hospitalSettings/{tenant}: the hospital's verification policy. null = none
// saved (defaults apply — src/utils/verificationPolicy.js).
export function useHospitalSettings() {
  const tenant = currentTenantId()
  const [settings, setSettings] = useState(null)
  useEffect(() => {
    if (!tenant) return undefined
    return onSnapshot(doc(db, 'hospitalSettings', tenant),
      snap => setSettings(snap.exists() ? snap.data() : null),
      () => setSettings(null))
  }, [tenant])
  return settings
}
