import Layout from '../../components/Layout'
import { useState, useEffect } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { MdSearch, MdDownload, MdListAlt } from 'react-icons/md'
import { exportToCSV, dateStamp } from '../../utils/export'
import { APP_STATUS_CONFIG } from '../../utils/constants'
import { tsToDate } from '../../utils/dates'
import { groupByDay } from '../../utils/groupByDay'
import StatusBadge from '../../components/ui/StatusBadge'

// Pull labels straight from the canonical APP_STATUS_CONFIG so the CSV status
// column matches the rendered cell. <StatusBadge /> handles in-list rendering.
const statusLabel = (s) => APP_STATUS_CONFIG[s]?.label ?? s ?? ''

const formatDate = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
}
const fmtTime = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
}

const STATUS_ROWS = [
  ['endorsed',      'Endorsed'          ],
  ['reviewing',     'For Funding'       ],
  ['awaiting_info', 'Needs Info'        ],
  ['approved',      'Approved'          ],
  ['certificate',   'Guarantee Letter'  ],
  ['rejected',      'Rejected'          ],
  ['pending',       'Pending (legacy)'  ],
  ['interview',     'Interview (legacy)'],
]

export default function AgencyLogs() {
  const { user }          = useAuth()
  const [apps, setApps]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [filter, setFilter]   = useState('all')
  const [dateFilter, setDateFilter] = useState('all')

  useEffect(() => {
    if (!user?.agencyId) return
    const q = query(collection(db, 'applications'), where('agencyId', '==', user.agencyId))
    const unsub = onSnapshot(q, snap => {
      setApps(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (tsToDate(b.submittedAt)?.getTime() ?? 0) - (tsToDate(a.submittedAt)?.getTime() ?? 0))
      )
      setLoading(false)
    }, (err) => {
      setLoading(false)
      console.error('[Logs] applications snapshot error:', err)
    })
    return unsub
  }, [user?.agencyId])

  const countOf = (s) => apps.filter(a => a.status === s).length

  const inDateRange = (a) => {
    if (dateFilter === 'all') return true
    const d = tsToDate(a.submittedAt)
    if (!d) return false
    const days = (Date.now() - d.getTime()) / 86400000
    return dateFilter === 'week' ? days <= 7 : dateFilter === 'month' ? days <= 31 : true
  }

  const filtered = apps.filter(a => {
    if (filter !== 'all' && a.status !== filter) return false
    if (!inDateRange(a)) return false
    const q = search.toLowerCase()
    return !q ||
      a.patientName?.toLowerCase().includes(q) ||
      a.appId?.toLowerCase().includes(q) ||
      a.patientContact?.includes(q)
  })

  const openTotal     = countOf('endorsed') + countOf('reviewing') + countOf('awaiting_info') + countOf('pending') + countOf('interview')
  const approvedTotal = countOf('approved') + countOf('certificate')
  const dayGroups  = groupByDay(filtered, a => a.submittedAt)
  const isFiltered = search || filter !== 'all' || dateFilter !== 'all'
  const clearAll   = () => { setSearch(''); setFilter('all'); setDateFilter('all') }

  return (
    <Layout breadcrumb="Application Logs">
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="eyebrow">Records</p>
            <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Application Logs</h1>
            <p className="text-sm text-gray-500 mt-1">Your agency's applications, grouped by the day they were submitted.</p>
          </div>
          <button className="btn-secondary flex items-center gap-1.5 text-sm disabled:opacity-50"
            disabled={loading || filtered.length === 0}
            onClick={() => exportToCSV(`agency-logs-${dateStamp()}.csv`, [
              { label: 'Application ID', getValue: a => a.appId ?? '' },
              { label: 'Patient',        getValue: a => a.patientName ?? '' },
              { label: 'Contact',        getValue: a => a.patientContact ?? '' },
              { label: 'Status',         getValue: a => statusLabel(a.status) },
              { label: 'Submitted',      getValue: a => formatDate(a.submittedAt) },
            ], filtered)}>
            <MdDownload size={16} /> Export CSV
          </button>
        </div>

        {/* Two-pane: facet sidebar + day-grouped stream. */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-5 items-start">

          {/* ── Filter sidebar ── */}
          <aside className="lg:sticky lg:top-[68px] space-y-4">
            <div className="card grid grid-cols-3 divide-x divide-gray-100 overflow-hidden text-center">
              {[
                { label: 'Total',    value: apps.length,    color: 'text-gray-800'  },
                { label: 'Open',     value: openTotal,      color: 'text-amber-600' },
                { label: 'Approved', value: approvedTotal,  color: 'text-green-600' },
              ].map((m, i) => (
                <div key={i} className="px-2 py-2.5">
                  <p className={`text-lg font-semibold tabular-nums ${m.color}`}>{loading ? '—' : m.value}</p>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 mt-0.5">{m.label}</p>
                </div>
              ))}
            </div>

            <div className="relative">
              <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input className="input pl-9 text-sm" placeholder="Patient, contact, or app ID"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Status</p>
              <ul className="-mx-1.5 space-y-px">
                <li>
                  <button onClick={() => setFilter('all')} aria-current={filter === 'all' ? 'true' : undefined}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left text-[13px] transition-colors ${filter === 'all' ? 'bg-brand-50 font-semibold text-brand-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                    <span>All statuses</span>
                    <span className={`tabular-nums text-xs ${filter === 'all' ? 'text-brand-600' : 'text-gray-400'}`}>{apps.length}</span>
                  </button>
                </li>
                {STATUS_ROWS.map(([key, label]) => {
                  const n = countOf(key)
                  const active = filter === key
                  if (n === 0 && !active) return null
                  return (
                    <li key={key}>
                      <button onClick={() => setFilter(key)} aria-current={active ? 'true' : undefined}
                        className={`flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left text-[13px] transition-colors ${active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                        <span className="truncate">{label}</span>
                        <span className={`tabular-nums text-xs flex-shrink-0 ${active ? 'text-brand-600' : n === 0 ? 'text-gray-300' : 'text-gray-400'}`}>{n}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Date</p>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1">
                {[['all', 'All'], ['week', 'Week'], ['month', 'Month']].map(([k, l]) => (
                  <button key={k} onClick={() => setDateFilter(k)}
                    className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${dateFilter === k ? 'bg-white text-brand-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={clearAll} disabled={!isFiltered}
              className={`text-xs font-medium underline underline-offset-2 ${isFiltered ? 'text-gray-500 hover:text-brand-600' : 'text-gray-300 cursor-default'}`}>
              Clear filters
            </button>
          </aside>

          {/* ── Entry stream ── */}
          <div className="min-w-0">
            <p className="text-xs text-gray-400 mb-3">{filtered.length} application{filtered.length !== 1 ? 's' : ''}{isFiltered && apps.length > 0 ? ` of ${apps.length}` : ''}</p>

            <div className="card overflow-hidden">
              {loading && (
                <div className="divide-y divide-gray-50">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3.5 animate-pulse">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex-shrink-0" />
                      <div className="flex-1 space-y-2 min-w-0"><div className="h-3 bg-gray-100 rounded w-40" /><div className="h-2.5 bg-gray-100 rounded w-24" /></div>
                      <div className="h-5 bg-gray-100 rounded-full w-20" />
                    </div>
                  ))}
                </div>
              )}

              {!loading && dayGroups.map(group => (
                <section key={group.key}>
                  <div className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-gray-100 bg-gray-50/95 px-4 py-2 backdrop-blur">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-700">{group.label}</h3>
                    <span className="text-[11px] text-gray-400 tabular-nums">{group.sub}</span>
                    <span className="ml-auto text-[11px] text-gray-400 tabular-nums">{group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}</span>
                  </div>
                  <ul className="divide-y divide-gray-50">
                    {group.entries.map(a => (
                      <li key={a.id} className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors">
                        <div className="w-8 h-8 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                          {a.patientName?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {a.patientName || '—'}
                            <span className="ml-2 font-mono text-[11px] font-normal text-gray-400">{a.appId || a.id.slice(0, 12)}</span>
                          </p>
                          <p className="text-xs text-gray-400 truncate">{a.patientContact || 'No contact'}</p>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <StatusBadge status={a.status} />
                          <span className="text-xs text-gray-400 tabular-nums w-14 text-right">{fmtTime(a.submittedAt)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}

              {!loading && filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <MdListAlt size={34} className="text-gray-200 mb-2" />
                  <p className="text-sm text-gray-400">{isFiltered ? 'No applications match your filter.' : 'No applications yet.'}</p>
                  {isFiltered && (
                    <button onClick={clearAll} className="mt-3 inline-flex items-center text-sm font-medium text-brand-500 hover:text-brand-600">Clear filters</button>
                  )}
                </div>
              )}
            </div>
          </div>{/* /entry stream */}
        </div>{/* /two-pane grid */}
      </div>
    </Layout>
  )
}
