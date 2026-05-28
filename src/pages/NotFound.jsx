import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ROLES } from '../utils/constants'

export default function NotFound() {
  const navigate    = useNavigate()
  const { user }    = useAuth()

  const handleHome = () => {
    if (!user) { navigate('/'); return }
    const dash = {
      [ROLES.SUPER_ADMIN]:  '/admin/dashboard',
      [ROLES.STAFF_ADMIN]:  '/admin/dashboard',
      [ROLES.AGENCY_ADMIN]: '/agency/dashboard',
      [ROLES.AGENCY]:       '/agency/dashboard',
      [ROLES.PATIENT]:      '/patient/request',
    }
    navigate(dash[user.role] ?? '/')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <p className="text-6xl font-bold text-gray-200 mb-4">404</p>
        <h1 className="text-xl font-semibold text-gray-800 mb-2">Page not found</h1>
        <p className="text-sm text-gray-500 mb-6">
          This page doesn't exist or you may not have permission to view it.
          {!user && ' You may need to log in first.'}
        </p>
        <div className="flex gap-3 justify-center">
          <button onClick={() => navigate(-1)}
            className="btn-secondary text-sm">
            ← Go back
          </button>
          <button onClick={handleHome}
            className="btn-primary text-sm">
            {user ? 'Go to Dashboard' : 'Go to Home'}
          </button>
        </div>
      </div>
    </div>
  )
}
