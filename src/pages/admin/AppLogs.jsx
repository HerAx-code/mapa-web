import Layout from '../../components/Layout'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MdSearch } from 'react-icons/md'
import toast from 'react-hot-toast'
import { collection, query, where, orderBy, limit, getDocs, startAfter, getCountFromServer } from 'firebase/firestore'
import { db } from '../../firebase'
import { tsToDate } from '../../utils/dates'
import StatusBadge from '../../components/ui/StatusBadge'

const PAGE_SIZE = 100

// Status list for the sidebar facet — co-funding slice statuses plus the legacy
// pending / interview values so pre-redesign data isn't hidden.
const STATUS_ROWS = [
  ['reviewing',     'For Funding'       ],
  ['awaiting_info', 'Needs Info'        ],
  ['endorsed',      'Endorsed'          ],
  ['approved',      'Approved'          ],
  ['certificate',   'Guarantee Letter'  ],
  ['rejected',      'Rejected'          ],
  ['pending',       'Pending (legacy)'  ],
  ['interview',     'Interview (legacy)'],
]

// Group applications into day buckets by submittedAt so a long list becomes
// navigable — Today / Yesterday / weekday, each with a count.
function groupByDay(apps) {
  const groups = []
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime() }
  const today = startOfDay(new Date())
  const oneDay = 86400000
  for (const a of apps) {
    const d = tsToDate(a.submittedAt)
    const key = d ? String(startOfDay(d)) : 'unknown'
    let g = groups.length && groups[groups.length - 1].key === key ? groups[groups.length - 1] : null
    if (!g) {
      let label = 'Undated', sub = ''
      if (d) {
        const day = startOfDay(d)
        label = day === today ? 'Today' : day === today - oneDay ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long' })
        sub = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
      }
      g = { key, label, sub, entries: [] }
      groups.push(g)
    }
    g.entries.push(a)
  }
  return groups
}

const fmtTime = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
}

