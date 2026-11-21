import { useState } from 'react'
import { auth } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { mfaEnrolmentDue } from '../utils/mfa'
import MfaEnrollModal from './MfaEnrollModal'

// Phase 1, decision P1-C stage 1 (2026-11-21): a staff member without a second
// factor must set one up before using the app. Rendered by Layout on every
// signed-in page; patients never see it (roleNeedsMfa). A lost phone is reset
// by an admin (resetStaffMfa). Stage 2 adds the same check to the rules.
export default function MfaGate() {
  const { user, logout } = useAuth()
  // Re-checked after the dialog closes (enrolled, or two-factor unavailable).
  const [passed, setPassed] = useState(false)
  if (passed || !mfaEnrolmentDue(user?.role, auth.currentUser)) return null
  return (
    <MfaEnrollModal
      required
      onClose={() => setPassed(true)}
      onUnavailable={() => setPassed(true)}
      onSignOut={() => logout()}
    />
  )
}
