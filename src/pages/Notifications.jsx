import { useState, useEffect } from 'react'
import Layout from '../components/Layout'
import { collection, query, orderBy, onSnapshot, doc, writeBatch, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { useTranslation } from 'react-i18next'
import {
  MdDone, MdDelete, MdCheckCircle, MdNotificationsNone, MdClearAll,
  MdNotifications, MdStar, MdFolder, MdCancel, MdCalendarToday,
  MdInfo, MdCheckCircleOutline, MdAssignment, MdFavorite, MdEdit,
  MdDescription, MdSupervisedUserCircle, MdLock, MdLockOpen,
  MdSettings, MdKey, MdChat, MdFlag, MdBusiness,
} from 'react-icons/md'
import NotificationModal from '../components/NotificationModal'

// ── Category filter config ────────────────────────────────────────────────
// Labels are resolved at render time via t() so the page is bilingual.

const CATEGORY_DEFS = [
  { key: 'all'                                                                                                                              },
  { key: 'messages',     types: ['new_message']                                                                                            },
  { key: 'documents',    types: ['doc_verified','doc_rejected','doctype_added','doctype_updated','doctype_deleted']                       },
  { key: 'applications', types: ['app_submitted','app_advanced','interview_sched','interview_approved','certificate_ready']               },
  { key: 'accounts',     types: ['new_account','account_deactivated','account_activated','account_deleted','role_changed','password_reset_sent'] },
  { key: 'agencies',     types: ['new_agency','agency_created','agency_updated','agency_enabled','agency_disabled','agency_deleted']      },
  { key: 'system',       types: ['assistance_added','assistance_updated','assistance_deleted','report_submitted','system_announcement']   },
]

const getCategoryKey = (type) => CATEGORY_DEFS.find(c => c.types?.includes(type))?.key ?? null

// ── Notification type visuals — Material icons, civic tone (CLAUDE.md). ──

const NOTIF_VISUAL = {
  certificate_ready:   { Icon: MdStar,                  color: 'text-green-500',  bg: 'bg-green-50'  },
  interview_approved:  { Icon: MdCheckCircleOutline,    color: 'text-blue-500',   bg: 'bg-blue-50'   },
  doc_verified:        { Icon: MdFolder,                color: 'text-brand-500',  bg: 'bg-brand-50'  },
  doc_rejected:        { Icon: MdCancel,                color: 'text-red-500',    bg: 'bg-red-50'    },
  interview_sched:     { Icon: MdCalendarToday,         color: 'text-purple-500', bg: 'bg-purple-50' },
  app_advanced:        { Icon: MdInfo,                  color: 'text-amber-500',  bg: 'bg-amber-50'  },
  app_submitted:       { Icon: MdAssignment,            color: 'text-gray-500',   bg: 'bg-gray-50'   },
  agency_disabled:     { Icon: MdCancel,                color: 'text-red-500',    bg: 'bg-red-50'    },
  agency_enabled:      { Icon: MdCheckCircleOutline,    color: 'text-green-500',  bg: 'bg-green-50'  },
  agency_updated:      { Icon: MdSettings,              color: 'text-blue-500',   bg: 'bg-blue-50'   },
  agency_deleted:      { Icon: MdDelete,                color: 'text-red-500',    bg: 'bg-red-50'    },
  new_agency:          { Icon: MdBusiness,              color: 'text-teal-500',   bg: 'bg-teal-50'   },
  assistance_added:    { Icon: MdFavorite,              color: 'text-pink-500',   bg: 'bg-pink-50'   },
  assistance_updated:  { Icon: MdEdit,                  color: 'text-amber-500',  bg: 'bg-amber-50'  },
  assistance_deleted:  { Icon: MdDelete,                color: 'text-red-500',    bg: 'bg-red-50'    },
  doctype_added:       { Icon: MdDescription,           color: 'text-blue-500',   bg: 'bg-blue-50'   },
  doctype_updated:     { Icon: MdEdit,                  color: 'text-amber-500',  bg: 'bg-amber-50'  },
  doctype_deleted:     { Icon: MdDelete,                color: 'text-red-500',    bg: 'bg-red-50'    },
  new_account:         { Icon: MdSupervisedUserCircle,  color: 'text-purple-500', bg: 'bg-purple-50' },
  account_deactivated: { Icon: MdLock,                  color: 'text-orange-500', bg: 'bg-orange-50' },
  account_activated:   { Icon: MdLockOpen,              color: 'text-green-500',  bg: 'bg-green-50'  },
  account_deleted:     { Icon: MdDelete,                color: 'text-red-500',    bg: 'bg-red-50'    },
  role_changed:        { Icon: MdSettings,              color: 'text-blue-500',   bg: 'bg-blue-50'   },
  password_reset_sent: { Icon: MdKey,                   color: 'text-amber-500',  bg: 'bg-amber-50'  },
  new_message:         { Icon: MdChat,                  color: 'text-cyan-600',   bg: 'bg-cyan-50'   },
  report_submitted:    { Icon: MdFlag,                  color: 'text-orange-500', bg: 'bg-orange-50' },
  system_announcement: { Icon: MdInfo,                  color: 'text-amber-500',  bg: 'bg-amber-50'  },
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
  const { t }                             = useTranslation()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading]             = useState(true)
  const [selected, setSelected]           = useState(new Set())
  const [modalIdx, setModalIdx]           = useState(null)
  const [category, setCategory]           = useState('all')
  const [confirmClear, setConfirmClear]   = useState(false)
  const isPatient = user?.role === 'patient'

  // Category labels rebuilt per render so they respond to language toggle.
  const categoryLabel = (key) => t(`notifsPage.category.${key}`)

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
        const cat = CATEGORY_DEFS.find(c => c.key === category)
        return cat?.types?.includes(n.type)
      })

  const handleRowClick = (idx) => setModalIdx(idx)

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <Layout breadcrumb={t('notifsPage.title')}>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center">
              <MdNotifications size={20} className="text-brand-500" />
            </div>
            <div>
              <h1 className="page-title">{t('notifsPage.title')}</h1>
              <p className="page-sub">{t('notifsPage.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {unreadCount > 0 && (
              <span className="badge badge-blue">{t('notifsPage.unreadBadge', { count: unreadCount })}</span>
            )}
            {unreadCount > 0 && (
              <button onClick={markAllRead}
                className="btn-secondary text-xs flex items-center gap-1.5">
                <MdDone size={14} /> {t('notifsPage.markAllRead')}
              </button>
            )}
            {notifications.length > 0 && (
              <button onClick={() => setConfirmClear(true)}
                className="btn-secondary text-xs flex items-center gap-1 text-red-500 border-red-200 hover:bg-red-50">
                <MdClearAll size={14} /> {t('notifsPage.clearAll')}
              </button>
            )}
          </div>
        </div>

        {/* Clear all confirmation banner */}
        {confirmClear && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-red-700">
              {t('notifsPage.clearConfirm', { count: notifications.length })}
            </p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => setConfirmClear(false)}
                className="text-xs text-gray-600 font-medium hover:text-gray-800">
                {t('notifsPage.cancel')}
              </button>
              <button onClick={() => { clearAll(); setConfirmClear(false) }}
                className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">
                {t('notifsPage.clearYes')}
              </button>
            </div>
          </div>
        )}

        {/* Category filter tabs — patients only see relevant categories */}
        <div className="flex gap-1.5 mb-4 flex-wrap">
          {CATEGORY_DEFS.filter(c =>
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
                {categoryLabel(cat.key)}
                {count > 0 && (
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
                    category === cat.key ? 'bg-white text-brand-600' : 'bg-gray-100'
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
                  <MdDone size={14} /> {t('notifsPage.markAsRead')}
                </button>
                <button onClick={deleteSelected}
                  className="flex items-center gap-1.5 text-xs text-red-500 border border-red-200 bg-white px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
                  <MdDelete size={14} /> {t('notifsPage.delete')}
                </button>
                <span className="text-xs text-gray-400">{t('notifsPage.selectedCount', { count: selected.size })}</span>
              </>
            ) : (
              <span className="text-xs text-gray-500 font-medium">
                {t('notifsPage.countLabel', { count: notifications.length })}
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
              const meta        = NOTIF_VISUAL[n.type] ?? NOTIF_VISUAL.app_submitted
              const Icon        = meta.Icon
              const isSelected  = selected.has(n.id)
              const catKey      = getCategoryKey(n.type)

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
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full ${meta.bg} flex items-center justify-center`}>
                      <Icon size={16} className={meta.color} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={`text-sm ${!n.read ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                          {n.title}
                        </p>
                        {catKey && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-medium">
                            {categoryLabel(catKey)}
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
                  {category === 'all'
                    ? t('notifsPage.emptyAll')
                    : t('notifsPage.emptyCategory', { category: categoryLabel(category).toLowerCase() })}
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
