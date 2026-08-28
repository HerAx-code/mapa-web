import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import {
  collection, query, where, orderBy, limit, getDocs, startAfter,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { MdSearch, MdHistory, MdLockOutline, MdDownload } from 'react-icons/md'
import toast from 'react-hot-toast'
import { exportToCSV, dateStamp } from '../../utils/export'
import { tsToDate } from '../../utils/dates'

// ── Config ────────────────────────────────────────────────────────────────

// Actions that can be performed by agency-side users (and thus appear in an
// agency_admin's slice of the audit log). Includes both fund operations
// and case-handling operations.
const ACTION_CONFIG = {
  // Fund / budget ──
  budget_allocated:           { label: 'Allocation Set',         badge: 'bg-blue-50    text-blue-700    border-blue-200'    },
  budget_period_reset:        { label: 'Period Reset',           badge: 'bg-brand-50   text-brand-700   border-brand-200'   },
  // GL lifecycle ──
  gl_redeemed:                { label: 'GL Redeemed',            badge: 'bg-purple-50  text-purple-700  border-purple-200'  },
  gl_unmark_redeemed:         { label: 'Redemption Reversed',    badge: 'bg-amber-50   text-amber-700   border-amber-200'   },
  gl_expired:                 { label: 'GL Expired (Manual)',    badge: 'bg-orange-50  text-orange-700  border-orange-200'  },
  gl_auto_expired:            { label: 'GL Expired (Auto)',      badge: 'bg-gray-50    text-gray-700    border-gray-200'    },
  approval_reversed:          { label: 'Approval Reversed',      badge: 'bg-red-50     text-red-700     border-red-200'     },
  // Role changes within this agency ──
  role_promoted_to_agency_admin: { label: 'Promoted to Admin',   badge: 'bg-amber-50   text-amber-700   border-amber-200'   },
  role_demoted_to_agency:        { label: 'Demoted to Coordinator', badge: 'bg-gray-50  text-gray-700    border-gray-200'    },
  // Account ops on agency members ──
  account_activated:          { label: 'Account Activated',      badge: 'bg-green-50   text-green-700   border-green-200'   },
  account_deactivated:        { label: 'Account Deactivated',    badge: 'bg-orange-50  text-orange-700  border-orange-200'  },
  account_deleted:            { label: 'Account Deleted',        badge: 'bg-red-50     text-red-700     border-red-200'     },
  account_created:            { label: 'Account Created',        badge: 'bg-purple-50  text-purple-700  border-purple-200'  },
  account_updated:            { label: 'Account Updated',        badge: 'bg-blue-50    text-blue-700    border-blue-200'    },
}

const ACTION_CATEGORIES = [
  { key: 'all',     label: 'All',         actions: null },
  { key: 'funds',   label: 'Funds',       actions: ['budget_allocated', 'budget_period_reset'] },
  { key: 'gl',      label: 'GL',          actions: ['gl_redeemed', 'gl_unmark_redeemed', 'gl_expired', 'gl_auto_expired', 'approval_reversed'] },
  { key: 'roles',   label: 'Roles',       actions: ['role_promoted_to_agency_admin', 'role_demoted_to_agency'] },
  { key: 'accounts',label: 'Accounts',    actions: ['account_activated', 'account_deactivated', 'account_deleted', 'account_created', 'account_updated'] },
]

const DATE_FILTERS = [
  { key: 'all',   label: 'All Time'   },
  { key: 'today', label: 'Today'      },
  { key: 'week',  label: 'This Week'  },
  { key: 'month', label: 'This Month' },
]

const fullDate = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
}

const timeAgo = (ts) => {
  const d = tsToDate(ts)
  if (!d) return ''
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1)  return 'just now'
  if (min < 60) return `${min}m ago`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return ''
}

const PAGE_SIZE = 100

