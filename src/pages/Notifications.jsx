import { useState, useEffect } from 'react'
import Layout from '../components/Layout'
import { collection, query, orderBy, onSnapshot, doc, writeBatch, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { MdDone, MdDelete, MdCheckCircle, MdNotificationsNone, MdClearAll } from 'react-icons/md'
import NotificationModal from '../components/NotificationModal'

// ── Category filter config ────────────────────────────────────────────────

const CATEGORIES = [
  { key: 'all',          label: 'All'          },
  { key: 'messages',     label: 'Messages',     types: ['new_message'] },
  { key: 'documents',    label: 'Documents',    types: ['doc_verified','doc_rejected','doctype_added','doctype_updated','doctype_deleted'] },
  { key: 'applications', label: 'Applications', types: ['app_submitted','app_advanced','interview_sched','interview_approved','certificate_ready'] },
  { key: 'accounts',     label: 'Accounts',     types: ['new_account','account_deactivated','account_activated','account_deleted','role_changed','password_reset_sent'] },
  { key: 'agencies',     label: 'Agencies',     types: ['new_agency','agency_created','agency_updated','agency_enabled','agency_disabled','agency_deleted'] },
  { key: 'system',       label: 'System',       types: ['assistance_added','assistance_updated','assistance_deleted','report_submitted'] },
]

const getCategoryLabel = (type) => {
  const cat = CATEGORIES.find(c => c.types?.includes(type))
  return cat?.label ?? null
}

// ── Notification type config ──────────────────────────────────────────────

const NOTIF_ICONS = {
  certificate_ready:   { emoji: '🏆', bg: 'bg-green-50'  },
  interview_approved:  { emoji: '✅', bg: 'bg-blue-50'   },
  doc_verified:        { emoji: '📁', bg: 'bg-brand-50'  },
  doc_rejected:        { emoji: '❌', bg: 'bg-red-50'    },
  interview_sched:     { emoji: '📅', bg: 'bg-purple-50' },
  app_advanced:        { emoji: 'ℹ️', bg: 'bg-amber-50'  },
  app_submitted:       { emoji: '📋', bg: 'bg-gray-50'   },
  agency_disabled:     { emoji: '🔕', bg: 'bg-red-50'    },
  agency_enabled:      { emoji: '✅', bg: 'bg-green-50'  },
  agency_updated:      { emoji: '⚙️', bg: 'bg-blue-50'   },
  agency_deleted:      { emoji: '🗑️', bg: 'bg-red-50'    },
  new_agency:          { emoji: '🏥', bg: 'bg-teal-50'   },
  assistance_added:    { emoji: '❤️', bg: 'bg-pink-50'   },
  assistance_updated:  { emoji: '✏️', bg: 'bg-amber-50'  },
  assistance_deleted:  { emoji: '🗑️', bg: 'bg-red-50'    },
  doctype_added:       { emoji: '📄', bg: 'bg-blue-50'   },
  doctype_updated:     { emoji: '✏️', bg: 'bg-amber-50'  },
  doctype_deleted:     { emoji: '🗑️', bg: 'bg-red-50'    },
  new_account:         { emoji: '👤', bg: 'bg-purple-50' },
  account_deactivated: { emoji: '🔒', bg: 'bg-orange-50' },
  account_activated:   { emoji: '🔓', bg: 'bg-green-50'  },
  account_deleted:     { emoji: '🗑️', bg: 'bg-red-50'    },
  role_changed:        { emoji: '⚙️', bg: 'bg-blue-50'   },
  password_reset_sent: { emoji: '🔑', bg: 'bg-amber-50'  },
  new_message:         { emoji: '💬', bg: 'bg-cyan-50'   },
  report_submitted:    { emoji: '🚩', bg: 'bg-orange-50' },
}


const fmtDate = (ts) => {
  if (!ts) return '—'
  const d   = ts.toDate ? ts.toDate() : new Date(ts)
  const now = new Date()
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function Notifications() {
  const { user }                          = useAuth()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading]             = useState(true)
  const [selected, setSelected]           = useState(new Set())
  const [modalIdx, setModalIdx]           = useState(null)
  const [category, setCategory]           = useState('all')
  const [confirmClear, setConfirmClear]   = useState(false)
  const isPatient = user?.role === 'patient'

  useEffect(() => {
    if (!user?.uid) return
    const q = query(
      collection(db, 'notifications', user.uid, 'items'),
      orderBy('createdAt', 'desc')
    )
    const unsub = onSnapshot(q, snap => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
    return unsub
  }, [user?.uid])

  const toggleSelect = (id) =>
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const selectAll = () =>
    setSelected(selected.size === notifications.length && notifications.length > 0
      ? new Set()
      : new Set(notifications.map(n => n.id))
    )

  const markSelectedRead = async () => {
    const batch = writeBatch(db)
    for (const id of selected)
      batch.update(doc(db, 'notifications', user.uid, 'items', id), { read: true })
    await batch.commit()
    setSelected(new Set())
  }

  const deleteSelected = async () => {
    const batch = writeBatch(db)
    for (const id of selected)
      batch.delete(doc(db, 'notifications', user.uid, 'items', id))
    await batch.commit()
    setSelected(new Set())
  }

  const markAllRead = async () => {
    const batch = writeBatch(db)
    notifications.filter(n => !n.read).forEach(n =>
      batch.update(doc(db, 'notifications', user.uid, 'items', n.id), { read: true })
    )
    await batch.commit()
  }

  const clearAll = async () => {
    const batch = writeBatch(db)
    notifications.forEach(n =>
      batch.delete(doc(db, 'notifications', user.uid, 'items', n.id))
    )
    await batch.commit()
  }

  const filtered = category === 'all'
    ? notifications
    : notifications.filter(n => {
        const cat = CATEGORIES.find(c => c.key === category)
        return cat?.types?.includes(n.type)
      })

  const handleRowClick = (idx) => setModalIdx(idx)

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <Layout breadcrumb="Notifications">
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center text-xl">🔔</div>
            <div>
              <h1 className="page-title">Notifications</h1>
              <p className="page-sub">All your alerts and updates. Tap any row to view details.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {unreadCount > 0 && (
              <span className="badge badge-blue">{unreadCount} unread</span>
            )}
            {unreadCount > 0 && (
              <button onClick={markAllRead}
                className="btn-secondary text-xs flex items-center gap-1">
                ✓ Mark all read
              </button>
            )}
            {notifications.length > 0 && (
              <button onClick={() => setConfirmClear(true)}
                className="btn-secondary text-xs flex items-center gap-1 text-red-500 border-red-200 hover:bg-red-50">
                <MdClearAll size={14} /> Clear all
              </button>
            )}
          </div>
        </div>

        {/* Clear all confirmation banner */}
        {confirmClear && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-red-700">
              This will permanently delete all <strong>{notifications.length}</strong> notification{notifications.length !== 1 ? 's' : ''}. This cannot be undone.
            </p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => setConfirmClear(false)}
                className="text-xs text-gray-600 font-medium hover:text-gray-800">
                Cancel
              </button>
              <button onClick={() => { clearAll(); setConfirmClear(false) }}
                className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">
                Yes, clear all
              </button>
            </div>
          </div>
        )}

        {/* Category filter tabs — patients only see relevant categories */}
        <div className="flex gap-1.5 mb-4 flex-wrap">
          {CATEGORIES.filter(c =>
            !isPatient || ['all','messages','documents','applications'].includes(c.key)
          ).map(cat => {
            const count = cat.key === 'all'
              ? notifications.length
              : notifications.filter(n => cat.types?.includes(n.type)).length
            if (cat.key !== 'all' && count === 0) return null
            return (
              <button key={cat.key}
                onClick={() => { setCategory(cat.key); setSelected(new Set()) }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  category === cat.key
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                {cat.label}
                {count > 0 && (
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
                    category === cat.key ? 'bg-white/20' : 'bg-gray-100'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="card overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50">
            <input type="checkbox" className="w-4 h-4 accent-brand-500 flex-shrink-0"
              checked={selected.size === filtered.length && filtered.length > 0}
              onChange={selectAll} />
            {selected.size > 0 ? (
              <>
                <button onClick={markSelectedRead}
                  className="flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
                  <MdDone size={14} /> Mark as read
                </button>
                <button onClick={deleteSelected}
                  className="flex items-center gap-1.5 text-xs text-red-500 border border-red-200 bg-white px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
                  <MdDelete size={14} /> Delete
                </button>
                <span className="text-xs text-gray-400">{selected.size} selected</span>
              </>
            ) : (
              <span className="text-xs text-gray-500 font-medium">
                {notifications.length} notification{notifications.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* List */}
          <div className="divide-y divide-gray-50">

            {/* Skeleton loading */}
            {loading && Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5 animate-pulse">
                <div className="w-4 h-4 bg-gray-100 rounded flex-shrink-0" />
                <div className="w-8 h-8 rounded-full bg-gray-100 flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-gray-100 rounded w-48" />
                  <div className="h-2.5 bg-gray-100 rounded w-64" />
                </div>
                <div className="h-3 bg-gray-100 rounded w-16 flex-shrink-0" />
              </div>
            ))}

            {/* Notifications */}
            {!loading && filtered.map((n, idx) => {
              const meta        = NOTIF_ICONS[n.type] ?? NOTIF_ICONS.app_submitted
              const isSelected  = selected.has(n.id)
              const catLabel    = getCategoryLabel(n.type)

              return (
                <div key={n.id}
                  className={`transition-colors ${
                    isSelected ? 'bg-brand-50/20'
                    : !n.read  ? 'bg-amber-50/20'
                    : ''
                  }`}>

                  {/* Main row */}
                  <div
                    className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-black/[0.02] transition-colors"
                    onClick={() => handleRowClick(idx)}>

                    {/* Checkbox */}
                    <div className="flex-shrink-0" onClick={e => { e.stopPropagation(); toggleSelect(n.id) }}>
                      <input type="checkbox" className="w-4 h-4 accent-brand-500"
                        checked={isSelected} onChange={() => {}} />
                    </div>

                    {/* Icon */}
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full ${meta.bg} flex items-center justify-center text-sm`}>
                      {meta.emoji}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={`text-sm ${!n.read ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                          {n.title}
                        </p>
                        {catLabel && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-medium">
                            {catLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 line-clamp-2">{n.body}</p>
                    </div>

                    {/* Date + read indicator */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {fmtDate(n.createdAt)}
                      </span>
                      {!n.read
                        ? <span className="w-2.5 h-2.5 bg-brand-500 rounded-full" />
                        : !isPatient
                          ? <MdCheckCircle size={16} className="text-green-400" />
                          : null
                      }
                    </div>
                  </div>

                </div>
              )
            })}

            {/* Empty state */}
            {!loading && filtered.length === 0 && (
              <div className="text-center py-12">
                <MdNotificationsNone size={36} className="text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-400">
                  {category === 'all' ? 'No notifications yet.' : `No ${CATEGORIES.find(c => c.key === category)?.label.toLowerCase()} notifications.`}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {modalIdx !== null && (
        <NotificationModal
          notifications={filtered}
          currentIndex={modalIdx}
          uid={user?.uid}
          userRole={user?.role}
          onClose={() => setModalIdx(null)}
          onNavigate={setModalIdx}
        />
      )}
    </Layout>
  )
}
