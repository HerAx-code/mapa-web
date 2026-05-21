import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function PrivateRoute({ children, allowedRoles }) {
  const { user } = useAuth()

  if (!user) return <Navigate to="/login" replace />

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // Redirect to appropriate dashboard
    if (user.role === 'patient') return <Navigate to="/patient/dashboard" replace />
    if (user.role === 'agency' || user.role === 'agency_admin') return <Navigate to="/agency/dashboard" replace />
    return <Navigate to="/admin/dashboard" replace />
  }

  return children
}
