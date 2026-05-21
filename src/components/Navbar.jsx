import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MdApps, MdMessage, MdNotifications, MdLogout,
  MdMarkEmailRead, MdClose
} from 'react-icons/md'
import { useAuth } from '../contexts/AuthContext'
import { ROLES, PATIENT_NOTIFICATIONS } from '../utils/constants'
import NotificationPanel from './NotificationPanel'
import MessagesPanel from './MessagesPanel'

export default function Navbar({ breadcrumb }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [showNotifs, setShowNotifs] = useState(false)
  const [showMessages, setShowMessages] = useState(false)

  const unreadNotifs = PATIENT_NOTIFICATIONS.filter(n => !n.read).length

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const getInitials = (name) => {
    if (!name) return 'U'
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  }

  const getAvatarColor = () => {
    if (!user) return 'bg-gray-200 text-gray-600'
    switch (user.role) {
      case ROLES.PATIENT:      return 'bg-brand-50 text-brand-600 border-brand-500'
      case ROLES.AGENCY:       return 'bg-blue-50 text-blue-600 border-blue-400'
      case ROLES.AGENCY_ADMIN: return 'bg-teal-50 text-teal-600 border-teal-400'
      case ROLES.SUPER_ADMIN:  return 'bg-purple-50 text-purple-600 border-purple-400'
      case ROLES.STAFF_ADMIN:  return 'bg-purple-50 text-purple-600 border-purple-400'
      default:                 return 'bg-gray-100 text-gray-600 border-gray-300'
    }
  }

  const getRoleLabel = () => {
    if (!user) return ''
    switch (user.role) {
      case ROLES.PATIENT:      return 'Patient'
      case ROLES.AGENCY:       return 'Agency Coordinator'
      case ROLES.AGENCY_ADMIN: return 'Agency Admin'
      case ROLES.SUPER_ADMIN:  return 'Super Admin'
      case ROLES.STAFF_ADMIN:  return 'Staff Admin'
      default:                 return ''
    }
  }

  return (
    <header className="h-14 bg-white border-b border-gray-100 flex items-center justify-between px-5 flex-shrink-0 z-30">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500 flex items-center gap-1.5">
        <span>MAPA Portal</span>
        {breadcrumb && (
          <>
            <span className="text-gray-300">/</span>
            <span className="text-gray-800 font-medium">{breadcrumb}</span>
          </>
        )}
      </div>

      {/* Right side — required order: Apps Grid | Messages | Bell | Avatar */}
      <div className="flex items-center gap-1">

        {/* 1. Apps Grid */}
        <button className="nav-icon-btn" aria-label="Apps">
          <MdApps size={20} />
        </button>

        {/* 2. Messages */}
        <div className="relative">
          <button
            className="nav-icon-btn"
            aria-label="Messages"
            onClick={() => { setShowMessages(!showMessages); setShowNotifs(false) }}
          >
            <MdMessage size={19} />
            <span className="absolute top-1 right-1 w-4 h-4 bg-brand-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
              2
            </span>
          </button>
          {showMessages && (
            <MessagesPanel onClose={() => setShowMessages(false)} />
          )}
        </div>

        {/* 3. Notifications Bell */}
        <div className="relative">
          <button
            className="nav-icon-btn"
            aria-label="Notifications"
            onClick={() => { setShowNotifs(!showNotifs); setShowMessages(false) }}
          >
            <MdNotifications size={20} />
            {unreadNotifs > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                {unreadNotifs}
              </span>
            )}
          </button>
          {showNotifs && (
            <NotificationPanel onClose={() => setShowNotifs(false)} />
          )}
        </div>

        {/* 4. User Avatar */}
        {user && (
          <div className="flex items-center gap-2.5 ml-2 pl-2 border-l border-gray-100">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-800 leading-tight">{user.name}</p>
              <p className="text-xs text-gray-400 leading-tight">{getRoleLabel()}</p>
            </div>
            <button
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border-2 cursor-pointer ${getAvatarColor()}`}
              title="Profile"
              onClick={() => {
                if (user.role === ROLES.PATIENT) navigate('/patient/profile')
                else if (user.role === ROLES.AGENCY || user.role === ROLES.AGENCY_ADMIN) navigate('/agency/program')
                else navigate('/admin/profile')
              }}
            >
              {getInitials(user.name)}
            </button>
          </div>
        )}

        {/* Logout */}
        <button
          className="nav-icon-btn ml-1"
          title="Logout"
          onClick={handleLogout}
        >
          <MdLogout size={18} />
        </button>
      </div>
    </header>
  )
}
