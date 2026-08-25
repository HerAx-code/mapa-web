import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { tsToDate } from '../utils/dates'
import {
  MdClose, MdChevronLeft, MdChevronRight, MdDelete, MdArrowForward,
  // Per-type notification icons (replaced the emoji set for a professional look)
  MdWorkspacePremium, MdCheckCircle, MdFactCheck, MdCancel, MdEvent, MdInfo,
  MdAssignment, MdNotificationsOff, MdSettings, MdLocalHospital, MdFavorite,
  MdEdit, MdDescription, MdPersonAdd, MdLock, MdLockOpen, MdVpnKey,
  MdChatBubble, MdFlag, MdNotifications,
} from 'react-icons/md'

// ── Notification visual config ────────────────────────────────────────────

const NOTIF_CONFIG = {
  certificate_ready:   { Icon: MdWorkspacePremium, bg: 'bg-green-100',  color: 'text-green-600'  },
  interview_approved:  { Icon: MdCheckCircle,      bg: 'bg-blue-100',   color: 'text-blue-600'   },
  doc_verified:        { Icon: MdFactCheck,        bg: 'bg-brand-100',  color: 'text-brand-600'  },
  doc_rejected:        { Icon: MdCancel,           bg: 'bg-red-100',    color: 'text-red-600'    },
  interview_sched:     { Icon: MdEvent,            bg: 'bg-purple-100', color: 'text-purple-600' },
  app_advanced:        { Icon: MdInfo,             bg: 'bg-amber-100',  color: 'text-amber-600'  },
  app_submitted:       { Icon: MdAssignment,       bg: 'bg-gray-100',   color: 'text-gray-600'   },
  agency_disabled:     { Icon: MdNotificationsOff, bg: 'bg-red-100',    color: 'text-red-600'    },
  agency_enabled:      { Icon: MdCheckCircle,      bg: 'bg-green-100',  color: 'text-green-600'  },
  agency_updated:      { Icon: MdSettings,         bg: 'bg-blue-100',   color: 'text-blue-600'   },
  agency_deleted:      { Icon: MdDelete,           bg: 'bg-red-100',    color: 'text-red-600'    },
  new_agency:          { Icon: MdLocalHospital,    bg: 'bg-teal-100',   color: 'text-teal-600'   },
  assistance_added:    { Icon: MdFavorite,         bg: 'bg-pink-100',   color: 'text-pink-600'   },
  assistance_updated:  { Icon: MdEdit,             bg: 'bg-amber-100',  color: 'text-amber-600'  },
  assistance_deleted:  { Icon: MdDelete,           bg: 'bg-red-100',    color: 'text-red-600'    },
  doctype_added:       { Icon: MdDescription,      bg: 'bg-blue-100',   color: 'text-blue-600'   },
  doctype_updated:     { Icon: MdEdit,             bg: 'bg-amber-100',  color: 'text-amber-600'  },
  doctype_deleted:     { Icon: MdDelete,           bg: 'bg-red-100',    color: 'text-red-600'    },
  new_account:         { Icon: MdPersonAdd,        bg: 'bg-purple-100', color: 'text-purple-600' },
  account_deactivated: { Icon: MdLock,             bg: 'bg-orange-100', color: 'text-orange-600' },
  account_activated:   { Icon: MdLockOpen,         bg: 'bg-green-100',  color: 'text-green-600'  },
  account_deleted:     { Icon: MdDelete,           bg: 'bg-red-100',    color: 'text-red-600'    },
  role_changed:        { Icon: MdSettings,         bg: 'bg-blue-100',   color: 'text-blue-600'   },
  password_reset_sent: { Icon: MdVpnKey,           bg: 'bg-amber-100',  color: 'text-amber-600'  },
  new_message:         { Icon: MdChatBubble,       bg: 'bg-cyan-100',   color: 'text-cyan-600'   },
  report_submitted:    { Icon: MdFlag,             bg: 'bg-orange-100', color: 'text-orange-600' },
}

// ── Role-aware route mapping ──────────────────────────────────────────────

