import { useState, useEffect, useMemo } from 'react'
import Layout from '../../components/Layout'
import StatusBadge from '../../components/ui/StatusBadge'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  collection, query, where, onSnapshot,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { getOrCreateConversation } from '../../utils/messages'
import { isGLExpired, isGLExpiringSoon, glDaysRemaining } from '../../utils/constants'
import {
  MdSearch, MdDescription, MdMessage, MdInbox,
  MdOpenInNew, MdClose,
} from 'react-icons/md'
import toast from 'react-hot-toast'

// ── Helpers ───────────────────────────────────────────────────────────────
// All timestamp inputs from Firestore are Timestamp objects in production, but
// legacy/seed data sometimes lands as Date or ISO string -- tsToDate() is the
// single defensive converter.
const tsToDate = (ts) => !ts ? null : (ts.toDate ? ts.toDate() : new Date(ts))
const daysSince = (ts) => {
  const d = tsToDate(ts)
  return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null
}
const formatDate = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
}
// isGLExpired now lives in utils/constants alongside GL_VALIDITY_DAYS so
// every consumer (Inbox, ApplicationDetail, Dashboard, TrackStatus) shares
// one definition of "GL past its validity window but glStatus still says
// issued" and there's no risk of the threshold or the boundary condition
// drifting between files.

// Status badge/label was inlined here. Now uses the shared <StatusBadge />
// component sourced from APP_STATUS_CONFIG in constants.js — keeps wording
// and colors consistent with every other page that shows app status.

// ── Main ─────────────────────────────────────────────────────────────────

