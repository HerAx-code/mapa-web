import { useState, useEffect, useRef } from 'react'
import NotificationModal, { getNotifRoute } from './NotificationModal'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  MdMenu, MdClose, MdApps, MdMessage, MdNotifications,
  MdLogout, MdShield, MdDashboard, MdSearch, MdLocalHospital,
  MdTimeline, MdFolder, MdVideoCall, MdMenuBook,
  MdInbox, MdDescription, MdBarChart, MdUpload,
  MdCardMembership, MdListAlt, MdBusiness,
  MdSupervisedUserCircle, MdFavorite, MdFactCheck,
  MdGroup, MdBadge, MdEmail, MdStar, MdCheckCircle,
  MdInfo, MdCalendarToday, MdSend, MdEdit,
  MdSettings, MdHelp, MdFlag, MdChevronRight, MdLock, MdPerson,
  MdCancel, MdNotificationsNone, MdHistory, MdDownload,
  MdCampaign, MdBuildCircle, MdWarning, MdAttachMoney,
} from 'react-icons/md'
import { collection, query, where, orderBy, limit, onSnapshot, writeBatch, doc, updateDoc, getDocs, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { getOrCreateConversation, sendMessage } from '../utils/messages'
import { notify } from '../utils/notifications'
import { useAuth } from '../contexts/AuthContext'
import { ROLES } from '../utils/constants'
import ProfileModals from './ProfileModals'
import LanguageToggle from './LanguageToggle'
import toast from 'react-hot-toast'

const timeAgo = (ts) => {
  if (!ts) return ''
  const d   = ts.toDate ? ts.toDate() : new Date(ts)
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1)   return 'just now'
  if (min < 60)  return `${min}m ago`
  const hrs = Math.floor(min / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Nav configs ────────────────────────────────────────────────────────────

const PATIENT_NAV = [
  { to: '/patient/dashboard',  icon: MdDashboard,     label: 'Dashboard'     },
  { to: '/patient/screening',  icon: MdSearch,        label: 'Find Programs' },
  { to: '/patient/status',     icon: MdTimeline,      label: 'My Application'},
  { to: '/patient/documents',  icon: MdFolder,        label: 'My Documents'  },
  { to: '/patient/interviews', icon: MdVideoCall,     label: 'Interviews'    },
  { to: '/patient/messages',   icon: MdMessage,       label: 'Messages'      },
  { to: '/patient/guide',      icon: MdMenuBook,      label: 'User Guide'    },
]

const AGENCY_NAV = [
  { to: '/agency/dashboard',    icon: MdDashboard,      label: 'Dashboard' },
  { to: '/agency/inbox',        icon: MdInbox,          label: 'Application Inbox' },
  { to: '/agency/messages',     icon: MdMessage,        label: 'Messages' },
  { to: '/agency/program',      icon: MdDescription,    label: 'Agency Profile' },
  { to: '/agency/slots',        icon: MdBarChart,       label: 'Slot Management' },
  { to: '/agency/interviews',   icon: MdVideoCall,      label: 'Online Interviews' },
  { to: '/agency/generator',    icon: MdCardMembership, label: 'Guarantee Letters' },
  { to: '/agency/funds',        icon: MdAttachMoney,    label: 'Funds' },
  { to: '/agency/allocation',   icon: MdAttachMoney,    label: 'Budget Allocation', adminOnly: true },
  { to: '/agency/logs',         icon: MdListAlt,        label: 'Application Logs' },
  { to: '/agency/guide',        icon: MdMenuBook,       label: 'User Guide' },
]

const ADMIN_NAV = {
  management: [
    { to: '/admin/dashboard',       icon: MdDashboard,            label: 'Dashboard'        },
    { to: '/admin/agencies',        icon: MdBusiness,             label: 'Agencies'              },
    { to: '/admin/coordinators',    icon: MdGroup,                label: 'Coordinators', superOnly: true },
    { to: '/admin/accounts',        icon: MdSupervisedUserCircle,  label: 'Admin Accounts'       },
    { to: '/admin/announcements',   icon: MdCampaign,             label: 'Announcements', superOnly: true },
    { to: '/admin/doctypes',        icon: MdDescription,          label: 'Document Types'   },
    { to: '/admin/assistance',      icon: MdFavorite,             label: 'Assistance Types' },
  ],
  operations: [
    { to: '/admin/logs',        icon: MdListAlt,   label: 'App Logs' },
    { to: '/admin/docreview',   icon: MdFactCheck, label: 'Doc Review' },
    { to: '/admin/patients',    icon: MdGroup,     label: 'Patients' },
    { to: '/admin/hospitalids', icon: MdBadge,     label: 'Access Codes' },
    // Funds removed — CRMC has zero fund authority. Each agency manages its
    // own allocation through /agency/allocation (Agency Administrator role).
    { to: '/admin/messages',    icon: MdEmail,     label: 'Messages' },
    { to: '/admin/reports',     icon: MdFlag,      label: 'Reports'   },
    { to: '/admin/export',      icon: MdDownload,  label: 'Export'    },
    { to: '/admin/auditlog',    icon: MdHistory,   label: 'Audit Log' },
  ]
}

// ── Notification panel ────────────────────────────────────────────────────

const NOTIF_ICONS = {
  // Patient / application
  certificate_ready:  { icon: MdStar,          color: 'text-green-500',  bg: 'bg-green-50'  },
  interview_approved: { icon: MdCheckCircle,   color: 'text-blue-500',   bg: 'bg-blue-50'   },
  doc_verified:       { icon: MdFolder,        color: 'text-brand-500',  bg: 'bg-brand-50'  },
  doc_rejected:       { icon: MdCancel,        color: 'text-red-500',    bg: 'bg-red-50'    },
  interview_sched:    { icon: MdCalendarToday, color: 'text-purple-500', bg: 'bg-purple-50' },
  app_advanced:       { icon: MdInfo,          color: 'text-amber-500',  bg: 'bg-amber-50'  },
  app_submitted:      { icon: MdCheckCircle,   color: 'text-gray-400',   bg: 'bg-gray-50'   },
  // Agency
  agency_disabled:    { icon: MdCancel,        color: 'text-red-500',    bg: 'bg-red-50'    },
  agency_enabled:     { icon: MdCheckCircle,   color: 'text-green-500',  bg: 'bg-green-50'  },
  agency_updated:     { icon: MdInfo,          color: 'text-blue-500',   bg: 'bg-blue-50'   },
  agency_deleted:     { icon: MdCancel,        color: 'text-red-600',    bg: 'bg-red-50'    },
  new_agency:         { icon: MdBusiness,      color: 'text-teal-500',   bg: 'bg-teal-50'   },
  // Assistance types
  assistance_added:   { icon: MdFavorite, color: 'text-pink-500',  bg: 'bg-pink-50'  },
  assistance_updated: { icon: MdFavorite, color: 'text-amber-500', bg: 'bg-amber-50' },
  assistance_deleted: { icon: MdCancel,   color: 'text-red-500',   bg: 'bg-red-50'   },
  // Document types
  doctype_added:   { icon: MdDescription, color: 'text-blue-500',  bg: 'bg-blue-50'  },
  doctype_updated: { icon: MdDescription, color: 'text-amber-500', bg: 'bg-amber-50' },
  doctype_deleted: { icon: MdCancel,      color: 'text-red-500',   bg: 'bg-red-50'   },
  // System announcements
  system_announcement:  { icon: MdCampaign,             color: 'text-amber-500',  bg: 'bg-amber-50'  },
  // Accounts
  new_account:          { icon: MdSupervisedUserCircle, color: 'text-purple-500', bg: 'bg-purple-50' },
  account_deactivated:  { icon: MdCancel,              color: 'text-orange-500', bg: 'bg-orange-50' },
  account_activated:    { icon: MdCheckCircle,          color: 'text-green-500',  bg: 'bg-green-50'  },
  account_deleted:      { icon: MdCancel,              color: 'text-red-600',    bg: 'bg-red-50'    },
  role_changed:         { icon: MdInfo,                color: 'text-blue-500',   bg: 'bg-blue-50'   },
  password_reset_sent:  { icon: MdInfo,                color: 'text-amber-500',  bg: 'bg-amber-50'  },
}

const NOTIF_CATEGORY = {
  new_message:         'Messages',
  doc_verified:        'Documents',   doc_rejected:        'Documents',
  doctype_added:       'Documents',   doctype_updated:     'Documents',   doctype_deleted:     'Documents',
  app_submitted:       'Applications', app_advanced:       'Applications',
  interview_sched:     'Applications', interview_approved:  'Applications', certificate_ready:   'Applications',
  new_account:         'Accounts',   account_deactivated:  'Accounts',
  account_activated:   'Accounts',   account_deleted:      'Accounts',
  role_changed:        'Accounts',   password_reset_sent:  'Accounts',
  agency_created:      'Agencies',   agency_updated:       'Agencies',
  agency_enabled:      'Agencies',   agency_disabled:      'Agencies',   agency_deleted:       'Agencies',
  assistance_added:    'System',     assistance_updated:   'System',      assistance_deleted:   'System',
  report_submitted:    'System',
  system_announcement: 'System',
}

function NotifPanel({ notifications, unreadCount, onMarkAllRead, onClose, uid, userRole }) {
  const navigate                        = useNavigate()
  const [modalIdx, setModalIdx]         = useState(null)

  const openModal = (idx) => setModalIdx(idx)
  const closeModal = ()   => setModalIdx(null)

  const dismiss = async (e, notifId) => {
    e.stopPropagation()
    await deleteDoc(doc(db, 'notifications', uid, 'items', notifId))
  }

  return (
    <div className="absolute right-0 top-12 w-80 bg-white rounded-xl border border-gray-100 shadow-xl z-50 overflow-hidden flex flex-col max-h-[calc(100vh-90px)]">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-800">
          Notifications{unreadCount > 0 && <span className="ml-1.5 text-xs font-normal text-brand-500">({unreadCount} unread)</span>}
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={16} /></button>
      </div>

      {/* Notification items */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
        {notifications.length === 0 && (
          <div className="py-12 flex flex-col items-center gap-2">
            <MdNotificationsNone size={36} className="text-gray-200" />
            <p className="text-xs text-gray-400">You're all caught up!</p>
          </div>
        )}
        {notifications.map((n, idx) => {
          const meta = NOTIF_ICONS[n.type] || NOTIF_ICONS.app_submitted
          const Icon = meta.icon
          return (
            <div
              key={n.id}
              onClick={() => openModal(idx)}
              className={`flex items-start gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors ${!n.read ? 'bg-blue-50/20' : ''}`}
            >
              {/* Icon avatar */}
              <div className={`flex-shrink-0 w-9 h-9 rounded-full ${meta.bg} flex items-center justify-center mt-0.5`}>
                <Icon size={16} className={meta.color} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm leading-snug ${!n.read ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                  {n.title}
                </p>
                <p className="text-sm text-gray-500 mt-0.5 leading-snug line-clamp-2">{n.body}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <p className="text-xs text-gray-400">{timeAgo(n.createdAt)}</p>
                  {NOTIF_CATEGORY[n.type] && (
                    <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                      {NOTIF_CATEGORY[n.type]}
                    </span>
                  )}
                </div>
              </div>

              {/* Dismiss X — larger tap area */}
              <button
                onClick={(e) => dismiss(e, n.id)}
                className="flex-shrink-0 p-1.5 rounded-full text-gray-300 hover:bg-gray-200 hover:text-gray-500 flex items-center justify-center transition-colors -mr-1"
              >
                <MdClose size={13} />
              </button>
            </div>
          )
        })}
      </div>

      {/* Footer bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 bg-gray-50 flex-shrink-0">
        <button
          onClick={() => { navigate('/notifications'); onClose() }}
          className="text-xs text-brand-500 hover:text-brand-600 font-medium"
        >
          See all
        </button>
        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <button onClick={onMarkAllRead} className="text-xs text-gray-500 hover:text-gray-700 font-medium">
              ✓ Mark all read
            </button>
          )}
        </div>
      </div>

      {/* Notification detail modal */}
      {modalIdx !== null && (
        <NotificationModal
          notifications={notifications}
          currentIndex={modalIdx}
          uid={uid}
          userRole={userRole}
          onClose={closeModal}
          onNavigate={setModalIdx}
        />
      )}
    </div>
  )
}

// ── Compose modal ─────────────────────────────────────────────────────────

function ComposeModal({ user, onClose }) {
  const [to, setTo]           = useState(null)
  const [subject, setSubject] = useState('')
  const [body, setBody]       = useState('')
  const [patients, setPatients] = useState([])
  const [search, setSearch]   = useState('')
  const [confirmClose, setConfirmClose] = useState(false)

  const hasUnsaved = !!(subject.trim() || body.trim())
  const handleClose = () => hasUnsaved ? setConfirmClose(true) : onClose()
  const [sending, setSending] = useState(false)
  const [showDrop, setShowDrop] = useState(false)

  useEffect(() => {
    getDocs(collection(db, 'users'))
      .then(snap => setPatients(
        snap.docs
          .map(d => ({ uid: d.id, ...d.data() }))
          .filter(u => {
            if (u.uid === user?.uid || !u.name || !u.email) return false
            // Patients can only message admins and agencies — not other patients
            if (user?.role === 'patient')
              return ['super_admin', 'staff_admin', 'agency'].includes(u.role)
            return true
          })
      ))
  }, [])

  const filtered = patients.filter(p =>
    p.name?.toLowerCase().includes(search.toLowerCase()) ||
    p.email?.toLowerCase().includes(search.toLowerCase())
  )

  const handleSend = async () => {
    if (!to || !subject.trim() || !body.trim()) {
      toast.error('Please fill in all fields.')
      return
    }
    setSending(true)
    try {
      const convId = await getOrCreateConversation(user.uid, to.uid, {
        names:   { [user.uid]: user.name, [to.uid]: to.name },
        roles:   { [user.uid]: user.role, [to.uid]: to.role ?? 'patient' },
        subject: subject.trim(),
      })
      await sendMessage(convId, { from: user.uid, fromName: user.name, text: body.trim(), toUid: to.uid })
      await notify(to.uid, {
        type:           'new_message',
        title:          `New message from ${user.name}`,
        body:           subject.trim(),
        conversationId: convId,
      })
      toast.success('Message sent.')
      onClose()
    } catch { toast.error('Failed to send.') }
    finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[300] flex items-end sm:items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden relative">

        {/* Unsaved changes confirmation overlay */}
        {confirmClose && (
          <div className="absolute inset-0 bg-white/90 z-10 flex items-center justify-center rounded-2xl p-6">
            <div className="text-center space-y-3">
              <p className="text-sm font-semibold text-gray-800">Discard this message?</p>
              <p className="text-xs text-gray-500">You have unsaved content. If you close now, your message will be lost.</p>
              <div className="flex gap-2 justify-center pt-1">
                <button className="btn-secondary text-sm" onClick={() => setConfirmClose(false)}>
                  Keep writing
                </button>
                <button className="btn-danger text-sm" onClick={onClose}>
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">New Message</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>

        <div className="px-5 pt-4 pb-2 space-y-0 divide-y divide-gray-100">
          {/* To */}
          <div className="flex items-start gap-3 pb-3 relative">
            <span className="text-sm text-gray-400 w-16 flex-shrink-0 pt-1.5">To:</span>
            {to ? (
              <div className="flex items-center gap-2 flex-wrap flex-1">
                <span className="flex items-center gap-1.5 bg-brand-50 text-brand-700 text-xs font-medium px-2.5 py-1.5 rounded-lg">
                  {to.name}
                  <button onClick={() => setTo(null)} className="hover:text-red-500"><MdClose size={12} /></button>
                </span>
              </div>
            ) : (
              <div className="flex-1 relative">
                <input
                  className="input text-sm w-full"
                  placeholder={user?.role === 'patient'
                    ? 'Search for an admin or your agency...'
                    : 'Search by name or email...'}
                  value={search} autoFocus
                  onChange={e => { setSearch(e.target.value); setShowDrop(true) }}
                  onFocus={() => setShowDrop(true)} />
                {showDrop && (search || user?.role === 'patient') && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-gray-100 rounded-xl shadow-xl z-10 max-h-44 overflow-y-auto mt-1">
                    {filtered.map(p => {
                      const roleLabel = { super_admin: 'Super Admin', staff_admin: 'Staff Admin', agency: 'Agency', patient: 'Patient' }[p.role] ?? p.role
                      return (
                        <button key={p.uid}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-50 text-left"
                          onMouseDown={() => { setTo(p); setSearch(''); setShowDrop(false) }}>
                          <div className="w-7 h-7 rounded-full bg-brand-50 text-brand-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
                            {p.name?.[0]?.toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800">{p.name}</p>
                            <p className="text-xs text-gray-400">{p.email}</p>
                          </div>
                          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">{roleLabel}</span>
                        </button>
                      )
                    })}
                    {filtered.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No users found</p>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Patient guidance */}
          {user?.role === 'patient' && !to && (
            <div className="py-2 px-1">
              <p className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                Contact an admin or your assigned agency for help with your application.
              </p>
            </div>
          )}

          {/* Subject */}
          <div className="flex items-center gap-3 py-3">
            <span className="text-sm text-gray-400 w-16 flex-shrink-0">Subject:</span>
            <input className="flex-1 text-sm text-gray-800 outline-none placeholder-gray-300"
              placeholder="Enter subject..."
              value={subject} onChange={e => setSubject(e.target.value)} />
          </div>

          {/* Body */}
          <div className="py-3">
            <textarea
              className="w-full text-sm text-gray-800 outline-none resize-none placeholder-gray-300 min-h-[140px]"
              placeholder="Type your message here..."
              maxLength={1000}
              value={body} onChange={e => setBody(e.target.value)} />
            {body.length > 800 && (
              <p className={`text-xs text-right mt-1 ${body.length >= 980 ? 'text-red-500' : 'text-gray-400'}`}>
                {1000 - body.length} characters remaining
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 flex items-center justify-between">
          <p className={`text-xs ${body.length > 900 ? 'text-red-500' : 'text-gray-400'}`}>
            {body.length} / 1000
          </p>
          <button className="btn-primary flex items-center gap-1.5 text-sm"
            onClick={handleSend} disabled={sending || !to || !subject.trim() || !body.trim()}>
            <MdSend size={15} /> {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Messages panel ────────────────────────────────────────────────────────

function MsgPanel({ conversations, user, onCompose, onClose }) {
  const navigate = useNavigate()

  const goToConversation = (convId) => {
    const path = (user?.role === 'agency' || user?.role === 'agency_admin') ? '/agency/messages'
               : user?.role === 'patient' ? '/patient/messages'
               : '/admin/messages'
    navigate(`${path}?conv=${convId}`)
    onClose()
  }

  const goToAll = () => {
    const path = (user?.role === 'agency' || user?.role === 'agency_admin') ? '/agency/messages'
               : user?.role === 'patient' ? '/patient/messages'
               : '/admin/messages'
    navigate(path)
    onClose()
  }

  return (
    <div className="absolute right-0 top-12 w-80 bg-white rounded-xl border border-gray-100 shadow-xl z-50 overflow-hidden flex flex-col max-h-[calc(100vh-90px)]">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-800">Messages</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={16} /></button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && (
          <div className="py-10 flex flex-col items-center gap-2 px-4 text-center">
            <MdMessage size={32} className="text-gray-200" />
            <p className="text-xs text-gray-400">No messages yet</p>
            {user?.role === 'patient' && (
              <p className="text-xs text-gray-400">
                Tap <strong>New Message</strong> below to contact hospital staff or your agency.
              </p>
            )}
          </div>
        )}
        {conversations.map(c => {
          const oUid     = c.participants?.find(p => p !== user.uid)
          const name     = c.names?.[oUid] ?? 'Unknown'
          const isUnread = (c.unread?.[user.uid] ?? 0) > 0
          return (
            <button key={c.id}
              className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 border-b border-gray-50 text-left transition-colors"
              onClick={() => goToConversation(c.id)}>
              <div className={`flex-shrink-0 w-9 h-9 rounded-full ${isUnread ? 'bg-brand-500' : 'bg-gray-200'} text-white text-xs font-bold flex items-center justify-center`}>
                {name[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-1">
                  <p className={`text-sm truncate ${isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>{name}</p>
                  <span className="text-xs text-gray-400 flex-shrink-0">{timeAgo(c.lastAt)}</span>
                </div>
                {c.subject && (
                  <p className={`text-xs truncate ${isUnread ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>{c.subject}</p>
                )}
                <p className="text-xs text-gray-400 truncate">{c.lastMessage || 'No messages yet'}</p>
              </div>
              {isUnread
                ? <span className="w-2 h-2 bg-brand-500 rounded-full flex-shrink-0 mt-1.5 block" />
                : user?.role !== 'patient'
                  ? <MdCheckCircle size={14} className="text-gray-200 flex-shrink-0 mt-1.5" />
                  : null
              }
            </button>
          )
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 flex-shrink-0 bg-gray-50">
        <button className="text-xs text-brand-500 hover:text-brand-600 font-medium" onClick={goToAll}>
          See all →
        </button>
        <button
          className="flex items-center gap-1 text-xs bg-brand-500 text-white px-2.5 py-1.5 rounded-lg hover:bg-brand-600 transition-colors"
          onClick={() => {
            if (user?.role === 'patient') {
              navigate('/patient/messages')
              onClose()
            } else {
              onCompose()
              onClose()
            }
          }}>
          + New Message
        </button>
      </div>
    </div>
  )
}

// ── Sidebar content ───────────────────────────────────────────────────────

function NavItems({ items, onClose, badgeOverrides = {} }) {
  return items.map(item => {
    const badge = item.to in badgeOverrides ? badgeOverrides[item.to] : item.badge
    return (
      <NavLink
        key={item.to}
        to={item.to}
        onClick={onClose}
        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
      >
        <item.icon size={18} className="flex-shrink-0" />
        <span className="flex-1 truncate">{item.label}</span>
        {badge > 0 && (
          <span className="text-xs font-bold bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center flex-shrink-0">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </NavLink>
    )
  })
}

function SidebarContent({ role, agencyName, onClose, pendingDocsCount = 0, agencyInboxCount = 0, unreadMessages = 0 }) {
  const msgBadge = unreadMessages > 0 ? unreadMessages : 0
  const msgOverride = {
    '/patient/messages': msgBadge,
    '/agency/messages':  msgBadge,
    '/admin/messages':   msgBadge,
    '/agency/inbox':     agencyInboxCount,
  }
  return (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-brand-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <MdShield size={15} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900 leading-tight">MAPA</p>
            <p className="text-xs text-gray-400 leading-tight">CRMC</p>
          </div>
        </div>
        {/* Close button — mobile only */}
        <button className="lg:hidden w-11 h-11 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors" onClick={onClose}>
          <MdClose size={20} />
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {role === ROLES.PATIENT && (
          <>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-widest px-3 mb-2">Menu</p>
            <NavItems items={PATIENT_NAV} onClose={onClose} badgeOverrides={msgOverride} />
          </>
        )}
        {(role === ROLES.AGENCY || role === ROLES.AGENCY_ADMIN) && (
          <>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-widest px-3 mb-2 truncate">{agencyName}</p>
            <NavItems
              items={AGENCY_NAV.filter(item => !item.adminOnly || role === ROLES.AGENCY_ADMIN)}
              onClose={onClose}
              badgeOverrides={msgOverride}
            />
          </>
        )}
        {(role === ROLES.SUPER_ADMIN || role === ROLES.STAFF_ADMIN) && (
          <>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-widest px-3 mb-2">System Admin</p>
            <NavItems
              items={ADMIN_NAV.management.filter(item =>
                role === ROLES.SUPER_ADMIN || (!item.superOnly && item.to !== '/admin/accounts')
              )}
              onClose={onClose}
              badgeOverrides={msgOverride}
            />
            <p className="text-xs font-medium text-gray-400 uppercase tracking-widest px-3 mb-2 mt-4">Operations</p>
            <NavItems
              items={ADMIN_NAV.operations.filter(item =>
                role === ROLES.SUPER_ADMIN || item.to !== '/admin/auditlog'
              )}
              onClose={onClose}
              badgeOverrides={{ '/admin/docreview': pendingDocsCount }}
            />
          </>
        )}
      </nav>
    </div>
  )
}

// ── Apps Grid panel ──────────────────────────────────────────────────────

const APPS = {
  [ROLES.PATIENT]: [
    { label: 'Dashboard',      icon: MdDashboard,     to: '/patient/dashboard'  },
    { label: 'Find Programs',  icon: MdSearch,        to: '/patient/screening'  },
    { label: 'Programs',       icon: MdLocalHospital, to: '/patient/programs'   },
    { label: 'Track Status',   icon: MdTimeline,      to: '/patient/status'     },
    { label: 'My Documents',   icon: MdFolder,        to: '/patient/documents'  },
    { label: 'Interviews',     icon: MdVideoCall,     to: '/patient/interviews' },
  ],
  [ROLES.AGENCY]: [
    { label: 'Dashboard',     icon: MdDashboard,      to: '/agency/dashboard'    },
    { label: 'Inbox',         icon: MdInbox,          to: '/agency/inbox'        },
    { label: 'Interviews',    icon: MdVideoCall,      to: '/agency/interviews'   },
    { label: 'GL Letters',    icon: MdCardMembership, to: '/agency/generator'    },
    { label: 'Funds',         icon: MdAttachMoney,    to: '/agency/funds'        },
    { label: 'Slot Mgmt',     icon: MdBarChart,       to: '/agency/slots'        },
    { label: 'App Logs',      icon: MdListAlt,        to: '/agency/logs'         },
    { label: 'Messages',      icon: MdMessage,        to: '/agency/messages'     },
    { label: 'Profile',       icon: MdDescription,    to: '/agency/program'      },
    { label: 'Guide',         icon: MdMenuBook,       to: '/agency/guide'        },
  ],
  [ROLES.AGENCY_ADMIN]: [
    { label: 'Dashboard',     icon: MdDashboard,      to: '/agency/dashboard'    },
    { label: 'Inbox',         icon: MdInbox,          to: '/agency/inbox'        },
    { label: 'Interviews',    icon: MdVideoCall,      to: '/agency/interviews'   },
    { label: 'GL Letters',    icon: MdCardMembership, to: '/agency/generator'    },
    { label: 'Funds',         icon: MdAttachMoney,    to: '/agency/funds'        },
    { label: 'Allocation',    icon: MdAttachMoney,    to: '/agency/allocation'   },
    { label: 'Slot Mgmt',     icon: MdBarChart,       to: '/agency/slots'        },
    { label: 'App Logs',      icon: MdListAlt,        to: '/agency/logs'         },
    // Audit Log entry pending — page to be added; rules already allow
    // agency_admin to read auditLog entries where actorAgencyId matches.
    { label: 'Messages',      icon: MdMessage,        to: '/agency/messages'     },
    { label: 'Profile',       icon: MdDescription,    to: '/agency/program'      },
    { label: 'Guide',         icon: MdMenuBook,       to: '/agency/guide'        },
  ],
  [ROLES.SUPER_ADMIN]: [
    { label: 'Dashboard',      icon: MdDashboard,            to: '/admin/dashboard'   },
    { label: 'Agencies',       icon: MdBusiness,              to: '/admin/agencies'      },
    { label: 'Coordinators',   icon: MdGroup,                 to: '/admin/coordinators'  },
    { label: 'Accounts',       icon: MdSupervisedUserCircle,  to: '/admin/accounts'      },
    { label: 'Doc Types',      icon: MdDescription,          to: '/admin/doctypes'    },
    { label: 'Assistance',     icon: MdFavorite,             to: '/admin/assistance'  },
    { label: 'App Logs',       icon: MdListAlt,              to: '/admin/logs'        },
    { label: 'Doc Review',     icon: MdFactCheck,            to: '/admin/docreview'   },
    { label: 'Patients',       icon: MdGroup,                to: '/admin/patients'    },
    { label: 'Access Codes',   icon: MdBadge,                to: '/admin/hospitalids' },
    { label: 'Messages',       icon: MdEmail,                to: '/admin/messages'    },
    { label: 'Reports',        icon: MdFlag,                 to: '/admin/reports'     },
    { label: 'Audit Log',      icon: MdHistory,              to: '/admin/auditlog'    },
  ],
}
APPS[ROLES.STAFF_ADMIN] = APPS[ROLES.SUPER_ADMIN].filter(a =>
  a.to !== '/admin/accounts' && a.to !== '/admin/auditlog' && a.to !== '/admin/coordinators'
)

function AppsPanel({ role, onNavigate, onClose }) {
  const apps = APPS[role] || []
  return (
    <div className="absolute right-0 top-12 w-72 bg-white rounded-xl border border-gray-100 shadow-xl z-50 p-3">
      <div className="flex items-center justify-between mb-2 px-1">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Quick Navigation</p>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={15} /></button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {apps.map(app => (
          <button
            key={app.to}
            onClick={() => { onNavigate(app.to); onClose() }}
            className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl hover:bg-gray-50 transition-colors group"
          >
            <div className="w-10 h-10 bg-brand-50 group-hover:bg-brand-100 rounded-xl flex items-center justify-center transition-colors">
              <app.icon size={20} className="text-brand-500" />
            </div>
            <span className="text-xs text-gray-600 font-medium text-center leading-tight">{app.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Profile dropdown panel ────────────────────────────────────────────────

function ProfilePanel({ user, avatarColor, initials, roleLabel, onLogout, onClose, onSetModal }) {
  const navigate = useNavigate()

  const GUIDE_PATH = {
    patient: '/patient/guide',
    agency:  '/agency/guide',
  }

  const handleMenuClick = (item) => {
    if (item.label === 'Help & Support') {
      const guidePath = GUIDE_PATH[user?.role]
      if (guidePath) { navigate(guidePath); onClose() }
      else { onSetModal('help'); onClose() }
    } else {
      onSetModal(item.modal)
      onClose()
    }
  }

  const MENU_ITEMS = [
    { icon: MdPerson,   label: 'Account Settings',  modal: 'account',  chevron: true  },
    { icon: MdLock,     label: 'Change Password',    modal: 'password', chevron: true  },
    { icon: MdShield,   label: 'Privacy Notice',      modal: 'settings', chevron: true  },
    { icon: MdHelp,     label: 'Help & Support',     modal: 'help',     chevron: true  },
    { icon: MdFlag,     label: 'Report a Problem',   modal: 'report',   chevron: false },
  ]

  return (
    <div className="absolute right-0 top-12 w-72 bg-white rounded-xl border border-gray-100 shadow-xl z-50 overflow-hidden">
      {/* Profile card */}
      <div className="p-3">
        <button
          onClick={() => { onSetModal('account'); onClose() }}
          className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors text-left"
        >
          <div className={`w-12 h-12 rounded-full overflow-hidden border-2 flex-shrink-0 flex items-center justify-center text-base font-bold ${user?.photoURL ? 'border-gray-200' : avatarColor}`}>
            {user?.photoURL
              ? <img src={user.photoURL} alt={user?.name} className="w-full h-full object-cover" />
              : initials
            }
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{user?.name}</p>
            <p className="text-xs text-gray-400">{roleLabel}</p>
          </div>
        </button>
      </div>

      <div className="border-t border-gray-100 mx-3" />

      {/* Menu items */}
      <div className="p-2">
        {MENU_ITEMS.map((item, i) => (
          <button
            key={i}
            onClick={() => handleMenuClick(item)}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 transition-colors text-left"
          >
            <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
              <item.icon size={17} className="text-gray-600" />
            </div>
            <span className="flex-1 text-sm text-gray-800 font-medium">{item.label}</span>
            {item.chevron && <MdChevronRight size={18} className="text-gray-400 flex-shrink-0" />}
          </button>
        ))}
      </div>

      <div className="border-t border-gray-100 mx-3" />

      {/* Logout */}
      <div className="p-2">
        <button
          onClick={() => { onLogout(); onClose() }}
          className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-red-50 transition-colors text-left group"
        >
          <div className="w-8 h-8 bg-red-50 group-hover:bg-red-100 rounded-full flex items-center justify-center flex-shrink-0 transition-colors">
            <MdLogout size={17} className="text-red-500 transition-colors" />
          </div>
          <span className="text-sm text-red-500 font-medium">Log out</span>
        </button>
      </div>

      {/* Footer */}
      <div className="px-4 pb-3 pt-1">
        <p className="text-xs text-gray-400 text-center">Privacy · Terms · MAPA Portal · CRMC</p>
      </div>
    </div>
  )
}

// ── Main Layout ───────────────────────────────────────────────────────────

export default function Layout({ children, breadcrumb }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen]   = useState(false)
  const [showApps, setShowApps]         = useState(false)
  const [showNotifs, setShowNotifs]     = useState(false)
  const [showMessages, setShowMessages] = useState(false)
  const [showProfile, setShowProfile]   = useState(false)
  const [activeModal, setActiveModal]   = useState(null)
  const [notifications, setNotifications]   = useState([])
  const [conversations, setConversations]   = useState([])
  const [showCompose, setShowCompose]       = useState(false)
  const [pendingDocsCount, setPendingDocsCount] = useState(0)
  const [agencyInboxCount, setAgencyInboxCount] = useState(0)
  const [liveAgencyName, setLiveAgencyName]     = useState(null)
  const [banners, setBanners]                   = useState([])
  const knownNotifIds  = useRef(null)   // null = initial load not yet done

  const closeAll = () => { setShowApps(false); setShowNotifs(false); setShowMessages(false); setShowProfile(false) }

  useEffect(() => {
    if (!user?.uid) return
    const q = query(
      collection(db, 'notifications', user.uid, 'items'),
      orderBy('createdAt', 'desc'),
      limit(30)
    )
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setNotifications(items)

      if (knownNotifIds.current === null) {
        // First load — record existing IDs silently, don't toast
        knownNotifIds.current = new Set(items.map(i => i.id))
        return
      }

      // Find notifications that weren't in the previous snapshot
      const newItems = items.filter(i => !knownNotifIds.current.has(i.id))
      knownNotifIds.current = new Set(items.map(i => i.id))

      for (const notif of newItems) {
        const meta = NOTIF_ICONS[notif.type] ?? NOTIF_ICONS.app_submitted
        const Icon = meta.icon
        toast.custom((t) => (
          <div
            className={`flex items-start gap-3 px-4 py-3 bg-white rounded-xl shadow-lg border border-gray-100 max-w-sm w-full cursor-pointer transition-opacity ${t.visible ? 'opacity-100' : 'opacity-0'}`}
            onClick={() => {
              const route = getNotifRoute(notif.type, user?.role)
              if (route) navigate(route)
              toast.dismiss(t.id)
            }}
          >
            <div className={`w-9 h-9 rounded-full ${meta.bg} flex items-center justify-center flex-shrink-0`}>
              <Icon size={16} className={meta.color} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 leading-snug">{notif.title}</p>
              <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-snug">{notif.body}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); toast.dismiss(t.id) }}
              className="text-gray-300 hover:text-gray-500 flex-shrink-0 mt-0.5"
            >
              <MdClose size={14} />
            </button>
          </div>
        ), { duration: 5000, position: 'bottom-right' })
      }
    })
    return unsub
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid) return
    const q = query(collection(db, 'conversations'), where('participants', 'array-contains', user.uid))
    const unsub = onSnapshot(q, snap => {
      setConversations(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.lastAt?.seconds ?? 0) - (a.lastAt?.seconds ?? 0))
      )
    })
    return unsub
  }, [user?.uid])

  const totalUnreadMessages = conversations.reduce((sum, c) => sum + (c.unread?.[user?.uid] ?? 0), 0)

  useEffect(() => {
    if (user?.role !== ROLES.SUPER_ADMIN && user?.role !== ROLES.STAFF_ADMIN) return
    const q = query(collection(db, 'documents'), where('status', '==', 'pending'))
    const unsub = onSnapshot(q, snap => setPendingDocsCount(snap.size))
    return unsub
  }, [user?.uid, user?.role])

  // Agency-only: live Inbox pending count + live agency name
  useEffect(() => {
    if ((user?.role !== ROLES.AGENCY && user?.role !== ROLES.AGENCY_ADMIN) || !user?.agencyId) return
    const inboxQ = query(
      collection(db, 'applications'),
      where('agencyId', '==', user.agencyId),
      where('status', 'in', ['pending', 'reviewing'])
    )
    const u1 = onSnapshot(inboxQ, snap => setAgencyInboxCount(snap.size), () => setAgencyInboxCount(0))
    const u2 = onSnapshot(doc(db, 'agencies', user.agencyId),
      snap => snap.exists() && setLiveAgencyName(snap.data().name),
      () => {}
    )
    return () => { u1(); u2() }
  }, [user?.uid, user?.role, user?.agencyId])

  // ── Announcement banners ───────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return
    const TWENTY_FOUR_H = 24 * 60 * 60 * 1000
    const dismissed = JSON.parse(sessionStorage.getItem('dismissed_announcements') || '[]')
    const now = Date.now()

    getDocs(query(collection(db, 'announcements'), where('active', '==', true)))
      .then(async snap => {
        const live = []
        for (const d of snap.docs) {
          const ann   = { id: d.id, ...d.data() }
          const start = ann.startAt?.toDate?.()?.getTime() ?? 0
          const end   = ann.endAt?.toDate?.()?.getTime()   ?? 0

          // Show banner if currently within the window and not dismissed
          if (now >= start && now <= end && !dismissed.includes(ann.id)) {
            live.push(ann)
          }

          // 24h reminder: upcoming within 24h, not yet reminded — first user triggers it
          if (now < start && (start - now) <= TWENTY_FOUR_H && !ann.reminderSent) {
            updateDoc(doc(db, 'announcements', ann.id), { reminderSent: true })
              .then(async () => {
                const allUsers = await getDocs(collection(db, 'users'))
                const cfg = { maintenance: '⚙️', warning: '⚠️', info: 'ℹ️' }[ann.type] ?? 'ℹ️'
                await Promise.all(allUsers.docs.map(u =>
                  notify(u.id, {
                    type:  'system_announcement',
                    title: `${cfg} Reminder: ${ann.title}`,
                    body:  `Scheduled in less than 24 hours. ${ann.message}`,
                  }).catch(() => {})
                ))
              }).catch(() => {})
          }
        }
        setBanners(live)
      }).catch(() => {})
  }, [user?.uid])

  const dismissBanner = (id) => {
    const dismissed = JSON.parse(sessionStorage.getItem('dismissed_announcements') || '[]')
    sessionStorage.setItem('dismissed_announcements', JSON.stringify([...dismissed, id]))
    setBanners(prev => prev.filter(b => b.id !== id))
  }

  const unreadCount = notifications.filter(n => !n.read).length

  const markAllRead = async () => {
    // Query ALL unread — not just the 30 loaded in the panel
    const snap = await getDocs(
      query(
        collection(db, 'notifications', user.uid, 'items'),
        where('read', '==', false)
      )
    )
    if (snap.empty) return
    const batch = writeBatch(db)
    snap.docs.forEach(d => batch.update(d.ref, { read: true }))
    await batch.commit()
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
    toast.success('Logged out.')
  }

  const getInitials = (name) => name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'U'

  const getAvatarColor = () => {
    switch (user?.role) {
      case ROLES.PATIENT:      return 'bg-brand-50 text-brand-600 border-brand-400'
      case ROLES.AGENCY:       return 'bg-blue-50 text-blue-600 border-blue-400'
      case ROLES.AGENCY_ADMIN: return 'bg-teal-50 text-teal-600 border-teal-400'
      case ROLES.SUPER_ADMIN:  return 'bg-purple-50 text-purple-600 border-purple-400'
      case ROLES.STAFF_ADMIN:  return 'bg-purple-50 text-purple-600 border-purple-400'
      default:                 return 'bg-gray-100 text-gray-600 border-gray-300'
    }
  }

  const getRoleLabel = () => {
    switch (user?.role) {
      case ROLES.PATIENT:      return 'Patient'
      case ROLES.AGENCY:       return 'Agency Coordinator'
      case ROLES.AGENCY_ADMIN: return 'Agency Admin'
      case ROLES.SUPER_ADMIN:  return 'Super Admin'
      case ROLES.STAFF_ADMIN:  return 'Staff Admin'
      default:                 return ''
    }
  }

  const agencyName = liveAgencyName ?? 'Agency'

  const handleAvatarClick = () => {
    if (user?.role === ROLES.PATIENT) navigate('/patient/profile')
    else if (user?.role === ROLES.AGENCY || user?.role === ROLES.AGENCY_ADMIN) navigate('/agency/program')
    else navigate('/admin/profile')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <ProfileModals activeModal={activeModal} onClose={() => setActiveModal(null)} onSetModal={setActiveModal} />
      {showCompose && <ComposeModal user={user} onClose={() => setShowCompose(false)} />}

      {/* ── Mobile overlay ───────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-56 bg-white border-r border-gray-100 flex-shrink-0
        transform transition-transform duration-200 ease-in-out
        lg:static lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <SidebarContent
          role={user?.role}
          agencyName={agencyName}
          onClose={() => setSidebarOpen(false)}
          pendingDocsCount={pendingDocsCount}
          agencyInboxCount={agencyInboxCount}
          unreadMessages={totalUnreadMessages}
        />
      </aside>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* ── Top navigation bar ───────────────────────────────────── */}
        <header className="h-14 bg-white border-b border-gray-100 flex items-center justify-between px-3 sm:px-5 flex-shrink-0 z-30">

          {/* Left — hamburger + breadcrumb */}
          <div className="flex items-center gap-2 min-w-0">
            {/* Hamburger — mobile only */}
            <button
              className="nav-icon-btn flex-shrink-0 lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <MdMenu size={22} />
            </button>
            {/* Breadcrumb */}
            <div className="text-xs sm:text-sm text-gray-500 truncate">
              <span className="hidden sm:inline">MAPA Portal / </span>
              <span className="text-gray-800 font-medium">{breadcrumb}</span>
            </div>
          </div>

          {/* Right — Lang | Apps | Messages | Bell | Avatar */}
          <div className="flex items-center gap-1 flex-shrink-0">

            <LanguageToggle className="mr-1" />

            {/* 1. Apps Grid */}
            <div className="relative hidden sm:block">
              <button
                className={`nav-icon-btn ${showApps ? 'bg-brand-50 text-brand-600' : ''}`}
                aria-label="Apps"
                onClick={() => { setShowApps(p => !p); setShowNotifs(false); setShowMessages(false) }}
              >
                <MdApps size={20} />
              </button>
              {showApps && (
                <AppsPanel
                  role={user?.role}
                  onNavigate={navigate}
                  onClose={() => setShowApps(false)}
                />
              )}
            </div>

            {/* 2. Messages */}
            <div className="relative">
              <button
                className="nav-icon-btn"
                aria-label="Messages"
                onClick={() => { setShowMessages(p => !p); setShowApps(false); setShowNotifs(false) }}
              >
                <MdMessage size={20} />
                {totalUnreadMessages > 0 && (
                  <span className="absolute top-1 right-1 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
                    {totalUnreadMessages > 9 ? '9+' : totalUnreadMessages}
                  </span>
                )}
              </button>
              {showMessages && (
                <MsgPanel
                  conversations={conversations}
                  user={user}
                  onCompose={() => { setShowCompose(true); setShowMessages(false) }}
                  onClose={() => setShowMessages(false)}
                />
              )}
            </div>

            {/* 3. Notifications Bell */}
            <div className="relative">
              <button
                className="nav-icon-btn"
                aria-label="Notifications"
                onClick={() => { setShowNotifs(p => !p); setShowApps(false); setShowMessages(false) }}
              >
                <MdNotifications size={20} />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {showNotifs && (
                <NotifPanel
                  notifications={notifications}
                  unreadCount={unreadCount}
                  onMarkAllRead={markAllRead}
                  onClose={() => setShowNotifs(false)}
                  uid={user?.uid}
                  userRole={user?.role}
                />
              )}
            </div>

            {/* 4. User Avatar + Profile dropdown */}
            {user && (
              <div className="relative flex items-center gap-1.5 ml-1 pl-1.5 border-l border-gray-100">
                <div className="hidden md:block text-right">
                  <p className="text-xs font-medium text-gray-800 leading-tight">{user.name}</p>
                  <p className="text-xs text-gray-400 leading-tight">{getRoleLabel()}</p>
                </div>
                <button
                  className={`w-11 h-11 rounded-full overflow-hidden border-2 cursor-pointer flex-shrink-0 flex items-center justify-center text-xs font-semibold ${user.photoURL ? 'border-gray-200' : getAvatarColor()}`}
                  onClick={() => { setShowProfile(p => !p); setShowApps(false); setShowNotifs(false); setShowMessages(false) }}
                  title="Profile"
                >
                  {user.photoURL
                    ? <img src={user.photoURL} alt={user.name} className="w-full h-full object-cover" />
                    : getInitials(user.name)
                  }
                </button>
                {showProfile && (
                  <ProfilePanel
                    user={user}
                    avatarColor={getAvatarColor()}
                    initials={getInitials(user.name)}
                    roleLabel={getRoleLabel()}
                    onLogout={handleLogout}
                    onClose={() => setShowProfile(false)}
                    onSetModal={setActiveModal}
                  />
                )}
              </div>
            )}
          </div>
        </header>

        {/* ── Announcement banners ─────────────────────────────────── */}
        {banners.map(b => {
          const BANNER_CONFIG = {
            maintenance: { Icon: MdBuildCircle, bg: 'bg-amber-50', border: 'border-amber-200', iconCls: 'text-amber-600', badge: 'bg-amber-100 text-amber-700' },
            warning:     { Icon: MdWarning,     bg: 'bg-red-50',   border: 'border-red-200',   iconCls: 'text-red-600',   badge: 'bg-red-100 text-red-700'   },
            info:        { Icon: MdInfo,        bg: 'bg-blue-50',  border: 'border-blue-200',  iconCls: 'text-blue-600',  badge: 'bg-blue-100 text-blue-700' },
          }
          const cfg = BANNER_CONFIG[b.type] ?? BANNER_CONFIG.info
          const { Icon } = cfg
          const end = b.endAt?.toDate?.()?.getTime() ?? 0
          const diff = end - Date.now()
          const hrs  = diff > 0 ? Math.floor(diff / 3600000) : 0
          const mins = diff > 0 ? Math.floor((diff % 3600000) / 60000) : 0
          const countdown = diff > 0
            ? hrs > 0 ? `Ends in ${hrs}h ${mins}m` : `Ends in ${mins}m`
            : null
          return (
            <div key={b.id}
              className={`flex items-center gap-3 px-5 py-2.5 flex-shrink-0 border-b ${cfg.bg} ${cfg.border}`}>
              <Icon size={17} className={`${cfg.iconCls} flex-shrink-0`} />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-gray-900 mr-2">{b.title}</span>
                <span className="text-sm text-gray-600">{b.message}</span>
              </div>
              {countdown && (
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${cfg.badge}`}>
                  {countdown}
                </span>
              )}
              <button onClick={() => dismissBanner(b.id)}
                className={`${cfg.iconCls} opacity-50 hover:opacity-100 flex-shrink-0 transition-opacity`}>
                <MdClose size={16} />
              </button>
            </div>
          )
        })}

        {/* ── Page content ─────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto flex flex-col">
          {children}
        </main>
      </div>
    </div>
  )
}