export const getNotifRoute = (type, role) => {
  const isAdmin   = role === 'super_admin' || role === 'staff_admin'
  const isAgency  = role === 'agency' || role === 'agency_admin'
  const isPatient = role === 'patient'
  const map = {
    // ── Application lifecycle ──
    doc_verified:            isPatient ? '/patient/request'    : isAgency ? '/agency/inbox' : '/admin/requests',
    doc_rejected:            isPatient ? '/patient/request'    : isAgency ? '/agency/inbox' : '/admin/requests',
    doc_uploaded:            isAgency  ? '/agency/inbox'       : '/admin/requests',
    app_submitted:           isAgency  ? '/agency/inbox'       : '/admin/logs',
    app_advanced:            isPatient ? '/patient/status'     : isAgency ? '/agency/inbox' : '/admin/logs',
    app_withdrawn:           isAgency  ? '/agency/inbox'       : '/admin/logs',
    interview_approved:      '/patient/status',
    certificate_ready:       '/patient/status',
    interview_sched:         isPatient ? '/patient/interviews' : null,

    // ── awaiting_info flow ──
    awaiting_info_requested: '/patient/request',
    awaiting_info_responded: isAgency  ? '/agency/inbox'       : null,

    // ── Budget (agency-side only — CRMC has zero fund authority) ──
    budget_low:              isAgency  ? '/agency/funds'       : null,
    budget_request:          '/agency/allocation',
    new_message:             isPatient ? '/patient/messages' : isAgency ? '/agency/messages' : '/admin/messages',

    // ── Account / role ──
    new_account:             isAdmin   ? '/admin/accounts'     : null,
    account_deactivated:     isAdmin   ? '/admin/accounts'     : null,
    account_activated:       isAdmin   ? '/admin/accounts'     : null,
    account_deleted:         isAdmin   ? '/admin/accounts'     : null,
    role_changed:            null, // self-targeted info; no canonical page
    role_promoted:           '/agency/allocation', // promoted user lands on their new admin surface
    role_demoted:            isAgency  ? '/agency/dashboard'   : null,
    password_reset_sent:     null, // user already has the email, in-app navigation isn't needed

    // ── Agency / catalog (admin actions) ──
    new_agency:              isAdmin   ? '/admin/agencies'     : null,
    agency_updated:          isAdmin   ? '/admin/agencies'     : isAgency ? '/agency/program' : null,
    agency_enabled:          isAdmin   ? '/admin/agencies'     : isAgency ? '/agency/program' : null,
    agency_disabled:         isAdmin   ? '/admin/agencies'     : isAgency ? '/agency/program' : null,
    agency_deleted:          isAdmin   ? '/admin/agencies'     : null,
    doctype_added:           isAdmin   ? '/admin/doctypes'     : null,
    doctype_updated:         isAdmin   ? '/admin/doctypes'     : null,
    doctype_deleted:         isAdmin   ? '/admin/doctypes'     : null,
    assistance_added:        isAdmin   ? '/admin/assistance'   : null,
    assistance_updated:      isAdmin   ? '/admin/assistance'   : null,
    assistance_deleted:      isAdmin   ? '/admin/assistance'   : null,

    // ── Misc ──
    report_submitted:        isAdmin   ? '/admin/reports'      : null,
    system_announcement:     null, // banner-style; no dedicated detail page
  }
  return map[type] ?? null
}

const fmtFull = (ts) => {
  const d = tsToDate(ts)
  if (!d) return '—'
  return d.toLocaleString([], {
    month: 'long', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Modal component ───────────────────────────────────────────────────────

export default function NotificationModal({ notifications, currentIndex, uid, userRole, onClose, onNavigate }) {
  const navigate = useNavigate()
  const { t }    = useTranslation()
  const notif    = notifications[currentIndex]

  // Mark as read when opened
  useEffect(() => {
    if (!notif || notif.read) return
    updateDoc(doc(db, 'notifications', uid, 'items', notif.id), { read: true }).catch(() => {})
  }, [notif?.id, notif?.read, uid])

  if (!notif) return null

  const meta    = NOTIF_CONFIG[notif.type] ?? { Icon: MdNotifications, bg: 'bg-gray-100', color: 'text-gray-600' }
  const route   = getNotifRoute(notif.type, userRole)
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < notifications.length - 1

  const handleDelete = async () => {
    await deleteDoc(doc(db, 'notifications', uid, 'items', notif.id))
    if (hasNext)      onNavigate(currentIndex)
    else if (hasPrev) onNavigate(currentIndex - 1)
    else              onClose()
  }

  const handleGoTo = () => {
    if (!route) return
    const dest = (notif.type === 'new_message' && notif.conversationId)
      ? `${route}?conv=${notif.conversationId}`
      : route
    navigate(dest)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[300] flex items-end sm:items-center justify-center sm:p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[90vh] flex flex-col overflow-hidden">

        {/* Drag handle — mobile only */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1.5 bg-gray-300 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 sm:py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">{t('notif.header')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <MdClose size={20} />
          </button>
        </div>

        {/* Sender meta */}
        <div className="px-5 py-4 bg-gray-50 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-full ${meta.bg} flex items-center justify-center flex-shrink-0`}>
              <meta.Icon className={meta.color} size={22} />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">{t('notif.sender')}</p>
              <p className="text-xs text-gray-400">@ {fmtFull(notif.createdAt)}</p>
            </div>
            {!notif.read && (
              <span className="ml-auto badge badge-blue text-xs">{t('notif.newBadge')}</span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-5 min-h-[120px]">
          <p className="text-base font-semibold text-gray-900 mb-3">{notif.title}</p>
          <p className="text-sm text-gray-600 leading-relaxed">{notif.body}</p>

          {route && (
            <button
              onClick={handleGoTo}
              className="mt-4 w-full btn-primary flex items-center justify-center gap-2 text-sm py-2.5">
              {t('notif.goToPage')} <MdArrowForward size={16} />
            </button>
          )}
        </div>

        {/* Footer — navigation + delete */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
          {/* Prev / Next arrows */}
          <div className="flex items-center gap-2">
            <button
              disabled={!hasPrev}
              onClick={() => onNavigate(currentIndex - 1)}
              className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <MdChevronLeft size={20} />
            </button>
            <span className="text-xs text-gray-400 w-16 text-center">
              {t('notif.ofCount', { current: currentIndex + 1, total: notifications.length })}
            </span>
            <button
              disabled={!hasNext}
              onClick={() => onNavigate(currentIndex + 1)}
              className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <MdChevronRight size={20} />
            </button>
          </div>

          {/* Delete */}
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 text-xs text-red-500 border border-red-200 bg-white px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
            <MdDelete size={14} /> {t('notif.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}
