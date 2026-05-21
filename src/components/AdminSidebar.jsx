import { NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  MdDashboard, MdBusiness, MdSupervisedUserCircle, MdDescription,
  MdFavorite, MdListAlt, MdFactCheck, MdGroup, MdBadge,
  MdMessage, MdShield, MdFlag, MdDownload, MdHistory,
  MdCampaign, MdPeopleAlt,
} from 'react-icons/md'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { ROLES } from '../utils/constants'

export default function AdminSidebar() {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === ROLES.SUPER_ADMIN
  const [pendingDocs, setPendingDocs] = useState(0)

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'documents'), where('status', '==', 'pending')),
      snap => setPendingDocs(snap.size),
      () => setPendingDocs(0)
    )
    return unsub
  }, [])

  const MANAGEMENT = [
    { to: '/admin/dashboard',     icon: MdDashboard,            label: 'Dashboard' },
    { to: '/admin/agencies',      icon: MdBusiness,             label: 'Agencies' },
    isSuperAdmin && { to: '/admin/coordinators', icon: MdPeopleAlt, label: 'Coordinators' },
    isSuperAdmin && { to: '/admin/accounts',     icon: MdSupervisedUserCircle, label: 'Admin Accounts' },
    { to: '/admin/doctypes',      icon: MdDescription,          label: 'Document Types' },
    { to: '/admin/assistance',    icon: MdFavorite,             label: 'Assistance Types' },
  ].filter(Boolean)

  const OPERATIONS = [
    { to: '/admin/logs',        icon: MdListAlt,   label: 'App Logs' },
    { to: '/admin/docreview',   icon: MdFactCheck, label: 'Doc Review', badge: pendingDocs },
    { to: '/admin/patients',    icon: MdGroup,     label: 'Patients' },
    { to: '/admin/hospitalids', icon: MdBadge,     label: 'Access Codes' },
    { to: '/admin/messages',    icon: MdMessage,   label: 'Messages' },
    { to: '/admin/reports',     icon: MdFlag,      label: 'Reports' },
  ]

  const SYSTEM = [
    { to: '/admin/export',                            icon: MdDownload, label: 'Export' },
    isSuperAdmin && { to: '/admin/announcements', icon: MdCampaign, label: 'Announcements' },
    isSuperAdmin && { to: '/admin/auditlog',      icon: MdHistory,  label: 'Audit Log' },
  ].filter(Boolean)

  const renderItem = (item) => (
    <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
      <item.icon size={18} className="flex-shrink-0" />
      <span className="flex-1">{item.label}</span>
      {item.badge > 0 && (
        <span className="text-xs font-bold bg-red-500 text-white rounded-full min-w-4 h-4 px-1 flex items-center justify-center">
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      )}
    </NavLink>
  )

  return (
    <aside className="w-56 bg-white border-r border-gray-100 flex flex-col flex-shrink-0">
      {/* Brand */}
      <div className="h-14 flex items-center gap-2.5 px-4 border-b border-gray-100">
        <div className="w-7 h-7 bg-brand-500 rounded-lg flex items-center justify-center">
          <MdShield size={16} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900 leading-tight">MAPA</p>
          <p className="text-xs text-gray-400 leading-tight">CRMC</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-widest px-3 mb-2">
          {isSuperAdmin ? 'System Admin' : 'Management'}
        </p>
        {MANAGEMENT.map(renderItem)}

        <p className="text-xs font-medium text-gray-400 uppercase tracking-widest px-3 mb-2 mt-4">Operations</p>
        {OPERATIONS.map(renderItem)}

        <p className="text-xs font-medium text-gray-400 uppercase tracking-widest px-3 mb-2 mt-4">System</p>
        {SYSTEM.map(renderItem)}
      </nav>
    </aside>
  )
}
