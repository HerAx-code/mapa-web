import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { auth } from '../firebase'
import { needsEmailConfirm } from '../utils/emailConfirm'
import { ROLES } from '../utils/constants'

/**
 * Route guard. Renders children if the user is signed in AND (when
 * allowedRoles is provided) the user's role is in the allowed set.
 *
 * Otherwise redirects to:
 *   - /login if unauthenticated
 *   - the role's natural landing page if authenticated but disallowed
 *
 * Uses ROLES constants from utils/constants (not hardcoded role
 * strings) so a future role rename only has to change one file.
 */
export default function PrivateRoute({ children, allowedRoles, skipEmailGate }) {
  const { user } = useAuth()

  if (!user) return <Navigate to="/login" replace />

  // Hard email-confirmation gate (owner decision 2026-11-26): a patient whose
  // email isn't confirmed is held on /verify-email and can't reach any other
  // patient page — refresh and deep-links included. needsEmailConfirm scopes it
  // to post-cutoff accounts, so existing patients are unaffected. skipEmailGate
  // is set on /verify-email itself so the redirect can't loop.
  if (!skipEmailGate && user.role === ROLES.PATIENT && needsEmailConfirm(user, auth.currentUser)) {
    return <Navigate to="/verify-email" replace />
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    if (user.role === ROLES.PATIENT) return <Navigate to="/patient/request" replace />
    if (user.role === ROLES.AGENCY || user.role === ROLES.AGENCY_ADMIN) return <Navigate to="/agency/dashboard" replace />
    if (user.role === ROLES.PLATFORM_ADMIN) return <Navigate to="/platform/hospitals" replace />
    return <Navigate to="/admin/dashboard" replace />
  }

  return children
}
