import { NavLink } from 'react-router-dom'
import {
  MdDashboard, MdSearch, MdLocalHospital, MdTimeline,
  MdFolder, MdVideoCall, MdMenuBook, MdShield
} from 'react-icons/md'

const NAV_ITEMS = [
  { to: '/patient/dashboard',  icon: MdDashboard,     label: 'Dashboard' },
  { to: '/patient/screening',  icon: MdSearch,        label: 'Find Programs' },
  { to: '/patient/programs',   icon: MdLocalHospital, label: 'Medical Programs' },
  { to: '/patient/status',     icon: MdTimeline,      label: 'Track Status' },
  { to: '/patient/documents',  icon: MdFolder,        label: 'My Documents' },
  { to: '/patient/interviews', icon: MdVideoCall,     label: 'Interviews' },
  { to: '/patient/guide',      icon: MdMenuBook,      label: 'User Guide' },
]

export default function Sidebar() {
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
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-widest px-3 mb-2">Menu</p>
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `nav-item ${isActive ? 'active' : ''}`
            }
          >
            <item.icon size={18} className="flex-shrink-0" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
