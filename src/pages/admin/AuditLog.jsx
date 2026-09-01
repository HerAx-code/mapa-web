import { useState, useEffect } from 'react'
import Layout from '../../components/Layout'
import {
  collection, query, orderBy, limit, getDocs, startAfter, getCountFromServer,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { logAudit } from '../../utils/auditLog'
import { MdSearch, MdHistory, MdDownload } from 'react-icons/md'
import toast from 'react-hot-toast'
import { exportToCSV, dateStamp } from '../../utils/export'
import { tsToDate } from '../../utils/dates'
import { groupByDay } from '../../utils/groupByDay'

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
  // R22: request + interview + GL lifecycle actions were being LOGGED in
  // code but had no ACTION_CONFIG entry, so the audit log rendered them
  // with raw action keys and unstyled badges. Added each with a label +
  // matching badge color, and grouped under a new "Lifecycle" category.
  request_endorsed:       { label: 'Request Endorsed',          badge: 'bg-purple-50 text-purple-700 border-purple-200' },
  interview_scheduled:    { label: 'Interview Scheduled',       badge: 'bg-blue-50 text-blue-700 border-blue-200'       },
  interview_completed:    { label: 'Interview Completed',       badge: 'bg-green-50 text-green-700 border-green-200'    },
  intake_completed:       { label: 'Intake Completed',          badge: 'bg-teal-50 text-teal-700 border-teal-200'       },
  gl_redeemed:            { label: 'GL Redeemed',               badge: 'bg-green-50 text-green-700 border-green-200'    },
  gl_unmark_redeemed:     { label: 'GL Redemption Reversed',    badge: 'bg-amber-50 text-amber-700 border-amber-200'    },
  gl_expired:             { label: 'GL Expired',                badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  gl_auto_expired:        { label: 'GL Auto-Expired',           badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  approval_reversed:      { label: 'Approval Reversed',         badge: 'bg-red-50 text-red-700 border-red-200'          },
  // These actions were being LOGGED in code but had no ACTION_CONFIG entry, so
  // the audit log rendered them with raw keys, unstyled badges, and no category
  // filter (the same gap the R22 note fixed for the lifecycle actions).
  coverage_updated:       { label: 'Coverage Updated',          badge: 'bg-blue-50 text-blue-700 border-blue-200'       },
  request_assigned:       { label: 'Request Assigned',          badge: 'bg-blue-50 text-blue-700 border-blue-200'       },
  docs_requested:         { label: 'Documents Requested',       badge: 'bg-amber-50 text-amber-700 border-amber-200'    },
  request_rejected:       { label: 'Request Rejected',          badge: 'bg-red-50 text-red-700 border-red-200'          },
  request_closed:         { label: 'Request Closed',            badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  hospitalid_printed:     { label: 'Access Code Printed',       badge: 'bg-gray-50 text-gray-600 border-gray-200'       },
  data_exported:          { label: 'Data Exported',             badge: 'bg-cyan-50 text-cyan-700 border-cyan-200'       },
}

const ACTION_CATEGORIES = [
  { key: 'all',         label: 'All',          actions: null },
  { key: 'documents',   label: 'Documents',    actions: ['doc_verified', 'doc_rejected', 'doc_rereview'] },
  { key: 'agencies',    label: 'Agencies',     actions: ['agency_created', 'agency_updated', 'agency_enabled', 'agency_disabled', 'agency_deleted'] },
  { key: 'accounts',    label: 'Accounts',     actions: ['account_created', 'account_updated', 'account_deactivated', 'account_activated', 'account_deleted'] },
  { key: 'patients',    label: 'Patients',     actions: ['patient_marked', 'patient_unmarked', 'patient_deleted', 'holding_applied', 'holding_removed'] },
  { key: 'hospitalids', label: 'Access Codes', actions: ['hospitalid_added', 'hospitalid_bulk', 'hospitalid_deleted', 'hospitalid_revoked', 'hospitalid_printed'] },
  { key: 'config',      label: 'Config',       actions: ['doctype_added', 'doctype_updated', 'doctype_deleted', 'assistance_added', 'assistance_updated', 'assistance_deleted'] },
  { key: 'reports',       label: 'Reports',       actions: ['report_updated', 'report_deleted'] },
  { key: 'announcements', label: 'Announcements', actions: ['announcement_created', 'announcement_updated', 'announcement_deleted'] },
  // R22: request + interview + GL lifecycle filter.
  { key: 'lifecycle',     label: 'Lifecycle',     actions: ['request_assigned', 'docs_requested', 'coverage_updated', 'request_endorsed', 'request_rejected', 'request_closed', 'interview_scheduled', 'interview_completed', 'intake_completed', 'gl_redeemed', 'gl_unmark_redeemed', 'gl_expired', 'gl_auto_expired', 'approval_reversed'] },
  { key: 'exports',       label: 'Exports',       actions: ['data_exported'] },
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

// ── Audit details cell ────────────────────────────────────────────────────
// The `details` string is user-supplied (any authenticated caller of
// logAudit() can put anything in it). Clamp to 240 chars by default so a
// long payload doesn't dominate the row; "Show more" reveals the rest.
// Display only — never executed — but a 2 KB block of attacker-controlled
// text right under an admin's eye is exactly what we want to defuse.
const DETAILS_PREVIEW_LIMIT = 240
function AuditDetails({ text }) {
  const [expanded, setExpanded] = useState(false)
  if (!text) return null
  const isLong = text.length > DETAILS_PREVIEW_LIMIT
  const shown  = isLong && !expanded ? text.slice(0, DETAILS_PREVIEW_LIMIT) + '…' : text
  return (
    <p className="text-xs text-gray-400 leading-relaxed">
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

// ── Main page ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 100

export default function AuditLog() {
  const { user } = useAuth()
  const [entries,        setEntries]        = useState([])
  const [loading,        setLoading]        = useState(true)
  const [loadingMore,    setLoadingMore]    = useState(false)
  const [lastVisible,    setLastVisible]    = useState(null)
  const [hasMore,        setHasMore]        = useState(false)
  const [totalCount,     setTotalCount]     = useState(null)
  const [search,         setSearch]         = useState('')
  const [dateFilter,     setDateFilter]     = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [actorFilter,    setActorFilter]    = useState('all')

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
    const d = tsToDate(e.createdAt)
    return d ? (now - d) / 3600000 < 24 : false
  }).length

  const weekCount = entries.filter(e => {
    const d = tsToDate(e.createdAt)
    return d ? (now - d) / 3600000 < 168 : false
  }).length

  // Distinct actors present in the loaded entries, for the actor filter — the
  // accountability question "show me everything this person did".
  const actors = (() => {
    const map = new Map()
    entries.forEach(e => {
      if (e.actorId && !map.has(e.actorId)) map.set(e.actorId, { id: e.actorId, name: e.actorName ?? 'System', role: e.actorRole })
    })
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  })()

  const filtered = entries.filter(e => {
    if (dateFilter !== 'all' && e.createdAt) {
      const d = tsToDate(e.createdAt)
      if (!d) return false
      const diffHrs = (now - d) / 3600000
      if (dateFilter === 'today' && diffHrs > 24)  return false
      if (dateFilter === 'week'  && diffHrs > 168) return false
      if (dateFilter === 'month' && diffHrs > 720) return false
    }
    if (categoryFilter !== 'all') {
      const cat = ACTION_CATEGORIES.find(c => c.key === categoryFilter)
      if (cat?.actions && !cat.actions.includes(e.action)) return false
    }
    if (actorFilter !== 'all' && e.actorId !== actorFilter) return false
    const q = search.toLowerCase()
    return !q ||
      e.actorName?.toLowerCase().includes(q) ||
      e.targetName?.toLowerCase().includes(q) ||
      e.details?.toLowerCase().includes(q) ||
      (ACTION_CONFIG[e.action]?.label ?? '').toLowerCase().includes(q)
  })

  const isFiltered = search || dateFilter !== 'all' || categoryFilter !== 'all' || actorFilter !== 'all'

  // Per-category counts over the loaded entries, shown beside each sidebar row.
  const categoryCounts = ACTION_CATEGORIES.reduce((acc, cat) => {
    acc[cat.key] = cat.actions == null ? entries.length : entries.filter(e => cat.actions.includes(e.action)).length
    return acc
  }, {})

  // The filtered stream, bucketed by day for the sticky date headers.
  const dayGroups = groupByDay(filtered)
  const clearAll = () => { setSearch(''); setDateFilter('all'); setCategoryFilter('all'); setActorFilter('all') }

  return (
    <Layout breadcrumb="Audit Log">
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">

        {/* Header — Export CSV uses the current filter set so a
            compliance reviewer asking for "this week's account ops"
            gets exactly the rows visible after the category +
            search filters are applied. Disabled while loading or
            when there's nothing to export. */}
        <div className="mb-5 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="eyebrow">Accountability</p>
            <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Audit Log</h1>
            <p className="text-sm text-gray-500 mt-1">Complete record of all administrative actions across the portal.</p>
          </div>
          <button
            type="button"
            className="btn-secondary flex items-center gap-1.5 text-sm"
            disabled={loading || filtered.length === 0}
            onClick={() => {
              logAudit(user, {
                action:     'data_exported',
                targetType: 'auditlog',
                targetName: 'Platform audit log',
                details:    `${filtered.length} row${filtered.length === 1 ? '' : 's'}`,
              })
              exportToCSV(
              `platform-audit-${dateStamp()}.csv`,
              [
                { label: 'Timestamp',     getValue: e => fullDate(e.createdAt) },
                { label: 'Action',        getValue: e => (ACTION_CONFIG[e.action]?.label ?? e.action) },
                { label: 'Action Code',   getValue: e => e.action },
                { label: 'Actor',         getValue: e => e.actorName ?? 'System' },
                { label: 'Actor Role',    getValue: e => e.actorRole ?? '' },
                { label: 'Actor Agency',  getValue: e => e.actorAgencyId ?? '' },
                { label: 'Target',        getValue: e => e.targetName ?? '' },
                { label: 'Target Type',   getValue: e => e.targetType ?? '' },
                { label: 'Details',       getValue: e => e.details ?? '' },
              ],
              filtered,
              )
            }}>
            <MdDownload size={15} /> Export CSV ({filtered.length})
          </button>
        </div>

        {/* Two-pane workspace: a sticky filter/facet sidebar + the entry stream
            grouped by day, so the controls stop eating the top of the screen
            and the stream fills the width. */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-5 items-start">

          {/* ── Filter sidebar ── */}
          <aside className="lg:sticky lg:top-[68px] space-y-4">

            {/* Stat readouts */}
            <div className="card grid grid-cols-3 divide-x divide-gray-100 overflow-hidden text-center">
              {[
                { label: 'Total', value: totalCount ?? '—', color: 'text-gray-800'  },
                { label: 'Today', value: todayCount,         color: 'text-brand-600' },
                { label: 'Week',  value: weekCount,          color: 'text-blue-600'  },
              ].map((m, i) => (
                <div key={i} className="px-2 py-2.5">
                  <p className={`text-lg font-semibold tabular-nums ${m.color}`}>{m.value}</p>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 mt-0.5">{m.label}</p>
                </div>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input className="input pl-9 text-sm" placeholder="Search actor, action, target"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {/* Date — segmented control */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Date</p>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1">
                {DATE_FILTERS.map(f => (
                  <button key={f.key} onClick={() => setDateFilter(f.key)}
                    className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                      dateFilter === f.key ? 'bg-white text-brand-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                    }`}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Category — list with counts */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Category</p>
              <ul className="-mx-1.5 space-y-px">
                {ACTION_CATEGORIES.map(c => {
                  const n = categoryCounts[c.key] ?? 0
                  const active = categoryFilter === c.key
                  // Hide empty categories (keep the active one so it can be cleared).
                  if (c.key !== 'all' && n === 0 && !active) return null
                  return (
                    <li key={c.key}>
                      <button onClick={() => setCategoryFilter(c.key)}
                        aria-current={active ? 'true' : undefined}
                        className={`flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left text-[13px] transition-colors ${
                          active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-gray-600 hover:bg-gray-50'
                        }`}>
                        <span className="truncate">{c.key === 'all' ? 'All categories' : c.label}</span>
                        <span className={`tabular-nums text-xs flex-shrink-0 ${active ? 'text-brand-600' : n === 0 ? 'text-gray-300' : 'text-gray-400'}`}>{n}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>

            {/* Actor */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Actor</p>
              <select value={actorFilter} onChange={e => setActorFilter(e.target.value)} className="input text-sm py-2">
                <option value="all">All actors</option>
                {actors.map(a => (
                  <option key={a.id} value={a.id}>{a.name}{a.role ? ` · ${ROLE_LABEL[a.role] ?? a.role}` : ''}</option>
                ))}
              </select>
              <p className="text-[10px] text-gray-300 mt-1">of {entries.length} loaded entries</p>
            </div>

            <button onClick={clearAll} disabled={!isFiltered}
              className={`text-xs font-medium underline underline-offset-2 ${isFiltered ? 'text-gray-500 hover:text-brand-600' : 'text-gray-300 cursor-default'}`}>
              Clear filters
            </button>
          </aside>

          {/* ── Entry stream ── */}
          <div className="min-w-0">

            {/* Result count + refresh */}
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-400">
                {filtered.length} entr{filtered.length !== 1 ? 'ies' : 'y'}
                {isFiltered && entries.length > 0 && ` (filtered from ${entries.length} loaded)`}
              </p>
              <button className="btn-secondary text-xs py-1" onClick={() => loadEntries()}>Refresh</button>
            </div>

            {/* ── Grouped stream ── */}
            <div className="card overflow-hidden">

              {/* Skeleton */}
              {loading && (
                <div className="divide-y divide-gray-50">
                  {Array.from({ length: 8 }).map((_, i) => (
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
                </div>
              )}

              {/* Day-grouped entries */}
              {!loading && dayGroups.map(group => (
                <section key={group.key}>
                  <div className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-gray-100 bg-gray-50/95 px-4 py-2 backdrop-blur">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-700">{group.label}</h3>
                    <span className="text-[11px] text-gray-400 tabular-nums">{group.sub}</span>
                    <span className="ml-auto text-[11px] text-gray-400 tabular-nums">{group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}</span>
                  </div>
                  <ul className="divide-y divide-gray-50">
                    {group.entries.map(e => {
                      const cfg       = ACTION_CONFIG[e.action]
                      const ago       = timeAgo(e.createdAt)
                      const avatarCls = ROLE_AVATAR[e.actorRole] ?? 'bg-gray-100 text-gray-600'
                      return (
                        <li key={e.id} className="flex gap-3 px-4 py-4 hover:bg-gray-50 transition-colors">
                          {/* Avatar — role-tinted */}
                          <div className={`w-8 h-8 rounded-full ${avatarCls} flex items-center justify-center text-sm font-semibold flex-shrink-0 mt-0.5`}>
                            {e.actorName?.[0]?.toUpperCase() ?? '?'}
                          </div>
                          <div className="flex-1 min-w-0">
                            {/* Row 1: actor + timestamp */}
                            <div className="flex items-start justify-between gap-4 mb-1.5">
                              <p className="text-sm font-semibold text-gray-800 leading-snug">
                                {e.actorName ?? '—'}
                                <span className="ml-1.5 text-xs font-normal text-gray-400">{ROLE_LABEL[e.actorRole] ?? e.actorRole ?? ''}</span>
                              </p>
                              <div className="text-right flex-shrink-0">
                                <p className="text-xs text-gray-500 whitespace-nowrap">{fullDate(e.createdAt)}</p>
                                {ago && <p className="text-xs text-gray-400">{ago}</p>}
                              </div>
                            </div>
                            {/* Row 2: action badge + target */}
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              {cfg ? (
                                <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border flex-shrink-0 ${cfg.badge}`}>{cfg.label}</span>
                              ) : (
                                <span className="text-xs text-gray-400 font-mono flex-shrink-0">{e.action ?? '—'}</span>
                              )}
                              {e.targetName && (
                                <span className="text-sm text-gray-600 truncate">
                                  {e.targetName}
                                  {e.targetType && <span className="ml-1 text-xs text-gray-400 capitalize">({e.targetType})</span>}
                                </span>
                              )}
                            </div>
                            {/* Row 3: details — clamped so a long payload can't dominate the row. */}
                            {e.details && <AuditDetails text={e.details} />}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}

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
                  {isFiltered && (
                    <button onClick={clearAll}
                      className="mt-3 inline-flex items-center text-sm font-medium text-brand-500 hover:text-brand-600">
                      Clear filters
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Load more */}
            {!loading && filtered.length > 0 && (
              <div className="flex flex-col items-center gap-2 py-5">
                {hasMore ? (
                  <button className="btn-secondary text-sm" disabled={loadingMore} onClick={() => loadEntries(lastVisible)}>
                    {loadingMore ? 'Loading…' : 'Load more entries'}
                  </button>
                ) : (
                  <p className="text-xs text-gray-400">End of the record for these filters.</p>
                )}
                <p className="text-[11px] text-gray-400 tabular-nums">Showing {filtered.length} of {entries.length} loaded</p>
              </div>
            )}

          </div>{/* /entry stream */}
        </div>{/* /two-pane grid */}

      </div>
    </Layout>
  )
}
