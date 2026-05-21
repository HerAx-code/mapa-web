import { useState, useEffect } from 'react'
import Layout from '../../components/Layout'
import {
  collection, query, orderBy, limit, getDocs, startAfter, getCountFromServer,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { MdSearch, MdHistory } from 'react-icons/md'
import toast from 'react-hot-toast'

// ── Config ────────────────────────────────────────────────────────────────

const ACTION_CONFIG = {
  doc_verified:        { label: 'Document Verified',        badge: 'bg-green-50 text-green-700 border-green-200'    },
  doc_rejected:        { label: 'Document Rejected',         badge: 'bg-red-50 text-red-700 border-red-200'          },
  doc_rereview:        { label: 'Sent for Re-review',        badge: 'bg-amber-50 text-amber-700 border-amber-200'    },
  agency_created:      { label: 'Agency Created',            badge: 'bg-teal-50 text-teal-700 border-teal-200'       },
  agency_updated:      { label: 'Agency Updated',            badge: 'bg-blue-50 text-blue-700 border-blue-200'       },
  agency_enabled:      { label: 'Agency Enabled',            badge: 'bg-green-50 text-green-700 border-green-200'    },
  agency_disabled:     { label: 'Agency Disabled',           badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  agency_deleted:      { label: 'Agency Deleted',            badge: 'bg-red-50 text-red-700 border-red-200'          },
  account_created:     { label: 'Account Created',           badge: 'bg-purple-50 text-purple-700 border-purple-200' },
  account_updated:     { label: 'Account Updated',           badge: 'bg-blue-50 text-blue-700 border-blue-200'       },
  account_deactivated: { label: 'Account Deactivated',       badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  account_activated:   { label: 'Account Activated',         badge: 'bg-green-50 text-green-700 border-green-200'    },
  account_deleted:     { label: 'Account Deleted',           badge: 'bg-red-50 text-red-700 border-red-200'          },
  patient_marked:      { label: 'Patient Marked for Delete', badge: 'bg-red-50 text-red-700 border-red-200'          },
  patient_unmarked:    { label: 'Patient Unmarked',          badge: 'bg-green-50 text-green-700 border-green-200'    },
  patient_deleted:     { label: 'Patient Deleted',           badge: 'bg-red-50 text-red-700 border-red-200'          },
  holding_applied:     { label: 'Holding Period Applied',    badge: 'bg-amber-50 text-amber-700 border-amber-200'    },
  holding_removed:     { label: 'Holding Period Removed',    badge: 'bg-green-50 text-green-700 border-green-200'    },
  hospitalid_added:    { label: 'Access Code Added',          badge: 'bg-brand-50 text-brand-700 border-brand-200'    },
  hospitalid_bulk:     { label: 'Access Codes Bulk Added',   badge: 'bg-brand-50 text-brand-700 border-brand-200'    },
  hospitalid_deleted:  { label: 'Access Code Deleted',       badge: 'bg-red-50 text-red-700 border-red-200'          },
  hospitalid_revoked:  { label: 'Access Code Revoked',       badge: 'bg-amber-50 text-amber-700 border-amber-200'    },
  doctype_added:       { label: 'Doc Type Added',            badge: 'bg-blue-50 text-blue-700 border-blue-200'       },
  doctype_updated:     { label: 'Doc Type Updated',          badge: 'bg-amber-50 text-amber-700 border-amber-200'    },
  doctype_deleted:     { label: 'Doc Type Deleted',          badge: 'bg-red-50 text-red-700 border-red-200'          },
  assistance_added:    { label: 'Assistance Type Added',     badge: 'bg-pink-50 text-pink-700 border-pink-200'       },
  assistance_updated:  { label: 'Assistance Type Updated',   badge: 'bg-amber-50 text-amber-700 border-amber-200'    },
  assistance_deleted:  { label: 'Assistance Type Deleted',   badge: 'bg-red-50 text-red-700 border-red-200'          },
  report_updated:         { label: 'Report Status Updated',    badge: 'bg-blue-50 text-blue-700 border-blue-200'    },
  report_deleted:         { label: 'Report Deleted',           badge: 'bg-red-50 text-red-700 border-red-200'       },
  announcement_created:   { label: 'Announcement Created',     badge: 'bg-brand-50 text-brand-700 border-brand-200' },
  announcement_updated:   { label: 'Announcement Updated',     badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  announcement_deleted:   { label: 'Announcement Deleted',     badge: 'bg-red-50 text-red-700 border-red-200'       },
}

const ACTION_CATEGORIES = [
  { key: 'all',         label: 'All',          actions: null },
  { key: 'documents',   label: 'Documents',    actions: ['doc_verified', 'doc_rejected', 'doc_rereview'] },
  { key: 'agencies',    label: 'Agencies',     actions: ['agency_created', 'agency_updated', 'agency_enabled', 'agency_disabled', 'agency_deleted'] },
  { key: 'accounts',    label: 'Accounts',     actions: ['account_created', 'account_updated', 'account_deactivated', 'account_activated', 'account_deleted'] },
  { key: 'patients',    label: 'Patients',     actions: ['patient_marked', 'patient_unmarked', 'patient_deleted', 'holding_applied', 'holding_removed'] },
  { key: 'hospitalids', label: 'Access Codes', actions: ['hospitalid_added', 'hospitalid_bulk', 'hospitalid_deleted', 'hospitalid_revoked'] },
  { key: 'config',      label: 'Config',       actions: ['doctype_added', 'doctype_updated', 'doctype_deleted', 'assistance_added', 'assistance_updated', 'assistance_deleted'] },
  { key: 'reports',       label: 'Reports',       actions: ['report_updated', 'report_deleted'] },
  { key: 'announcements', label: 'Announcements', actions: ['announcement_created', 'announcement_updated', 'announcement_deleted'] },
]

const DATE_FILTERS = [
  { key: 'all',   label: 'All Time'   },
  { key: 'today', label: 'Today'      },
  { key: 'week',  label: 'This Week'  },
  { key: 'month', label: 'This Month' },
]

const ROLE_LABEL = { super_admin: 'Super Admin', staff_admin: 'Staff Admin' }
const ROLE_AVATAR = {
  super_admin: 'bg-purple-100 text-purple-700',
  staff_admin: 'bg-blue-100 text-blue-700',
}

const fullDate = (ts) => {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const timeAgo = (ts) => {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1)  return 'just now'
  if (min < 60) return `${min}m ago`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return ''
}

// ── Main page ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 100

export default function AuditLog() {
  const [entries,        setEntries]        = useState([])
  const [loading,        setLoading]        = useState(true)
  const [loadingMore,    setLoadingMore]    = useState(false)
  const [lastVisible,    setLastVisible]    = useState(null)
  const [hasMore,        setHasMore]        = useState(false)
  const [totalCount,     setTotalCount]     = useState(null)
  const [search,         setSearch]         = useState('')
  const [dateFilter,     setDateFilter]     = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')

  const loadEntries = async (cursor = null) => {
    if (cursor) setLoadingMore(true)
    else setLoading(true)
    try {
      const constraints = [orderBy('createdAt', 'desc'), limit(PAGE_SIZE)]
      if (cursor) constraints.push(startAfter(cursor))
      const snap = await getDocs(query(collection(db, 'auditLog'), ...constraints))
      const batch = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setEntries(prev => cursor ? [...prev, ...batch] : batch)
      setLastVisible(snap.docs[snap.docs.length - 1] ?? null)
      setHasMore(snap.docs.length === PAGE_SIZE)
    } catch {
      toast.error('Failed to load audit log. Please try again.')
    } finally {
      if (cursor) setLoadingMore(false)
      else setLoading(false)
    }
  }

  useEffect(() => {
    loadEntries()
    getCountFromServer(collection(db, 'auditLog'))
      .then(snap => setTotalCount(snap.data().count))
      .catch(() => setTotalCount(0))
  }, [])

  const now = new Date()

  const todayCount = entries.filter(e => {
    if (!e.createdAt) return false
    const d = e.createdAt.toDate ? e.createdAt.toDate() : new Date(e.createdAt)
    return (now - d) / 3600000 < 24
  }).length

  const weekCount = entries.filter(e => {
    if (!e.createdAt) return false
    const d = e.createdAt.toDate ? e.createdAt.toDate() : new Date(e.createdAt)
    return (now - d) / 3600000 < 168
  }).length

  const filtered = entries.filter(e => {
    if (dateFilter !== 'all' && e.createdAt) {
      const d = e.createdAt.toDate ? e.createdAt.toDate() : new Date(e.createdAt)
      const diffHrs = (now - d) / 3600000
      if (dateFilter === 'today' && diffHrs > 24)  return false
      if (dateFilter === 'week'  && diffHrs > 168) return false
      if (dateFilter === 'month' && diffHrs > 720) return false
    }
    if (categoryFilter !== 'all') {
      const cat = ACTION_CATEGORIES.find(c => c.key === categoryFilter)
      if (cat?.actions && !cat.actions.includes(e.action)) return false
    }
    const q = search.toLowerCase()
    return !q ||
      e.actorName?.toLowerCase().includes(q) ||
      e.targetName?.toLowerCase().includes(q) ||
      e.details?.toLowerCase().includes(q) ||
      (ACTION_CONFIG[e.action]?.label ?? '').toLowerCase().includes(q)
  })

  const isFiltered = search || dateFilter !== 'all' || categoryFilter !== 'all'

  return (
    <Layout breadcrumb="Audit Log">
      <div className="p-4 sm:p-6">

        {/* Header */}
        <div className="mb-5">
          <h1 className="page-title">Audit Log</h1>
          <p className="page-sub">Complete record of all administrative actions across the portal.</p>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 mb-5">
          {[
            { label: 'Total Entries', value: totalCount ?? '—', color: 'text-gray-800'  },
            { label: 'Today',         value: todayCount,         color: 'text-brand-600' },
            { label: 'This Week',     value: weekCount,          color: 'text-blue-600'  },
          ].map((m, i) => (
            <div key={i} className="card p-4">
              <p className="text-xs text-gray-400 mb-1">{m.label}</p>
              <p className={`text-3xl font-semibold ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input className="input pl-9" placeholder="Search by actor, target, or action..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* Filters */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 w-16 flex-shrink-0">Date</span>
            {DATE_FILTERS.map(f => (
              <button key={f.key} onClick={() => setDateFilter(f.key)}
                className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  dateFilter === f.key
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 w-16 flex-shrink-0">Category</span>
            {ACTION_CATEGORIES.map(c => (
              <button key={c.key} onClick={() => setCategoryFilter(c.key)}
                className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  categoryFilter === c.key
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Result count + controls */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-gray-400">
            {filtered.length} entr{filtered.length !== 1 ? 'ies' : 'y'}
            {isFiltered && entries.length > 0 && ` (filtered from ${entries.length} loaded)`}
            {hasMore && !isFiltered && ' — more available'}
          </p>
          <div className="flex gap-2">
            <button className="btn-secondary text-xs py-1" onClick={() => loadEntries()}>
              Refresh
            </button>
            {hasMore && (
              <button className="btn-secondary text-xs py-1" disabled={loadingMore}
                onClick={() => loadEntries(lastVisible)}>
                {loadingMore ? 'Loading…' : `Load more (${entries.length} loaded)`}
              </button>
            )}
          </div>
        </div>

        {/* ── Activity feed ── */}
        <div className="card overflow-hidden divide-y divide-gray-50">

          {/* Skeleton */}
          {loading && Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-3 px-4 py-4 animate-pulse">
              <div className="w-8 h-8 rounded-full bg-gray-100 flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2.5 min-w-0">
                <div className="flex items-center justify-between gap-4">
                  <div className="h-3 bg-gray-100 rounded w-36" />
                  <div className="h-3 bg-gray-100 rounded w-28 flex-shrink-0" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-5 bg-gray-100 rounded-full w-28" />
                  <div className="h-3 bg-gray-100 rounded w-32" />
                </div>
                <div className="h-3 bg-gray-100 rounded w-3/4" />
              </div>
            </div>
          ))}

          {/* Entries */}
          {!loading && filtered.map(e => {
            const cfg       = ACTION_CONFIG[e.action]
            const ago       = timeAgo(e.createdAt)
            const avatarCls = ROLE_AVATAR[e.actorRole] ?? 'bg-gray-100 text-gray-600'

            return (
              <div key={e.id} className="flex gap-3 px-4 py-4 hover:bg-gray-50 transition-colors">

                {/* Avatar */}
                <div className={`w-8 h-8 rounded-full ${avatarCls} flex items-center justify-center text-sm font-semibold flex-shrink-0 mt-0.5`}>
                  {e.actorName?.[0]?.toUpperCase() ?? '?'}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">

                  {/* Row 1: actor + timestamp */}
                  <div className="flex items-start justify-between gap-4 mb-1.5">
                    <p className="text-sm font-semibold text-gray-800 leading-snug">
                      {e.actorName ?? '—'}
                      <span className="ml-1.5 text-xs font-normal text-gray-400">
                        {ROLE_LABEL[e.actorRole] ?? e.actorRole ?? ''}
                      </span>
                    </p>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-gray-500 whitespace-nowrap">{fullDate(e.createdAt)}</p>
                      {ago && <p className="text-xs text-gray-400">{ago}</p>}
                    </div>
                  </div>

                  {/* Row 2: action badge + target */}
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {cfg ? (
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border flex-shrink-0 ${cfg.badge}`}>
                        {cfg.label}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 font-mono flex-shrink-0">{e.action ?? '—'}</span>
                    )}
                    {e.targetName && (
                      <span className="text-sm text-gray-600 truncate">
                        {e.targetName}
                        {e.targetType && (
                          <span className="ml-1 text-xs text-gray-400 capitalize">({e.targetType})</span>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Row 3: details */}
                  {e.details && (
                    <p className="text-xs text-gray-400 leading-relaxed">{e.details}</p>
                  )}
                </div>
              </div>
            )
          })}

          {/* Empty state */}
          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <MdHistory size={36} className="text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">No entries found</p>
              <p className="text-xs text-gray-400">
                {isFiltered
                  ? 'No entries match your current filter. Try clearing the search or changing the category.'
                  : 'No audit log entries yet. Actions will be recorded here as admins use the portal.'}
              </p>
            </div>
          )}

        </div>

      </div>
    </Layout>
  )
}
