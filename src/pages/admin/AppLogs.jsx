import Layout from '../../components/Layout'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MdSearch, MdRefresh } from 'react-icons/md'
import toast from 'react-hot-toast'
import { collection, query, where, orderBy, limit, getDocs, startAfter, getCountFromServer } from 'firebase/firestore'
import { db } from '../../firebase'
import StatusBadge from '../../components/ui/StatusBadge'

const PAGE_SIZE = 100

export default function AppLogs() {
  const [searchParams]              = useSearchParams()
  const [apps, setApps]             = useState([])
  const [loading, setLoading]       = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [lastVisible, setLastVisible] = useState(null)
  const [hasMore, setHasMore]       = useState(false)
  const [search, setSearch]         = useState(searchParams.get('agencyName') ?? '')
  const [filter, setFilter]         = useState(searchParams.get('status') ?? 'all')
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

  // Server-accurate counts — no document data transferred. Status list
  // covers both the co-funding slice statuses (endorsed / reviewing /
  // awaiting_info / approved / certificate / rejected) and the legacy
  // statuses (pending / interview) that pre-redesign applications still
  // carry, so legacy data isn't silently excluded from counts.
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

  const filtered = apps.filter(a => {
    if (filter !== 'all' && a.status !== filter) return false
    const q = search.toLowerCase()
    return !q || a.patientName?.toLowerCase().includes(q)
      || a.agencyName?.toLowerCase().includes(q)
      || a.appId?.toLowerCase().includes(q)
  })

  const formatDate = (ts) => {
    if (!ts) return '—'
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <Layout breadcrumb="Application Logs">
      <div className="p-4 sm:p-6">

        <div className="mb-5">
          <h1 className="page-title">Application Logs</h1>
          <p className="page-sub">View all patient application submissions across all agencies.</p>
        </div>

        {/* Summary — server-accurate counts. The "In progress" tile rolls
            up everything non-terminal (legacy pending + new endorsed,
            reviewing, awaiting_info) so the headline number reflects all
            active slices regardless of redesign era. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Total',       value: counts.total ?? '—',                                                                                                                                       color: 'text-gray-800',  filterKey: 'all'      },
            { label: 'In progress', value: counts.total != null ? (counts.pending ?? 0) + (counts.endorsed ?? 0) + (counts.reviewing ?? 0) + (counts.awaiting_info ?? 0) + (counts.interview ?? 0) : '—', color: 'text-amber-600', filterKey: 'all'      },
            { label: 'Approved',    value: counts.total != null ? (counts.approved ?? 0) + (counts.certificate ?? 0) : '—',                                                                                color: 'text-green-600', filterKey: 'approved' },
            { label: 'Rejected',    value: counts.rejected ?? '—',                                                                                                                                          color: 'text-red-500',   filterKey: 'rejected' },
          ].map((m) => (
            <button key={m.filterKey}
              className={`card p-4 text-left w-full transition-colors hover:bg-gray-50 ${filter === m.filterKey ? 'ring-2 ring-brand-400' : ''}`}
              onClick={() => setFilter(filter === m.filterKey ? 'all' : m.filterKey)}>
              <p className="text-xs text-gray-400 mb-1">{m.label}</p>
              <p className={`text-2xl font-semibold ${m.color}`}>{m.value}</p>
            </button>
          ))}
        </div>

        {/* Filter tabs with server-accurate counts. Tabs hide when their
            count is 0 so legacy-only statuses (pending/interview) don't
            show forever on a system that's fully migrated to co-funding. */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {[
            ['all',           'All',                  counts.total          ],
            ['endorsed',      'Endorsed',             counts.endorsed       ],
            ['reviewing',     'For Funding',          counts.reviewing      ],
            ['awaiting_info', 'Needs Info',           counts.awaiting_info  ],
            ['approved',      'Approved',             counts.approved       ],
            ['certificate',   'Guarantee Letter',     counts.certificate    ],
            ['rejected',      'Rejected',             counts.rejected       ],
            ['pending',       'Pending (legacy)',     counts.pending        ],
            ['interview',     'Interview (legacy)',   counts.interview      ],
          ]
            .filter(([key, , count]) => key === 'all' || (count ?? 0) > 0 || filter === key)
            .map(([key, label, count]) => (
              <button key={key}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${filter === key ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                onClick={() => setFilter(key)}>
                {label}
                {count != null && count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${filter === key ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>
                    {count}
                  </span>
                )}
              </button>
            ))}
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input className="input pl-9" placeholder="Search by patient, agency, or application ID..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* Search scope notice */}
        {(search || filter !== 'all') && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4 text-sm text-blue-700">
            Search and filter apply to the <strong>{apps.length} loaded applications</strong> only.
            {hasMore && <> Use <strong>Load more</strong> to expand results.</>}
          </div>
        )}

        {/* Table */}
        <div className="card overflow-x-auto">
          <table className="data-table min-w-full">
            <thead>
              <tr>
                <th>Application ID</th>
                <th>Patient</th>
                <th>Agency</th>
                <th>Submitted</th>
                <th>Last Updated</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td><div className="h-3 bg-gray-100 rounded w-28" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-32" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-28" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-20" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-20" /></td>
                  <td><div className="h-5 bg-gray-100 rounded-full w-16" /></td>
                </tr>
              ))}
              {!loading && filtered.map(a => (
                <tr key={a.id}>
                  <td className="font-mono text-xs text-gray-500">{a.appId || a.id.slice(0, 12)}</td>
                  <td className="text-sm text-gray-800">{a.patientName || '—'}</td>
                  <td className="text-sm text-gray-600">{a.agencyName || '—'}</td>
                  <td className="text-xs text-gray-400">{formatDate(a.submittedAt)}</td>
                  <td className="text-xs text-gray-400">{formatDate(a.updatedAt)}</td>
                  <td>
                    <StatusBadge status={a.status} />
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center py-10 text-sm text-gray-400">
                  No applications found.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-400">
            {apps.length} application{apps.length !== 1 ? 's' : ''} loaded
            {hasMore && ' — more available'}
          </p>
          <div className="flex gap-2">
            <button className="btn-secondary text-sm flex items-center gap-1.5"
              onClick={() => loadApps()}>
              <MdRefresh size={15} /> Refresh
            </button>
            {hasMore && (
              <button className="btn-secondary text-sm"
                disabled={loadingMore}
                onClick={() => loadApps(lastVisible)}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}
