import { useEffect, useState } from 'react'
import { ORG, onOrgChange } from '../config/org'

// The live branding object (ORG) as React state. ORG is mutated in place when
// the signed-in user's hospital loads (applyHospital), which doesn't re-render
// anything by itself; components that SHOW hospital identity subscribe here.
export function useOrg() {
  const [org, setOrg] = useState(() => ({ ...ORG }))
  useEffect(() => onOrgChange((next) => setOrg({ ...next })), [])
  return org
}
