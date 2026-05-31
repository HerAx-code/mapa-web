import { useState, useEffect } from 'react'
import Layout from '../../components/Layout'
import { collection, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { notify } from '../../utils/notifications'
import { logAudit } from '../../utils/auditLog'
import { useAuth } from '../../contexts/AuthContext'
import { MdSearch, MdDelete, MdFlag, MdCheckCircle, MdHourglassEmpty, MdWarning, MdRefresh } from 'react-icons/md'
import toast from 'react-hot-toast'
import StatusBadge from '../../components/ui/StatusBadge'

// ── Config ────────────────────────────────────────────────────────────────
// Report badge rendering is delegated to <StatusBadge kind="report" />
// which reads REPORT_STATUS_CONFIG from constants.js. The summary tiles
// below have their own inline color config (bg/dot/color trio) since
// they're navigational tiles, not status pills.

const CATEGORY_BADGE = {
  'Bug / Error':                       'badge-red',
  'UI Issue':                          'badge-amber',
  'Data Problem':                      'badge-purple',
  'Performance':                       'badge-blue',
  'Feature Request':                   'badge-green',
  'Budget Request':                    'badge-orange',
  "Something isn't working":           'badge-red',
  'My application has a problem':      'badge-purple',
  'My documents have a problem':       'badge-amber',
  'Something looks wrong':             'badge-blue',
  "I can't find what I'm looking for": 'badge-gray',
  'Other':                             'badge-gray',
}

import { ROLE_LABEL_SHORT as ROLE_LABEL } from '../../utils/constants'

const ROLE_AVATAR = {
  super_admin:  'bg-purple-100 text-purple-700',
  staff_admin:  'bg-blue-100 text-blue-700',
  agency_admin: 'bg-amber-100 text-amber-700',
  agency:       'bg-teal-100 text-teal-700',
  patient:      'bg-gray-100 text-gray-600',
}

const formatDate = (ts) => {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function Reports() {
  const { user } = useAuth()
  const [reports,        setReports]        = useState([])
  const [loading,        setLoading]        = useState(true)
  const [search,         setSearch]         = useState('')
  const [statusFilter,   setStatusFilter]   = useState('all')
  const [catFilter,      setCatFilter]      = useState('all')
  const [roleFilter,     setRoleFilter]     = useState('all')
  const [activeAction,   setActiveAction]   = useState(null) // { id, type: 'resolve'|'delete' }
  const [resolutionNote, setResolutionNote] = useState('')

  useEffect(() => {
    const q = query(collection(db, 'reports'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, snap => {
      // Filter out Budget Requests client-side. Firestore's '!=' filter
      // forces an orderBy on the inequality field first, which would
      // override the createdAt DESC sort. The wire-transfer waste here
      // is small (Budget Requests are rare relative to issue reports).
      const items = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(r => r.category !== 'Budget Request')
      setReports(items)
      setLoading(false)
    }, () => {
      setLoading(false)
      toast.error('Failed to load reports. Please refresh the page.')
    })
    return unsub
  }, [])

  // ── Actions ──────────────────────────────────────────────────────────

  const handleSetStatus = async (report, status, note = '') => {
    try {
      const updates = { status }
      if (note.trim()) updates.resolutionNote = note.trim()
      await updateDoc(doc(db, 'reports', report.id), updates)

      if (status === 'in_progress' && report.reportedBy) {
        await notify(report.reportedBy, {
          type:  'app_advanced',
          title: 'Your report is being reviewed',
          body:  `Your "${report.category}" report has been acknowledged and is currently being reviewed by the administrator.`,
        })
      }

      if (status === 'resolved' && report.reportedBy) {
        const body = note.trim()
          ? `Your "${report.category}" report has been resolved. Note: ${note.trim()}`
          : `Your "${report.category}" report has been reviewed and resolved by the administrator.`
        await notify(report.reportedBy, {
          type:  'app_advanced',
          title: 'Your report has been resolved',
          body,
        })
      }

      const labels = { in_progress: 'marked In Progress', resolved: 'marked Resolved' }
      logAudit(user, {
        action:     'report_updated',
        targetType: 'report',
        targetName: report.category ?? 'Report',
        details:    `${labels[status] ?? 'Status updated'} — submitted by ${report.reporterName ?? '—'}${note.trim() ? `. Note: ${note.trim()}` : ''}`,
      })
      toast.success(`Report ${labels[status] ?? 'updated'}.`)
      setActiveAction(null)
      setResolutionNote('')
    } catch (err) { console.error(err); toast.error('Failed to update report. Please try again.') }
  }

  const handleDelete = async (report) => {
    try {
      await deleteDoc(doc(db, 'reports', report.id))
      logAudit(user, {
        action:     'report_deleted',
        targetType: 'report',
        targetName: report.category ?? 'Report',
        details:    `Report deleted — submitted by ${report.reporterName ?? '—'}, status was ${report.status ?? 'open'}`,
      })
      setActiveAction(null)
      toast.success('Report deleted.')
    } catch (err) { console.error(err); toast.error('Failed to delete report. Please try again.') }
  }

  const handleReopen = async (report) => {
    try {
      await updateDoc(doc(db, 'reports', report.id), { status: 'open', resolutionNote: null })
      if (report.reportedBy) {
        await notify(report.reportedBy, {
          type:  'app_advanced',
          title: 'Your report has been re-opened',
          body:  `Your "${report.category}" report has been re-opened for further review by the administrator.`,
        })
      }
      logAudit(user, {
        action:     'report_updated',
        targetType: 'report',
        targetName: report.category ?? 'Report',
        details:    `Report re-opened — submitted by ${report.reporterName ?? '—'}`,
      })
      toast.success('Report re-opened.')
    } catch (err) { console.error(err); toast.error('Failed to re-open report. Please try again.') }
  }

  const openAction = (id, type) => {
    setActiveAction(prev => prev?.id === id && prev?.type === type ? null : { id, type })
    setResolutionNote('')
  }

  // ── Filter ───────────────────────────────────────────────────────────

  const categories = [...new Set(reports.map(r => r.category).filter(Boolean))]
  const roles      = [...new Set(reports.map(r => r.reporterRole ?? r.role).filter(Boolean))]

  const filtered = reports.filter(r => {
    const rRole = r.reporterRole ?? r.role
    if (statusFilter !== 'all' && (r.status ?? 'open') !== statusFilter) return false
    if (catFilter    !== 'all' && r.category !== catFilter)              return false
    if (roleFilter   !== 'all' && rRole !== roleFilter)                  return false
    const q = search.toLowerCase()
    return !q ||
      r.category?.toLowerCase().includes(q) ||
      r.description?.toLowerCase().includes(q) ||
      r.reporterName?.toLowerCase().includes(q)
  })

  const openCount       = reports.filter(r => !r.status || r.status === 'open').length
  const inProgressCount = reports.filter(r => r.status === 'in_progress').length
  const resolvedCount   = reports.filter(r => r.status === 'resolved').length
  const isFiltered      = search || statusFilter !== 'all' || catFilter !== 'all' || roleFilter !== 'all'

  return (
    <Layout breadcrumb="Reports">
      <div className="p-4 sm:p-6">

        {/* Header */}
        <div className="mb-5">
          <h1 className="page-title">Problem Reports</h1>
          <p className="page-sub">View and manage reports submitted by users through the portal.</p>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 mb-5">
          {[
            { label: 'Open',        value: openCount,        color: 'text-amber-600', bg: 'bg-amber-50',  dot: 'bg-amber-400', key: 'open'        },
            { label: 'In Progress', value: inProgressCount,  color: 'text-blue-600',  bg: 'bg-blue-50',   dot: 'bg-blue-400',  key: 'in_progress' },
            { label: 'Resolved',    value: resolvedCount,    color: 'text-green-600', bg: 'bg-green-50',  dot: 'bg-green-500', key: 'resolved'    },
          ].map((m) => {
            const active = statusFilter === m.key
            return (
              <button key={m.key}
                className={`card p-4 flex items-center gap-3 text-left w-full transition-colors ${active ? 'ring-2 ring-brand-400' : 'hover:bg-gray-50'}`}
                onClick={() => setStatusFilter(active ? 'all' : m.key)}>
                <div className={`w-9 h-9 ${m.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                  <div className={`w-3 h-3 rounded-full ${m.dot}`} />
                </div>
                <div>
                  <p className="text-xs text-gray-400">{m.label}</p>
                  <p className={`text-2xl font-semibold ${m.color}`}>{m.value}</p>
                </div>
              </button>
            )
          })}
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input className="input pl-9" placeholder="Search by category, description or reporter..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* Filters */}
        <div className="space-y-2 mb-4">

          {/* Status */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 w-16 flex-shrink-0">Status</span>
            {[['all','All'], ['open','Open'], ['in_progress','In Progress'], ['resolved','Resolved']].map(([key, label]) => (
              <button key={key} onClick={() => setStatusFilter(key)}
                className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  statusFilter === key
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {/* Category */}
          {categories.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400 w-16 flex-shrink-0">Category</span>
              {[{ key: 'all', label: 'All' }, ...categories.map(c => ({ key: c, label: c }))].map(({ key, label }) => (
                <button key={key} onClick={() => setCatFilter(key)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    catFilter === key
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Reporter role */}
          {roles.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400 w-16 flex-shrink-0">Reporter</span>
              {[{ key: 'all', label: 'All' }, ...roles.map(r => ({ key: r, label: ROLE_LABEL[r] ?? r }))].map(({ key, label }) => (
                <button key={key} onClick={() => setRoleFilter(key)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    roleFilter === key
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Result count */}
        <p className="text-xs text-gray-400 mb-4">
          {filtered.length} report{filtered.length !== 1 ? 's' : ''}
          {isFiltered && reports.length > 0 && ` (filtered from ${reports.length})`}
        </p>

        {/* ── Cards ── */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card p-4 animate-pulse space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex-shrink-0" />
                    <div className="space-y-1.5">
                      <div className="h-3 bg-gray-100 rounded w-28" />
                      <div className="h-2 bg-gray-100 rounded w-20" />
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <div className="h-5 bg-gray-100 rounded-full w-24" />
                    <div className="h-5 bg-gray-100 rounded-full w-16" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="h-3 bg-gray-100 rounded w-full" />
                  <div className="h-3 bg-gray-100 rounded w-3/4" />
                </div>
                <div className="flex gap-2 pt-1">
                  <div className="h-7 bg-gray-100 rounded-lg w-32" />
                  <div className="h-7 bg-gray-100 rounded-lg w-24" />
                </div>
              </div>
            ))}
          </div>

        ) : filtered.length === 0 ? (
          <div className="card p-12 flex flex-col items-center text-center">
            <MdFlag size={36} className="text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-500 mb-1">No reports found</p>
            <p className="text-xs text-gray-400">
              {isFiltered
                ? 'No reports match your current filter.'
                : 'No reports yet. Reports submitted by users will appear here.'}
            </p>
            {isFiltered && (
              <button
                onClick={() => { setSearch(''); setStatusFilter('all'); setCatFilter('all'); setRoleFilter('all') }}
                className="mt-3 inline-flex items-center text-sm font-medium text-brand-500 hover:text-brand-600">
                Clear filters
              </button>
            )}
          </div>

        ) : (
          <div className="space-y-3">
            {filtered.map(r => {
              const status    = r.status ?? 'open'
              const catBadge  = CATEGORY_BADGE[r.category] ?? 'badge-gray'
              const rRole     = r.reporterRole ?? r.role
              const avatarCls = ROLE_AVATAR[rRole] ?? 'bg-gray-100 text-gray-600'
              const action    = activeAction?.id === r.id ? activeAction.type : null

              return (
                <div key={r.id} className="card overflow-hidden">

                  {/* Card body */}
                  <div className="p-4">

                    {/* Top row: reporter + badges */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-8 h-8 rounded-full ${avatarCls} flex items-center justify-center text-sm font-semibold flex-shrink-0`}>
                          {r.reporterName?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{r.reporterName ?? '—'}</p>
                          <p className="text-xs text-gray-400">
                            {ROLE_LABEL[rRole] ?? rRole} · {formatDate(r.createdAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className={`badge text-xs ${catBadge}`}>{r.category ?? '—'}</span>
                        <StatusBadge status={status} kind="report" />
                      </div>
                    </div>

                    {/* Description — always fully visible */}
                    <p className="text-sm text-gray-700 leading-relaxed mb-3">{r.description ?? '—'}</p>

                    {/* Resolution note */}
                    {r.resolutionNote && (
                      <div className="bg-green-50 border border-green-100 rounded-xl px-3 py-2.5 mb-3">
                        <p className="text-xs font-semibold text-green-700 mb-0.5">Resolution Note</p>
                        <p className="text-xs text-green-800 leading-relaxed">{r.resolutionNote}</p>
                      </div>
                    )}

                    {/* Action buttons — hidden when a panel is open */}
                    {action === null && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {status === 'open' && (
                          <button
                            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors"
                            onClick={() => handleSetStatus(r, 'in_progress')}>
                            <MdHourglassEmpty size={14} /> Mark In Progress
                          </button>
                        )}
                        {status !== 'resolved' && (
                          <button
                            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-green-200 text-green-600 bg-green-50 hover:bg-green-100 transition-colors"
                            onClick={() => openAction(r.id, 'resolve')}>
                            <MdCheckCircle size={14} /> Resolve
                          </button>
                        )}
                        {status === 'resolved' && (
                          <button
                            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-200 text-amber-600 bg-amber-50 hover:bg-amber-100 transition-colors"
                            onClick={() => handleReopen(r)}>
                            <MdRefresh size={14} /> Re-open
                          </button>
                        )}
                        <button
                          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-400 bg-white hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-colors ml-auto"
                          onClick={() => openAction(r.id, 'delete')}>
                          <MdDelete size={14} /> Delete
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Resolve panel */}
                  {action === 'resolve' && (
                    <div className="border-t border-green-100 bg-green-50 px-4 py-3">
                      <p className="text-xs font-medium text-green-700 mb-2">
                        Resolution note <span className="font-normal text-green-500">(optional)</span> — included in the reporter's notification
                      </p>
                      <textarea
                        rows={2}
                        className="input w-full text-sm resize-none mb-2"
                        placeholder="e.g. Confirmed and fixed. Update your app to see the change."
                        value={resolutionNote}
                        onChange={e => setResolutionNote(e.target.value)}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button className="text-xs text-white bg-green-500 px-3 py-1.5 rounded-lg hover:bg-green-600 transition-colors"
                          onClick={() => handleSetStatus(r, 'resolved', resolutionNote)}>
                          Confirm Resolve
                        </button>
                        <button className="text-xs text-gray-500 border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                          onClick={() => setActiveAction(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Delete panel */}
                  {action === 'delete' && (
                    <div className="border-t border-red-100 bg-red-50 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <MdWarning size={16} className="text-red-500 flex-shrink-0" />
                        <p className="text-sm text-red-700 flex-1">
                          Delete this <strong>{r.category}</strong> report from <strong>{r.reporterName}</strong>?
                        </p>
                        <button className="text-xs text-gray-500 border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50 flex-shrink-0 transition-colors"
                          onClick={() => setActiveAction(null)}>
                          Cancel
                        </button>
                        <button className="text-xs text-white bg-red-500 px-3 py-1.5 rounded-lg hover:bg-red-600 flex-shrink-0 transition-colors"
                          onClick={() => handleDelete(r)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              )
            })}
          </div>
        )}

      </div>
    </Layout>
  )
}
