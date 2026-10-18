import { useState } from 'react'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { ROLES, TERMS_VERSION } from '../utils/constants'
import TermsModal from './TermsModal'

/**
 * Terms of Use re-accept gate (docs/session-timeout-and-terms-plan.md). Mounted
 * once in App inside AuthProvider. A blocking modal shows for a logged-in
 * PATIENT whose stored termsVersion isn't the current one — which covers both
 * the initial rollout (existing patients have no termsVersion) and any future
 * TERMS_VERSION bump. Staff are exempt (the Terms are about applying for
 * assistance). On accept, the current version + timestamp are written to the
 * user doc; the self-update rule already permits these two fields.
 */
export default function TermsGate({ children }) {
  const { user, updateUser } = useAuth()
  const [accepting, setAccepting] = useState(false)

  const needsAccept = !!user && !!user.uid &&
    user.role === ROLES.PATIENT && user.termsVersion !== TERMS_VERSION

  const accept = async () => {
    if (!user?.uid || accepting) return
    setAccepting(true)
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: serverTimestamp(),
      })
      updateUser({ termsVersion: TERMS_VERSION }) // local state → modal closes
    } catch (err) {
      console.error('[TermsGate] accept failed:', err)
      // leave the modal open so the patient can retry
    } finally {
      setAccepting(false)
    }
  }

  return (
    <>
      {children}
      <TermsModal open={needsAccept} updated onAccept={accept} accepting={accepting} />
    </>
  )
}
