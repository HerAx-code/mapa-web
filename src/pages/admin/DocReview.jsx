import Layout from '../../components/Layout'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MdSearch, MdRefresh, MdChevronRight, MdAssignment } from 'react-icons/md'
import { readableFileType } from '../../utils/export'
import { collection, query, where, limit, startAfter, getDocs, onSnapshot, doc, updateDoc, serverTimestamp, getCountFromServer } from 'firebase/firestore'
import { MdVisibility } from 'react-icons/md'
import { db } from '../../firebase'
import { notify } from '../../utils/notifications'
import { logAudit } from '../../utils/auditLog'
import { useAuth } from '../../contexts/AuthContext'
import toast from 'react-hot-toast'

// ── Main page ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 25



export default function DocReview() {
  const navigate                        = useNavigate()
  const [docs, setDocs]                 = useState([])
  const [loading, setLoading]           = useState(true)
  const [loadingMore, setLoadingMore]   = useState(false)
  const [hasMore, setHasMore]           = useState(false)
  const [lastVisible, setLastVisible]   = useState(null)
  const [search, setSearch]         = useState('')
  const [tab, setTab]               = useState('pending')
  const [typeFilter, setTypeFilter] = useState('all')
  const [docTypes, setDocTypes]         = useState([])
  const [tabCounts,        setTabCounts]        = useState({ pending: 0, verified: 0, rejected: 0 })
  const [presenceMap,      setPresenceMap]      = useState({})
  const [loadError,        setLoadError]        = useState(false)
  const [applicationDocIds, setApplicationDocIds] = useState(new Set())
  const { user } = useAuth()

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'documentTypes'),
      snap => {
        const types = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setDocTypes(types.sort((a, b) => (a.order ?? 999) - (b.order ?? 999)))
      }
    )
    return unsub
  }, [])

  // Tab counts via server-side aggregation — no document data transferred
  const refreshCounts = async () => {
    const [p, v, r] = await Promise.all([
      getCountFromServer(query(collection(db, 'documents'), where('status', '==', 'pending'))),
      getCountFromServer(query(collection(db, 'documents'), where('status', '==', 'verified'))),
      getCountFromServer(query(collection(db, 'documents'), where('status', '==', 'rejected'))),
    ])
    setTabCounts({ pending: p.data().count, verified: v.data().count, rejected: r.data().count })
  }

  useEffect(() => { refreshCounts() }, [])

  // Build set of document IDs currently attached to active applications for priority flagging
  useEffect(() => {
    getDocs(query(
      collection(db, 'applications'),
      where('status', 'in', ['pending', 'reviewing', 'interview'])
    )).then(snap => {
      const ids = new Set()
      snap.docs.forEach(d => {
        const attached = d.data().attachedDocuments ?? []
        attached.forEach(a => ids.add(a.documentId))
      })
      setApplicationDocIds(ids)
    }).catch(() => {})
  }, [])

  // Subscribe to all active presence documents — filter stale entries (>10 min)
  useEffect(() => {
    const TEN_MIN = 10 * 60 * 1000
    const unsub = onSnapshot(collection(db, 'docReviewPresence'), snap => {
      const map = {}
      snap.docs.forEach(d => {
        const names = Object.entries(d.data())
          .filter(([uid, v]) => {
            if (uid === user?.uid) return false
            const since = v.since?.toDate?.() ?? null
            return since ? (Date.now() - since.getTime()) < TEN_MIN : true
          })
          .map(([, v]) => v.name)
        if (names.length > 0) map[d.id] = names
      })
      setPresenceMap(map)
    })
    return unsub
  }, [user?.uid])

  const pendingCount = tabCounts.pending

  // Paginated document loader — no orderBy so all docs appear regardless of createdAt presence;
  // sort client-side newest-first (docs without createdAt fall to the bottom)
  const loadDocs = async (reset = true) => {
    if (reset) { setLoading(true); setLastVisible(null); setLoadError(false) }
    else setLoadingMore(true)
    try {
      const constraints = [limit(PAGE_SIZE)]
      if (tab !== 'all') constraints.unshift(where('status', '==', tab))
      if (!reset && lastVisible) constraints.push(startAfter(lastVisible))
      const snap = await getDocs(query(collection(db, 'documents'), ...constraints))
      const newDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setDocs(prev => {
        const combined = reset ? newDocs : [...prev, ...newDocs]
        return combined.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
      })
      setLastVisible(snap.docs[snap.docs.length - 1] ?? null)
      setHasMore(snap.docs.length === PAGE_SIZE)
    } catch (err) {
      console.error('DocReview load error:', err)
      if (reset) { setDocs([]); setLoadError(true) }
    }
    finally { setLoading(false); setLoadingMore(false) }
  }

  useEffect(() => { loadDocs(true) }, [tab])

  // ── Actions ──────────────────────────────────────────────────────────

  const handleReReview = async (d) => {
    await updateDoc(doc(db, 'documents', d.id), {
      status:          'pending',
      rejectionReason: null,
      reReviewedAt:    serverTimestamp(),
    })
    if (d.patientId) await notify(d.patientId, {
      type:  'doc_verified',
      title: 'Document sent for re-review',
      body:  `Your "${d.name}" is being re-reviewed by the administrator.`,
    })
    logAudit(user, { action: 'doc_rereview', targetType: 'document', targetId: d.id, targetName: d.name, details: `Sent back to Pending from ${d.status}` })
    toast.success('Document sent back for re-review.')
    setDocs(prev => tab === 'all'
      ? prev.map(x => x.id === d.id ? { ...x, status: 'pending' } : x)
      : prev.filter(x => x.id !== d.id)
    )
    refreshCounts()
  }

  const filtered = docs.filter(d => {
    if (typeFilter !== 'all' && d.documentTypeName !== typeFilter && d.name !== typeFilter) return false
    const q = search.toLowerCase()
    return !q || d.name?.toLowerCase().includes(q) || d.patientName?.toLowerCase().includes(q)
  })

  // pendingCount comes from the live onSnapshot listener above

  const showReReview  = tab === 'verified' || tab === 'rejected'
  const showRejReason = tab === 'rejected' || tab === 'all'

  return (
    <Layout breadcrumb="Document Review">
      <div className="p-4 sm:p-6">

        <div className="mb-5">
          <h1 className="page-title">Document Review</h1>
          <p className="page-sub">Review and verify patient document submissions.</p>
        </div>

        {/* Tabs + Review All action */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {[
            ['pending',  'Pending',  tabCounts.pending],
            ['verified', 'Verified', tabCounts.verified],
            ['rejected', 'Rejected', tabCounts.rejected],
            ['all',      'All',      tabCounts.pending + tabCounts.verified + tabCounts.rejected],
          ].map(([key, label, count]) => (
            <button key={key}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center gap-2 ${
                tab === key
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
              onClick={() => { setTab(key); setLoading(true); setLoadError(false) }}>
              {label}
              {count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  tab === key ? 'bg-white/20' : 'bg-gray-100 text-gray-500'
                }`}>{count}</span>
              )}
            </button>
          ))}

          {tab === 'pending' && pendingCount > 0 && (
            <button
              className="btn-primary text-sm flex items-center gap-2 ml-auto"
              onClick={async () => {
                const snap = await getDocs(query(
                  collection(db, 'documents'),
                  where('status', '==', 'pending')
                ))
                const pending = snap.docs
                  .map(d => ({ id: d.id, ...d.data() }))
                  .sort((a, b) => {
                    const aHasApp = applicationDocIds.has(a.id) ? 0 : 1
                    const bHasApp = applicationDocIds.has(b.id) ? 0 : 1
                    if (aHasApp !== bHasApp) return aHasApp - bHasApp
                    return (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0)
                  })
                if (pending.length > 0)
                  navigate(`/admin/docreview/${pending[0].id}`, { state: { docs: pending, startIndex: 0 } })
              }}>
              ▶ Review All Pending
            </button>
          )}
        </div>

        {/* Search + Type Filter */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input className="input pl-9" placeholder="Search by document or patient name..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {docTypes.length > 0 && (
            <select className="input w-52" value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}>
              <option value="all">All Document Types</option>
              {docTypes.map(t => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Search scope notice */}
        {(search || typeFilter !== 'all') && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4 text-sm text-blue-700">
            Search and filter apply to the <strong>{docs.length} loaded documents</strong> only.
            Use <strong>Load more</strong> to expand results, or clear filters to see all.
          </div>
        )}

        {/* Load error */}
        {loadError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-start gap-2">
            <span className="text-red-500 flex-shrink-0 mt-0.5">⚠️</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-700">Failed to load documents</p>
              <p className="text-xs text-red-500 mt-0.5">
                Check your internet connection or Firestore rules, then{' '}
                <button className="underline font-medium" onClick={() => loadDocs(true)}>try again</button>.
              </p>
            </div>
          </div>
        )}

        {/* Re-review note */}
        {showReReview && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4 text-sm text-blue-700">
            Use <strong>Re-review</strong> to send a document back to Pending if it was incorrectly {tab}.
          </div>
        )}

        {/* Table */}
        <div className="card overflow-x-auto">
          <table className="data-table min-w-full">
            <thead>
              <tr>
                <th>Document</th>
                <th>Patient</th>
                <th>File Info</th>
                <th>Submitted</th>
                <th>Status</th>
                {showRejReason && <th>Rejection Reason</th>}
                {(showReReview || tab === 'all') && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-gray-100 rounded-lg flex-shrink-0" />
                      <div className="space-y-1.5">
                        <div className="h-3 bg-gray-100 rounded w-28" />
                        <div className="h-2.5 bg-gray-100 rounded w-20" />
                      </div>
                    </div>
                  </td>
                  <td><div className="h-3 bg-gray-100 rounded w-24" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-20" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-20" /></td>
                  <td><div className="h-5 bg-gray-100 rounded-full w-16" /></td>
                  {showRejReason && <td><div className="h-3 bg-gray-100 rounded w-32" /></td>}
                  {(showReReview || tab === 'all') && <td><div className="h-6 bg-gray-100 rounded w-20" /></td>}
                </tr>
              ))}
              {!loading && filtered.map((d, idx) => {
                const hasActiveApp = applicationDocIds.has(d.id)
                return (
                <tr key={d.id}
                  className={`cursor-pointer hover:bg-gray-50 transition-colors ${hasActiveApp && d.status === 'pending' ? 'bg-blue-50/40' : ''}`}
                  onClick={() => navigate(`/admin/docreview/${d.id}`, { state: { docs: filtered, startIndex: idx } })}>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="text-lg">📄</span>
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-medium text-gray-800 text-sm">{d.name}</p>
                          {hasActiveApp && d.status === 'pending' && (
                            <span className="flex items-center gap-0.5 text-xs font-semibold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full">
                              <MdAssignment size={10} /> Active application
                            </span>
                          )}
                        </div>
                        {presenceMap[d.id] && (
                          <p className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                            <MdVisibility size={11} />
                            Being reviewed by {presenceMap[d.id].join(', ')}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="text-sm text-gray-600">
                    {d.patientName || (
                      <span className="text-gray-400 text-xs font-mono">{d.patientId?.slice(0, 8)}</span>
                    )}
                  </td>
                  <td className="text-xs text-gray-400">{readableFileType(d.type)} · {d.size}</td>
                  <td className="text-xs text-gray-400">{d.date}</td>
                  <td>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`badge text-xs ${
                        d.status === 'verified' ? 'badge-green'
                        : d.status === 'rejected' ? 'badge-red'
                        : 'badge-amber'
                      }`}>
                        {d.status?.charAt(0).toUpperCase() + d.status?.slice(1)}
                      </span>
                      <MdChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                    </div>
                  </td>
                  {showRejReason && (
                    <td className="text-xs text-gray-500 max-w-xs">
                      {d.rejectionReason
                        ? <span className="text-red-600">{d.rejectionReason}</span>
                        : <span className="text-gray-300">—</span>
                      }
                    </td>
                  )}
                  {(showReReview || tab === 'all') && (
                    <td onClick={e => e.stopPropagation()}>
                      {(showReReview || (d.status === 'verified' || d.status === 'rejected')) && (
                        <button
                          title="Send back to Pending"
                          className="flex items-center gap-1 text-xs text-amber-600 border border-amber-200 px-2.5 py-1 rounded-lg hover:bg-amber-50 transition-colors"
                          onClick={() => handleReReview(d)}>
                          <MdRefresh size={13} /> Re-review
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
              })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5 + (showRejReason ? 1 : 0) + (showReReview || tab === 'all' ? 1 : 0)} className="text-center py-10 text-sm text-gray-400">
                    No {tab === 'all' ? '' : tab} documents found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-400">
            Showing {docs.length} document{docs.length !== 1 ? 's' : ''}
            {hasMore ? ` — more available` : ''}
          </p>
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary text-sm flex items-center gap-1.5"
              onClick={() => loadDocs(true)}>
              <MdRefresh size={15} /> Refresh
            </button>
            {hasMore && (
              <button
                className="btn-primary text-sm"
                disabled={loadingMore}
                onClick={() => loadDocs(false)}>
                {loadingMore ? 'Loading…' : `Load more`}
              </button>
            )}
          </div>
        </div>

      </div>
    </Layout>
  )
}
