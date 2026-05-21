import { MdClose, MdCheckCircle, MdInfo, MdCalendarToday, MdDescription, MdStar } from 'react-icons/md'
import { PATIENT_NOTIFICATIONS } from '../utils/constants'

const ICONS = {
  certificate_ready:  { icon: MdStar,          color: 'text-green-500',  bg: 'bg-green-50' },
  interview_approved: { icon: MdCheckCircle,   color: 'text-blue-500',   bg: 'bg-blue-50' },
  doc_verified:       { icon: MdDescription,   color: 'text-brand-500',  bg: 'bg-brand-50' },
  interview_sched:    { icon: MdCalendarToday, color: 'text-purple-500', bg: 'bg-purple-50' },
  app_advanced:       { icon: MdInfo,          color: 'text-amber-500',  bg: 'bg-amber-50' },
  app_submitted:      { icon: MdCheckCircle,   color: 'text-gray-400',   bg: 'bg-gray-50' },
}

export default function NotificationPanel({ onClose }) {
  const unread = PATIENT_NOTIFICATIONS.filter(n => !n.read).length

  return (
    <div className="absolute right-0 top-11 w-full max-w-sm sm:w-96 bg-white rounded-xl border border-gray-100 shadow-xl z-50 overflow-hidden max-h-[calc(100vh-90px)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-800">Notifications</h3>
          {unread > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {unread} new
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button className="text-xs text-brand-500 hover:text-brand-600 font-medium">
            Mark all read
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <MdClose size={16} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 px-4">
        <button className="text-xs font-medium text-brand-600 border-b-2 border-brand-500 pb-2 pt-2 mr-4">
          All ({PATIENT_NOTIFICATIONS.length})
        </button>
        <button className="text-xs text-gray-400 pb-2 pt-2 mr-4 hover:text-gray-600">
          Action required (1)
        </button>
        <button className="text-xs text-gray-400 pb-2 pt-2 hover:text-gray-600">
          Activity ({PATIENT_NOTIFICATIONS.length - 1})
        </button>
      </div>

      {/* Notifications list */}
      <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
        {PATIENT_NOTIFICATIONS.map(notif => {
          const meta = ICONS[notif.type] || ICONS.app_submitted
          const Icon = meta.icon
          return (
            <div
              key={notif.id}
              className={`flex gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors ${!notif.read ? 'bg-brand-50/30' : ''}`}
            >
              {/* Icon */}
              <div className={`flex-shrink-0 w-8 h-8 rounded-full ${meta.bg} flex items-center justify-center mt-0.5`}>
                <Icon size={15} className={meta.color} />
              </div>
              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm leading-tight ${!notif.read ? 'font-medium text-gray-800' : 'text-gray-600'}`}>
                  <span className="font-semibold">{notif.title}</span> — {notif.body}
                </p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-gray-400">{notif.time}</span>
                  <span className="text-xs text-brand-500 hover:underline">Tap to view →</span>
                </div>
              </div>
              {/* Unread dot */}
              {!notif.read && (
                <div className="flex-shrink-0 w-2 h-2 bg-brand-500 rounded-full mt-2" />
              )}
            </div>
          )
        })}
      </div>

      <div className="px-4 py-2.5 border-t border-gray-100 text-center">
        <span className="text-xs text-gray-400">Showing last 50 notifications</span>
      </div>
    </div>
  )
}