export default function Inbox() {
  const { user }                        = useAuth()
  const navigate                        = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [applications, setApplications] = useState([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [messaging, setMessaging]       = useState(null)

  const statusFilter = searchParams.get('status') ?? 'all'
  const setStatusFilter = (next) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'all') params.delete('status')
    else params.set('status', next)
    setSearchParams(params, { replace: true })
  }

  useEffect(() => {
    if (!user?.agencyId) return
    // No server-side orderBy — combining where() with orderBy() would require a
    // composite index. Per-agency volume is small; sort client-side instead.
    const q = query(
      collection(db, 'applications'),
      where('agencyId', '==', user.agencyId),
    )
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      rows.sort((a, b) => {
        const ta = a.submittedAt?.toMillis?.() ?? 0
        const tb = b.submittedAt?.toMillis?.() ?? 0
        return tb - ta
      })
      setApplications(rows)
      setLoading(false)
    }, (err) => {
      setLoading(false)
      console.error('[Inbox] applications snapshot error:', err)
      toast.error('Failed to load applications.')
    })
    return unsub
  }, [user?.agencyId])

  const handleMessagePatient = async (app) => {
    if (!app?.patientId || messaging) return
    setMessaging(app.id)
    try {
      const convId = await getOrCreateConversation(user.uid, app.patientId, {
        names:   { [user.uid]: user.name, [app.patientId]: app.patientName },
        roles:   { [user.uid]: 'agency', [app.patientId]: 'patient' },
        subject: `Re: Application ${app.appId || app.id.slice(0, 8)}`,
      })
      navigate(`/agency/messages?conv=${convId}`)
    } catch {
      toast.error('Could not open conversation. Please try again.')
    } finally {
      setMessaging(null)
    }
  }

  const goToApp = (app) => {
    navigate(`/agency/applications/${app.id}${statusFilter !== 'all' ? `?queue=${statusFilter}` : '?queue=all'}`)
  }

  const countOf = (s) => applications.filter(a => a.status === s).length

  // Duplicates: same patient, multiple non-rejected/non-certificate apps
  const duplicatePatientIds = useMemo(() => {
    const counts = {}
    applications.forEach(a => {
      if (['rejected', 'certificate', 'endorsed'].includes(a.status)) return
      counts[a.patientId] = (counts[a.patientId] ?? 0) + 1
    })
    return new Set(Object.keys(counts).filter(id => counts[id] > 1))
  }, [applications])

  const filtered = applications.filter(a => {
    // 'endorsed' slices are awaiting the patient to accept the coverage plan —
    // they don't enter the agency queue until the patient proceeds (reviewing).
    if (a.status === 'endorsed') return false
    if (statusFilter !== 'all') {
      if (statusFilter === 'approved' && !['approved','certificate'].includes(a.status)) return false
      if (statusFilter !== 'approved' && a.status !== statusFilter) return false
    }
    const q = search.toLowerCase()
    return !q ||
      a.patientName?.toLowerCase().includes(q) ||
      a.appId?.toLowerCase().includes(q) ||
      a.patientContact?.includes(q)
  })

  return (
    <Layout breadcrumb="Application Inbox">
      <div className="p-4 sm:p-6">

        {/* Header */}
        <div className="mb-5">
          <h1 className="page-title">Application Inbox</h1>
          <p className="page-sub">Click any row to open the full case record.</p>
        </div>

        {/* Summary cards (clickable filters). Under the co-funding model,
            slices only sit in For Funding (reviewing) / Needs Info
            (awaiting_info) / Approved / Rejected — CRMC handles doc review
            and the assessment interview on the parent request. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
          {[
            { label: 'Total',       value: applications.filter(a => a.status !== 'endorsed').length, color: 'text-gray-800',   key: 'all' },
            { label: 'For Funding', value: countOf('reviewing'),               color: 'text-amber-600',  key: 'reviewing' },
            { label: 'Needs Info',  value: countOf('awaiting_info'),           color: 'text-orange-600', key: 'awaiting_info' },
            { label: 'Approved',    value: countOf('approved') + countOf('certificate'), color: 'text-green-600', key: 'approved' },
            { label: 'Rejected',    value: countOf('rejected'),                color: 'text-red-500',    key: 'rejected' },
          ].map(m => {
            const active = statusFilter === m.key
            return (
              <button key={m.key}
                onClick={() => setStatusFilter(active && m.key !== 'all' ? 'all' : m.key)}
                className={`card p-4 text-left transition-all hover:shadow-md ${active ? 'ring-2 ring-brand-300' : ''}`}>
                <p className="text-xs text-gray-400 mb-1">{m.label}</p>
                <p className={`text-2xl font-semibold ${m.color}`}>{loading ? '—' : m.value}</p>
              </button>
            )
          })}
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input className="input pl-9 pr-10" placeholder="Search by patient name, contact, or application ID..."
            value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
              <MdClose size={14} />
            </button>
          )}
        </div>

        {/* Table */}
        <div className="card overflow-x-auto">
          <table className="data-table min-w-full">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Application ID</th>
                <th>Submitted</th>
                <th>Documents</th>
                <th>Status</th>
                <th></th>
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
                  <td><div className="h-3 bg-gray-100 rounded w-16" /></td>
                  <td><div className="h-5 bg-gray-100 rounded-full w-16" /></td>
                  <td><div className="h-7 bg-gray-100 rounded w-20" /></td>
                </tr>
              ))}

              {!loading && filtered.map(app => {
                const isDuplicate = duplicatePatientIds.has(app.patientId) &&
                  !['rejected','certificate'].includes(app.status)
                const days = daysSince(app.submittedAt)
                // null-safe: when days is null (no submittedAt), fall through
                // to the gray-400 default rather than letting null >= N quietly
                // evaluate to false.
                const dayColor = days == null ? 'text-gray-400'
                  : days >= 7 ? 'text-red-500'
                  : days >= 3 ? 'text-amber-500'
                  : 'text-gray-400'
                return (
                  <tr key={app.id}
                    className={`cursor-pointer ${isDuplicate ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'}`}
                    onClick={() => goToApp(app)}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-brand-50 text-brand-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
                          {app.patientName?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-800">
                            {app.patientName}
                            {isDuplicate && (
                              <span className="ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">
                                Duplicate
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-gray-400">{app.patientContact}</p>
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs text-gray-500">{app.appId}</td>
                    <td>
                      <p className="text-xs text-gray-500">{formatDate(app.submittedAt)}</p>
                      {days !== null && !['approved','certificate','rejected'].includes(app.status) && (
                        <p className={`text-xs font-medium ${dayColor}`}>
                          {days === 0 ? 'Today' : `${days}d waiting`}
                        </p>
                      )}
                    </td>
                    <td>
                      {app.attachedDocuments?.length > 0 ? (
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <MdDescription size={13} className="text-gray-400" />
                          {app.attachedDocuments.length} doc{app.attachedDocuments.length !== 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-col gap-0.5 items-start">
                        <StatusBadge status={app.status} kind="app" />
                        {app.glStatus && ['approved','certificate'].includes(app.status) && (
                          <span className={`text-xs ${
                            app.glStatus === 'redeemed' ? 'text-green-600'
                            : app.glStatus === 'expired' ? 'text-orange-600'
                            : isGLExpired(app) ? 'text-orange-500 font-medium'
                            : 'text-gray-500'
                          }`}>
                            GL: {isGLExpired(app) && app.glStatus === 'issued' ? 'Expired (action needed)' : app.glStatus}
                          </span>
                        )}
                        {/* Pre-expiry triage chip: nudges the coordinator to
                            contact the patient before the GL lapses and the
                            committed budget has to be reclaimed. Only shown
                            while still valid (isGLExpired() handles the post-
                            expiry state above). */}
                        {isGLExpiringSoon(app) && (
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                            ⚠ GL expires in {glDaysRemaining(app)}d
                          </span>
                        )}
                      </div>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5 justify-end">
                        <button
                          title="Message patient"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors disabled:opacity-50"
                          onClick={() => handleMessagePatient(app)}
                          disabled={messaging === app.id}>
                          <MdMessage size={15} />
                        </button>
                        <button className="btn-primary text-xs py-1 px-2.5 flex items-center gap-1"
                          onClick={() => goToApp(app)}>
                          Open <MdOpenInNew size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12">
                    <MdInbox size={36} className="text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">
                      {search || statusFilter !== 'all'
                        ? 'No applications match your filter.'
                        : 'No applications yet. They will appear here when CRMC endorses requests to your agency.'}
                    </p>
                    {(search || statusFilter !== 'all') && (
                      <button
                        onClick={() => { setSearch(''); setStatusFilter('all') }}
                        className="mt-3 inline-flex items-center text-sm font-medium text-brand-500 hover:text-brand-600">
                        Clear filters
                      </button>
                    )}
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
