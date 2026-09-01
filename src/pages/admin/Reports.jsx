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
import { tsToDate } from '../../utils/dates'
import { groupByDay } from '../../utils/groupByDay'

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
  const d = tsToDate(ts)
  return d ? d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
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
  const dayGroups       = groupByDay(filtered)
  const clearAll        = () => { setSearch(''); setStatusFilter('all'); setCatFilter('all'); setRoleFilter('all') }

  return (
    <Layout breadcrumb="Reports">
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">

        {/* Header */}
        <div className="mb-5">
          <p className="eyebrow">Support</p>
          <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Problem Reports</h1>
          <p className="text-sm text-gray-500 mt-1">Reports submitted by patients and agency staff, grouped by the day they came in.</p>
        </div>

        {/* Two-pane: facet sidebar + day-grouped report stream. */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-5 items-start">

          {/* ── Filter sidebar ── */}
          <aside className="lg:sticky lg:top-[68px] space-y-4">
            <div className="card grid grid-cols-3 divide-x divide-gray-100 overflow-hidden text-center">
              {[
                { label: 'Open',     value: openCount,       color: 'text-amber-600' },
                { label: 'Progress', value: inProgressCount, color: 'text-blue-600'  },
                { label: 'Resolved', value: resolvedCount,   color: 'text-green-600' },
              ].map((m, i) => (
                <div key={i} className="px-2 py-2.5">
                  <p className={`text-lg font-semibold tabular-nums ${m.color}`}>{m.value}</p>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 mt-0.5">{m.label}</p>
                </div>
              ))}
            </div>

            <div className="relative">
              <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input className="input pl-9 text-sm" placeholder="Search reports" value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Status</p>
              <ul className="-mx-1.5 space-y-px">
                {[
                  ['all', 'All reports', reports.length],
                  ['open', 'Open', openCount],
                  ['in_progress', 'In progress', inProgressCount],
                  ['resolved', 'Resolved', resolvedCount],
                ].map(([key, label, n]) => {
                  const active = statusFilter === key
                  return (
                    <li key={key}>
                      <button onClick={() => setStatusFilter(key)} aria-current={active ? 'true' : undefined}
                        className={`flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left text-[13px] transition-colors ${active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                        <span>{label}</span>
                        <span className={`tabular-nums text-xs ${active ? 'text-brand-600' : 'text-gray-400'}`}>{n}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>

            {categories.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Category</p>
                <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="input text-sm py-2">
                  <option value="all">All categories</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}

            {roles.length > 1 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Reporter</p>
                <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="input text-sm py-2">
                  <option value="all">All reporters</option>
                  {roles.map(r => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
                </select>
              </div>
            )}

            <button onClick={clearAll} disabled={!isFiltered}
              className={`text-xs font-medium underline underline-offset-2 ${isFiltered ? 'text-gray-500 hover:text-brand-600' : 'text-gray-300 cursor-default'}`}>
              Clear filters
            </button>
          </aside>

          {/* ── Report stream ── */}
          <div className="min-w-0">
            <p className="text-xs text-gray-400 mb-3">{filtered.length} report{filtered.length !== 1 ? 's' : ''}{isFiltered && reports.length > 0 ? ` of ${reports.length}` : ''}</p>

        {/* ── Cards ── */}
        {loading ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
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
          <div className="space-y-6">
            {dayGroups.map(group => (
              <section key={group.key}>
                <div className="mb-2.5 flex items-baseline gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-700">{group.label}</h3>
                  <span className="text-[11px] text-gray-400 tabular-nums">{group.sub}</span>
                  <span className="ml-auto text-[11px] text-gray-400 tabular-nums">{group.entries.length} {group.entries.length === 1 ? 'report' : 'reports'}</span>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
                  {group.entries.map(r => {
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
              </section>
            ))}
          </div>
        )}

          </div>{/* /report stream */}
        </div>{/* /two-pane grid */}
      </div>
    </Layout>
  )
}
