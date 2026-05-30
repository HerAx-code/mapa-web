import Layout from '../../components/Layout'
import { useState, useEffect } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { MdSearch, MdDownload, MdListAlt } from 'react-icons/md'
import { exportToCSV, dateStamp } from '../../utils/export'

// Co-funding slice statuses + legacy pre-redesign statuses for back-compat.
// Labels mirror the wording used in the rest of the app (For Funding,
// Needs Info, Guarantee Letter Issued).
const STATUS_BADGE = {
  endorsed:      'badge-purple',
  reviewing:     'badge-amber',
  awaiting_info: 'badge-orange',
  approved:      'badge-green',
  certificate:   'badge-green',
  rejected:      'badge-red',
  pending:       'badge-blue',    // legacy
  interview:     'badge-purple',  // legacy
}

const STATUS_LABEL = {
  endorsed:      'Endorsed',
  reviewing:     'For Funding',
  awaiting_info: 'Needs Info',
  approved:      'Approved',
  certificate:   'Guarantee Letter Issued',
  rejected:      'Rejected',
  pending:       'Pending',     // legacy
  interview:     'Interview',   // legacy
}

const formatDate = (ts) => {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AgencyLogs() {
  const { user }          = useAuth()
  const [apps, setApps]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [filter, setFilter]   = useState('all')

  useEffect(() => {
    if (!user?.agencyId) return
    const q = query(
      collection(db, 'applications'),
      where('agencyId', '==', user.agencyId),
    )
    const unsub = onSnapshot(q, snap => {
      setApps(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.submittedAt?.seconds ?? 0) - (a.submittedAt?.seconds ?? 0))
      )
      setLoading(false)
    }, (err) => {
      setLoading(false)
      console.error('[Logs] applications snapshot error:', err)
    })
    return unsub
  }, [user?.agencyId])

  const filtered = apps.filter(a => {
    if (filter !== 'all' && a.status !== filter) return false
    const q = search.toLowerCase()
    return !q ||
      a.patientName?.toLowerCase().includes(q) ||
      a.appId?.toLowerCase().includes(q) ||
      a.patientContact?.includes(q)
  })

  const countOf = (s) => apps.filter(a => a.status === s).length

  return (
    <Layout breadcrumb="Application Logs">
      <div className="p-4 sm:p-6">

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="page-title">Application Logs</h1>
            <p className="page-sub">Complete history of all applications for your agency.</p>
          </div>
          <button className="btn-secondary flex items-center gap-1.5 text-sm"
            onClick={() => exportToCSV(`agency-logs-${dateStamp()}.csv`, [
              { label: 'Application ID', getValue: a => a.appId ?? '' },
              { label: 'Patient',        getValue: a => a.patientName ?? '' },
              { label: 'Contact',        getValue: a => a.patientContact ?? '' },
              { label: 'Status',         getValue: a => STATUS_LABEL[a.status] ?? a.status ?? '' },
              { label: 'Submitted',      getValue: a => formatDate(a.submittedAt) },
            ], filtered)}>
            <MdDownload size={16} /> Export CSV
          </button>
        </div>

        {/* Summary — covers the co-funding slice lifecycle. 'Approved'
            rolls up approved + certificate (post-GL-issuance) since
            either way the agency has committed funds. */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-5">
          {[
            { label: 'Total',       value: apps.length,                                   color: 'text-gray-800'   },
            { label: 'Endorsed',    value: countOf('endorsed'),                           color: 'text-purple-600' },
            { label: 'For Funding', value: countOf('reviewing'),                          color: 'text-amber-600'  },
            { label: 'Needs Info',  value: countOf('awaiting_info'),                      color: 'text-orange-600' },
            { label: 'Approved',    value: countOf('approved') + countOf('certificate'),  color: 'text-green-600'  },
            { label: 'Rejected',    value: countOf('rejected'),                           color: 'text-red-500'    },
          ].map((m, i) => (
            <div key={i} className="card p-4">
              <p className="text-xs text-gray-400 mb-1">{m.label}</p>
              <p className={`text-2xl font-semibold ${m.color}`}>{loading ? '—' : m.value}</p>
            </div>
          ))}
        </div>

        {/* Filter tabs — tabs hide when their count is 0 so legacy-only
            statuses (pending/interview) don't show forever on a fully
            migrated system. */}
        <div className="flex gap-1.5 mb-4 flex-wrap">
          {[
            ['all',           'All'],
            ['endorsed',      'Endorsed'],
            ['reviewing',     'For Funding'],
            ['awaiting_info', 'Needs Info'],
            ['approved',      'Approved'],
            ['certificate',   'Guarantee Letter'],
            ['rejected',      'Rejected'],
            ['pending',       'Pending (legacy)'],
            ['interview',     'Interview (legacy)'],
          ]
            .filter(([key]) => key === 'all' || countOf(key) > 0 || filter === key)
            .map(([key, label]) => (
              <button key={key}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  filter === key
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
                onClick={() => setFilter(key)}>
                {label}
              </button>
            ))}
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input className="input pl-9" placeholder="Search by patient name, contact, or application ID..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* Table */}
        <div className="card overflow-x-auto">
          <table className="data-table min-w-full">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Application ID</th>
                <th>Submitted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-gray-100 flex-shrink-0" />
                      <div className="space-y-1.5">
                        <div className="h-3 bg-gray-100 rounded w-28" />
                        <div className="h-2.5 bg-gray-100 rounded w-20" />
                      </div>
                    </div>
                  </td>
                  <td><div className="h-3 bg-gray-100 rounded w-24" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-20" /></td>
                  <td><div className="h-5 bg-gray-100 rounded-full w-16" /></td>
                </tr>
              ))}
              {!loading && filtered.map(a => (
                <tr key={a.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-brand-50 text-brand-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
                        {a.patientName?.[0]?.toUpperCase() ?? '?'}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-800">{a.patientName}</p>
                        <p className="text-xs text-gray-400">{a.patientContact || '—'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="font-mono text-xs text-gray-500">{a.appId || a.id.slice(0, 12)}</td>
                  <td className="text-xs text-gray-400">{formatDate(a.submittedAt)}</td>
                  <td>
                    <span className={`badge text-xs ${STATUS_BADGE[a.status] ?? 'badge-gray'}`}>
                      {STATUS_LABEL[a.status] ?? a.status}
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center py-12">
                    <MdListAlt size={36} className="text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">
                      {search || filter !== 'all' ? 'No applications match your filter.' : 'No applications yet.'}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  )
}