// Mirror of admin/AuditLog's defense: clamp long user-supplied details to
// 240 chars by default. The Firestore rule caps writes at 2000 chars, but
// even 2000 chars is enough to bury a row — let the admin opt in to seeing
// the full payload.
const DETAILS_PREVIEW_LIMIT = 240
function AuditDetails({ text }) {
  const [expanded, setExpanded] = useState(false)
  if (!text) return null
  const isLong = text.length > DETAILS_PREVIEW_LIMIT
  const shown  = isLong && !expanded ? text.slice(0, DETAILS_PREVIEW_LIMIT) + '…' : text
  return (
    <p className="text-xs text-gray-500 leading-relaxed">
      {shown}
      {isLong && (
        <button
          type="button"
          className="ml-1 text-brand-500 hover:text-brand-600 underline underline-offset-2"
          onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </p>
  )
}

export default function AgencyAuditLog() {
  const { user }      = useAuth()
  const navigate      = useNavigate()
  const [entries,        setEntries]        = useState([])
  const [loading,        setLoading]        = useState(true)
  const [loadingMore,    setLoadingMore]    = useState(false)
  const [lastVisible,    setLastVisible]    = useState(null)
  const [hasMore,        setHasMore]        = useState(false)
  const [search,         setSearch]         = useState('')
  const [dateFilter,     setDateFilter]     = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')

  const isAgencyAdmin = user?.role === 'agency_admin'

  const loadEntries = async (cursor = null) => {
    if (!user?.agencyId) return
    if (cursor) setLoadingMore(true)
    else setLoading(true)
    try {
      const constraints = [
        where('actorAgencyId', '==', user.agencyId),
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE),
      ]
      if (cursor) constraints.push(startAfter(cursor))
      const snap = await getDocs(query(collection(db, 'auditLog'), ...constraints))
      const batch = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setEntries(prev => cursor ? [...prev, ...batch] : batch)
      setLastVisible(snap.docs[snap.docs.length - 1] ?? null)
      setHasMore(snap.docs.length === PAGE_SIZE)
    } catch (err) {
      console.error('[AgencyAuditLog] load error:', err)
      toast.error('Failed to load audit log.')
    } finally {
      if (cursor) setLoadingMore(false)
      else setLoading(false)
    }
  }

  useEffect(() => { if (isAgencyAdmin) loadEntries() }, [isAgencyAdmin, user?.agencyId])

  if (!isAgencyAdmin) {
    return (
      <Layout breadcrumb="Audit Log">
        <div className="p-4 sm:p-6 max-w-2xl">
          <div className="card p-6 bg-amber-50 border-amber-200 flex items-start gap-3">
            <MdLockOutline size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800 mb-1">Restricted to Agency Administrators</p>
              <p className="text-xs text-amber-700">
                The audit log shows every action taken by your agency's staff — approvals, redemptions, budget changes, role updates. Only the Agency Administrator can view it.
              </p>
              <button onClick={() => navigate('/agency/dashboard')}
                className="mt-3 text-xs font-medium text-amber-700 hover:text-amber-800 underline">
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      </Layout>
    )
  }

  // Apply client-side filters (date / category / search) on the loaded page
  const filtered = entries.filter(e => {
    // Date
    if (dateFilter !== 'all' && e.createdAt) {
      const d = tsToDate(e.createdAt)
      if (!d) return false
      const now = new Date()
      const ms = now.getTime() - d.getTime()
      if (dateFilter === 'today' && d.toDateString() !== now.toDateString()) return false
      if (dateFilter === 'week'  && ms > 7  * 86400000) return false
      if (dateFilter === 'month' && ms > 31 * 86400000) return false
    }
    // Category
    if (categoryFilter !== 'all') {
      const cat = ACTION_CATEGORIES.find(c => c.key === categoryFilter)
      if (cat?.actions && !cat.actions.includes(e.action)) return false
    }
    // Search
    if (search) {
      const q = search.toLowerCase()
      const hay = [e.actorName, e.targetName, e.details, e.action].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  return (
    <Layout breadcrumb="Audit Log">
      <div className="p-4 sm:p-6 max-w-5xl">

        {/* Header — Export CSV uses the current filter set so a
            COA auditor asking for "this quarter's budget actions"
            gets exactly the rows visible after the chips + search
            are applied. Disabled while loading or when there's
            nothing to export. */}
        <div className="mb-5 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="eyebrow">Accountability</p>
            <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Audit Log</h1>
            <p className="text-sm text-gray-500 mt-1">
              Every action taken by your agency's staff. Use this to satisfy COA-style accountability for fund movements and role changes.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary flex items-center gap-1.5 text-sm"
            disabled={loading || filtered.length === 0}
            onClick={() => exportToCSV(
              `agency-audit-${dateStamp()}.csv`,
              [
                { label: 'Timestamp',     getValue: e => fullDate(e.createdAt) },
                { label: 'Action',        getValue: e => (ACTION_CONFIG[e.action]?.label ?? e.action) },
                { label: 'Action Code',   getValue: e => e.action },
                { label: 'Actor',         getValue: e => e.actorName ?? 'System' },
                { label: 'Actor Role',    getValue: e => e.actorRole ?? '' },
                { label: 'Target',        getValue: e => e.targetName ?? '' },
                { label: 'Target Type',   getValue: e => e.targetType ?? '' },
                { label: 'Details',       getValue: e => e.details ?? '' },
              ],
              filtered,
            )}>
            <MdDownload size={15} /> Export CSV ({filtered.length})
          </button>
        </div>

        {/* Category chips */}
        <div className="flex gap-2 mb-3 flex-wrap">
          {ACTION_CATEGORIES.map(c => (
            <button key={c.key}
              onClick={() => setCategoryFilter(c.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                categoryFilter === c.key
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}>
              {c.label}
            </button>
          ))}
        </div>

        {/* Date + search */}
        <div className="flex gap-3 mb-5 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input className="input pl-9"
              placeholder="Search actor, target, or details..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-1">
            {DATE_FILTERS.map(d => (
              <button key={d.key}
                onClick={() => setDateFilter(d.key)}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  dateFilter === d.key
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">Loading audit log…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center">
              <MdHistory size={32} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">
                {search || dateFilter !== 'all' || categoryFilter !== 'all'
                  ? 'No entries match the current filters.'
                  : 'No audit entries yet. Actions taken by your agency staff will appear here.'}
              </p>
              {(search || dateFilter !== 'all' || categoryFilter !== 'all') && (
                <button
                  onClick={() => { setSearch(''); setDateFilter('all'); setCategoryFilter('all') }}
                  className="mt-3 inline-flex items-center text-sm font-medium text-brand-500 hover:text-brand-600">
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {filtered.map(e => {
                const cfg = ACTION_CONFIG[e.action] ?? { label: e.action, badge: 'bg-gray-50 text-gray-700 border-gray-200' }
                return (
                  <div key={e.id} className="px-5 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`badge text-xs border ${cfg.badge}`}>{cfg.label}</span>
                          {e.targetName && (
                            <span className="text-sm font-medium text-gray-800 truncate">{e.targetName}</span>
                          )}
                        </div>
                        {e.details && <AuditDetails text={e.details} />}
                        <p className="text-xs text-gray-400 mt-1">
                          by <strong>{e.actorName ?? 'System'}</strong>
                        </p>
                      </div>
                      <div className="text-xs text-gray-400 flex-shrink-0 text-right" title={fullDate(e.createdAt)}>
                        <div>{timeAgo(e.createdAt)}</div>
                        <div className="text-gray-300">{fullDate(e.createdAt)}</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Load more */}
          {!loading && hasMore && (
            <div className="px-5 py-3 border-t border-gray-100 flex justify-center">
              <button
                onClick={() => loadEntries(lastVisible)}
                disabled={loadingMore}
                className="text-xs font-medium px-4 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400 mt-4 leading-relaxed">
          <strong>Note —</strong> This log shows actions taken with your agency as the context. CRMC platform-level actions (account onboarding, doc verification across agencies) are visible only to the CRMC system administrator. Entries are append-only and immutable.
        </p>

      </div>
    </Layout>
  )
}
