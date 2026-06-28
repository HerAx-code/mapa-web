import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
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
export default function PrivateRoute({ children, allowedRoles }) {
  const { user } = useAuth()

  if (!user) return <Navigate to="/login" replace />

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    if (user.role === ROLES.PATIENT) return <Navigate to="/patient/request" replace />
    if (user.role === ROLES.AGENCY || user.role === ROLES.AGENCY_ADMIN) return <Navigate to="/agency/dashboard" replace />
    return <Navigate to="/admin/dashboard" replace />
  }

  return children
}