export default function AppLogs() {
  const [searchParams]              = useSearchParams()
  const [apps, setApps]             = useState([])
  const [loading, setLoading]       = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [lastVisible, setLastVisible] = useState(null)
  const [hasMore, setHasMore]       = useState(false)
  const [search, setSearch]         = useState(searchParams.get('agencyName') ?? '')
  const [filter, setFilter]         = useState(searchParams.get('status') ?? 'all')
  const [agencyFilter, setAgencyFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [counts, setCounts]         = useState({})

  const loadApps = async (cursor = null) => {
    if (cursor) setLoadingMore(true)
    else setLoading(true)
    try {
      const constraints = [orderBy('submittedAt', 'desc'), limit(PAGE_SIZE)]
      if (cursor) constraints.push(startAfter(cursor))
      const snap = await getDocs(query(collection(db, 'applications'), ...constraints))
      const batch = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setApps(prev => cursor ? [...prev, ...batch] : batch)
      setLastVisible(snap.docs[snap.docs.length - 1] ?? null)
      setHasMore(snap.docs.length === PAGE_SIZE)
    } catch (err) {
      console.error('[AppLogs] loadApps failed:', err)
      toast.error('Failed to load applications. Please try again.')
    } finally {
      if (cursor) setLoadingMore(false)
      else setLoading(false)
    }
  }

  useEffect(() => { loadApps() }, [])

  // Server-accurate counts — no document data transferred. Status list covers
  // both the co-funding slice statuses and the legacy pending / interview
  // statuses, so legacy data isn't silently excluded from counts.
  useEffect(() => {
    const statuses = ['pending', 'endorsed', 'reviewing', 'awaiting_info', 'interview', 'approved', 'certificate', 'rejected']
    Promise.all([
      getCountFromServer(query(collection(db, 'applications'))),
      ...statuses.map(s => getCountFromServer(query(collection(db, 'applications'), where('status', '==', s)))),
    ]).then(([totalSnap, ...statusSnaps]) => {
      const result = { total: totalSnap.data().count }
      statuses.forEach((s, i) => { result[s] = statusSnaps[i].data().count })
      setCounts(result)
    }).catch(err => console.error('[AppLogs] status counts failed:', err))
  }, [])

  const inDateRange = (a) => {
    if (dateFilter === 'all') return true
    const d = tsToDate(a.submittedAt)
    if (!d) return false
    const days = (Date.now() - d.getTime()) / 86400000
    return dateFilter === 'week' ? days <= 7 : dateFilter === 'month' ? days <= 31 : true
  }

  const filtered = apps.filter(a => {
    if (filter !== 'all' && a.status !== filter) return false
    if (agencyFilter !== 'all' && a.agencyName !== agencyFilter) return false
    if (!inDateRange(a)) return false
    const q = search.toLowerCase()
    return !q || a.patientName?.toLowerCase().includes(q)
      || a.agencyName?.toLowerCase().includes(q)
      || a.appId?.toLowerCase().includes(q)
  })

  // Distinct agency names present in the loaded apps, for the agency facet.
  const agencies = [...new Set(apps.map(a => a.agencyName).filter(Boolean))].sort()

  const dayGroups = groupByDay(filtered)
  const isFiltered = search || filter !== 'all' || agencyFilter !== 'all' || dateFilter !== 'all'
  const clearAll = () => { setSearch(''); setFilter('all'); setAgencyFilter('all'); setDateFilter('all') }

  const inProgress = counts.total != null
    ? (counts.pending ?? 0) + (counts.endorsed ?? 0) + (counts.reviewing ?? 0) + (counts.awaiting_info ?? 0) + (counts.interview ?? 0)
    : '—'
  const approvedTotal = counts.total != null ? (counts.approved ?? 0) + (counts.certificate ?? 0) : '—'

  return (
    <Layout breadcrumb="Application Logs">
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">

        <div className="mb-5">
          <p className="eyebrow">Records</p>
          <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Application Logs</h1>
          <p className="text-sm text-gray-500 mt-1">Every patient application submission across all agencies, grouped by the day it arrived.</p>
        </div>

        {/* Two-pane: facet sidebar + day-grouped stream. */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-5 items-start">

          {/* ── Filter sidebar ── */}
          <aside className="lg:sticky lg:top-[68px] space-y-4">

            <div className="card grid grid-cols-3 divide-x divide-gray-100 overflow-hidden text-center">
              {[
                { label: 'Total',    value: counts.total ?? '—', color: 'text-gray-800'  },
                { label: 'Open',     value: inProgress,          color: 'text-amber-600' },
                { label: 'Approved', value: approvedTotal,       color: 'text-green-600' },
              ].map((m, i) => (
                <div key={i} className="px-2 py-2.5">
                  <p className={`text-lg font-semibold tabular-nums ${m.color}`}>{m.value}</p>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 mt-0.5">{m.label}</p>
                </div>
              ))}
            </div>

            <div className="relative">
              <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input className="input pl-9 text-sm" placeholder="Patient, agency, or app ID"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Status</p>
              <ul className="-mx-1.5 space-y-px">
                <li>
                  <button onClick={() => setFilter('all')} aria-current={filter === 'all' ? 'true' : undefined}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left text-[13px] transition-colors ${filter === 'all' ? 'bg-brand-50 font-semibold text-brand-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                    <span>All statuses</span>
                    <span className={`tabular-nums text-xs ${filter === 'all' ? 'text-brand-600' : 'text-gray-400'}`}>{counts.total ?? ''}</span>
                  </button>
                </li>
                {STATUS_ROWS.map(([key, label]) => {
                  const n = counts[key]
                  const active = filter === key
                  if (n === 0 && !active) return null
                  return (
                    <li key={key}>
                      <button onClick={() => setFilter(key)} aria-current={active ? 'true' : undefined}
                        className={`flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left text-[13px] transition-colors ${active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                        <span className="truncate">{label}</span>
                        <span className={`tabular-nums text-xs flex-shrink-0 ${active ? 'text-brand-600' : n === 0 ? 'text-gray-300' : 'text-gray-400'}`}>{n ?? ''}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Agency</p>
              <select value={agencyFilter} onChange={e => setAgencyFilter(e.target.value)} className="input text-sm py-2">
                <option value="all">All agencies</option>
                {agencies.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <p className="text-[10px] text-gray-300 mt-1">of {apps.length} loaded</p>
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

            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-400">
                {filtered.length} application{filtered.length !== 1 ? 's' : ''}
                {isFiltered && apps.length > 0 && ` (filtered from ${apps.length} loaded)`}
              </p>
              <button className="btn-secondary text-xs py-1" onClick={() => loadApps()}>Refresh</button>
            </div>

            <div className="card overflow-hidden">
              {loading && (
                <div className="divide-y divide-gray-50">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3.5 animate-pulse">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex-shrink-0" />
                      <div className="flex-1 space-y-2 min-w-0">
                        <div className="h-3 bg-gray-100 rounded w-40" />
                        <div className="h-2.5 bg-gray-100 rounded w-28" />
                      </div>
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
                          <p className="text-xs text-gray-400 truncate">{a.agencyName || 'No agency'}</p>
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
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <MdSearch size={34} className="text-gray-200 mb-3" />
                  <p className="text-sm font-medium text-gray-500 mb-1">No applications found</p>
                  <p className="text-xs text-gray-400">
                    {isFiltered ? 'No applications match your filters in the loaded set.' : 'No applications yet.'}
                  </p>
                  {isFiltered && (
                    <button onClick={clearAll} className="mt-3 inline-flex items-center text-sm font-medium text-brand-500 hover:text-brand-600">
                      Clear filters
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Load more — filters/search apply to the loaded set only. */}
            {!loading && (
              <div className="flex flex-col items-center gap-2 py-5">
                {hasMore ? (
                  <button className="btn-secondary text-sm" disabled={loadingMore} onClick={() => loadApps(lastVisible)}>
                    {loadingMore ? 'Loading…' : 'Load more applications'}
                  </button>
                ) : apps.length > 0 && (
                  <p className="text-xs text-gray-400">End of the loaded record.</p>
                )}
                <p className="text-[11px] text-gray-400 tabular-nums">
                  {apps.length} loaded{isFiltered ? ` · ${filtered.length} shown` : ''}
                </p>
              </div>
            )}

          </div>{/* /entry stream */}
        </div>{/* /two-pane grid */}
      </div>
    </Layout>
  )
}
