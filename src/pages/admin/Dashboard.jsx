import Layout from '../../components/Layout'
import { useNavigate } from 'react-router-dom'
import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { ROLES } from '../../utils/constants'
import { collection, query, where, orderBy, limit, onSnapshot, addDoc, getDocs, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import {
  MdBusiness, MdSupervisedUserCircle, MdFactCheck,
  MdListAlt, MdGroup, MdMessage, MdDescription, MdFavorite,
  MdHistory, MdFlag, MdDownload, MdCampaign,
  MdWarning, MdCheckCircle, MdTour,
  // De-emoji sweep: activity feed, metrics, alerts, empty state
  MdLocalHospital, MdPersonAdd, MdCancel, MdAssignment, MdCelebration,
  MdBlock, MdWorkspacePremium, MdInbox, MdAccessTime, MdMarkEmailUnread,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import { logAudit } from '../../utils/auditLog'
import Tour from '../../components/Tour'
import PipelineFunnel from '../../components/admin/PipelineFunnel'
import { stageCounts } from '../../utils/queueBuckets'
import { adminDashboardTour, resetTourFlag } from '../../utils/tours'
import { tsToDate } from '../../utils/dates'

const timeAgo = (ts) => {
  const d = tsToDate(ts)
  if (!d) return ''
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1)   return 'just now'
  if (min < 60)  return `${min}m ago`
  const hrs = Math.floor(min / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const daysSince = (ts) => {
  const d = tsToDate(ts)
  return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : 0
}

const ACTIVITY_CONFIG = {
  registration:  { Icon: MdPersonAdd, label: 'New patient registered',   bg: 'bg-blue-50', path: (it) => `/admin/patients?openId=${it.targetId}` },
  doc_upload:    { Icon: MdDescription,      label: 'Document uploaded',        bg: 'bg-gray-100',  path: () => `/admin/patients` },
  doc_verified:  { Icon: MdCheckCircle,      label: 'Document verified',        bg: 'bg-green-50',  path: () => `/admin/patients` },
  doc_rejected:  { Icon: MdCancel,           label: 'Document rejected',        bg: 'bg-red-50',    path: () => `/admin/patients` },
  app_submitted: { Icon: MdAssignment,       label: 'Application submitted',    bg: 'bg-brand-50',  path: () => `/admin/logs` },
  app_approved:  { Icon: MdCelebration,      label: 'Application approved',     bg: 'bg-green-50',  path: () => `/admin/logs?status=approved` },
  app_rejected:  { Icon: MdBlock,            label: 'Application rejected',     bg: 'bg-red-50',    path: () => `/admin/logs?status=rejected` },
  cert_issued:   { Icon: MdWorkspacePremium, label: 'Guarantee Letter issued',  bg: 'bg-purple-50', path: () => `/admin/logs?status=certificate` },
}

export default function AdminDashboard() {
  const navigate          = useNavigate()
  const { user }          = useAuth()
  const isSuperAdmin      = user?.role === ROLES.SUPER_ADMIN


  const [patientCount,   setPatientCount]   = useState('—')
  const [agencyCount,    setAgencyCount]    = useState('—')
  const [openRequests,   setOpenRequests]   = useState('—')
  const [pipelineReqs,   setPipelineReqs]   = useState([])
  const [pendingDocs,    setPendingDocs]    = useState('—')
  const [recentPatients, setRecentPatients] = useState([])
  const [recentDocs,     setRecentDocs]     = useState([])
  const [recentApps,     setRecentApps]     = useState([])

  // Alerts data
  const [staleApps,     setStaleApps]     = useState([])
  const [lowSlotAgencies, setLowSlotAgencies] = useState([])
  const [openReports,   setOpenReports]   = useState(0)

  // SLA/throughput data (super_admin only)
  const [approvedApps,  setApprovedApps]  = useState([])
  const [rejectedCount, setRejectedCount] = useState(0)
  const [approvedCount, setApprovedCount] = useState(0)
  const [certBacklog,   setCertBacklog]   = useState(0)
  // Delivery health: how many notification/email sends failed recently.
  // notify() logs failures to notificationErrors (admin-read). Surfaced as
  // an alert so staff notice a broken email pipeline instead of it being
  // silently invisible.
  const [deliveryFailures, setDeliveryFailures] = useState(0)

  // Real-time metric counts. Note: agency budget aggregates are no longer
  // shown on the CRMC admin dashboard — funds are intra-agency per the
  // Malasakit Center model. See /agency/allocation (agency_admin role).
  useEffect(() => {
    const u1 = onSnapshot(
      query(collection(db, 'users'),    where('role',    '==', 'patient')),
      snap => setPatientCount(snap.size),
      err => { console.error('[Dashboard] patient count failed:', err); setPatientCount('—') }
    )
    const u3 = onSnapshot(
      query(collection(db, 'agencies'), where('enabled', '==', true)),
      snap => setAgencyCount(snap.size),
      err => { console.error('[Dashboard] agency count failed:', err); setAgencyCount('—') }
    )
    // Open requests = anything still moving through the CRMC pipeline (not
    // closed/rejected/fully_funded). This is the CRMC's actual day-to-day queue.
    const u4 = onSnapshot(
      query(collection(db, 'requests'), where('status', 'in', ['submitted', 'under_review', 'assessment', 'endorsed', 'partially_funded'])),
      snap => { setOpenRequests(snap.size); setPipelineReqs(snap.docs.map(d => d.data())) },
      () => { setOpenRequests('—'); setPipelineReqs([]) }
    )
    const u5 = onSnapshot(
      query(collection(db, 'documents'), where('status', '==', 'pending')),
      snap => setPendingDocs(snap.size), () => setPendingDocs('—')
    )
    return () => { u1(); u3(); u4(); u5() }
  }, [])

  // Recent activity feeds
  useEffect(() => {
    const u1 = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'patient'), orderBy('createdAt', 'desc'), limit(5)),
      snap => setRecentPatients(snap.docs.map(d => ({
        id: d.id, targetId: d.id, type: 'registration',
        body: d.data().name ?? 'Unknown patient',
        createdAt: d.data().createdAt,
      }))),
      err => { console.error('[Dashboard] recent patients failed:', err); setRecentPatients([]) }
    )
    const u2 = onSnapshot(
      query(collection(db, 'documents'), orderBy('createdAt', 'desc'), limit(8)),
      snap => setRecentDocs(snap.docs.map(d => ({
        id: d.id, targetId: d.id,
        type: d.data().status === 'verified' ? 'doc_verified'
            : d.data().status === 'rejected' ? 'doc_rejected' : 'doc_upload',
        body: `${d.data().patientName || 'Patient'} — ${d.data().name}`,
        createdAt: d.data().createdAt,
      }))),
      err => { console.error('[Dashboard] recent docs failed:', err); setRecentDocs([]) }
    )
    const u3 = onSnapshot(
      query(collection(db, 'applications'), orderBy('submittedAt', 'desc'), limit(10)),
      snap => setRecentApps(snap.docs.map(d => {
        const data = d.data()
        const type = data.status === 'approved'    ? 'app_approved'
                   : data.status === 'rejected'    ? 'app_rejected'
                   : data.status === 'certificate' ? 'cert_issued'
                   : 'app_submitted'
        return {
          id:        d.id,
          targetId:  d.id,
          type,
          body:      `${data.patientName ?? 'Patient'} → ${data.agencyName ?? 'Agency'}`,
          createdAt: data.submittedAt,
        }
      })),
      err => { console.error('[Dashboard] recent apps failed:', err); setRecentApps([]) }
    )
    return () => { u1(); u2(); u3() }
  }, [])

  // Alerts: stale applications > 7 days, low slot agencies, open reports.
  // Status list covers both the co-funding slice statuses (reviewing while
  // an agency sits on it, awaiting_info while a patient is being chased)
  // and the legacy pre-redesign statuses (pending) that older applications
  // still carry. Endorsed-but-not-Proceeded slices already have their own
  // amber chip on the CRMC Requests detail + list, so they're excluded
  // here to avoid double-flagging.
  useEffect(() => {
    const u1 = onSnapshot(
      query(collection(db, 'applications'), where('status', 'in', ['pending', 'reviewing', 'awaiting_info'])),
      snap => {
        const stale = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(a => daysSince(a.submittedAt) >= 7)
        setStaleApps(stale)
      },
      err => console.error('[Dashboard] stale apps query failed:', err),
    )
    const u2 = onSnapshot(
      query(collection(db, 'agencies'), where('enabled', '==', true)),
      snap => {
        const low = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(a => {
            const total = a.slots?.total ?? 0
            const rem   = a.slots?.remaining ?? 0
            return total > 0 && rem <= Math.max(1, Math.floor(total * 0.1))
          })
        setLowSlotAgencies(low)
      },
      err => { console.error('[Dashboard] low-slot agencies failed:', err); setLowSlotAgencies([]) }
    )
    const u3 = onSnapshot(
      query(collection(db, 'reports'), where('status', 'in', ['open', 'in_progress'])),
      snap => setOpenReports(snap.size),
      () => setOpenReports(0)
    )
    return () => { u1(); u2(); u3() }
  }, [])

  // SLA: approved/certificate apps for processing-time calc, rejected count, certificate backlog
  useEffect(() => {
    if (!isSuperAdmin) return
    const u1 = onSnapshot(
      query(collection(db, 'applications'), where('status', 'in', ['approved', 'certificate'])),
      snap => {
        setApprovedApps(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setApprovedCount(snap.size)
        setCertBacklog(snap.docs.filter(d => d.data().status === 'approved').length)
      },
      err => {
        console.error('[Dashboard] approved apps failed:', err)
        setApprovedApps([]); setApprovedCount('—'); setCertBacklog('—')
      }
    )
    const u2 = onSnapshot(
      query(collection(db, 'applications'), where('status', '==', 'rejected')),
      snap => setRejectedCount(snap.size),
      err => { console.error('[Dashboard] rejected count failed:', err); setRejectedCount('—') }
    )
    return () => { u1(); u2() }
  }, [isSuperAdmin])

  // Delivery health — notification/email failures in the last 7 days.
  // Fetch the 50 most recent and filter client-side so no composite index
  // is required. Admin-read is granted on notificationErrors for both
  // super_admin and staff_admin.
  useEffect(() => {
    const cutoff = Date.now() - 7 * 86400000
    const u = onSnapshot(
      query(collection(db, 'notificationErrors'), orderBy('at', 'desc'), limit(50)),
      snap => {
        const recent = snap.docs.filter(d => ((d.data().at?.seconds ?? 0) * 1000) >= cutoff)
        setDeliveryFailures(recent.length)
      },
      err => { console.error('[Dashboard] delivery health failed:', err); setDeliveryFailures(0) }
    )
    return () => u()
  }, [])

  const activityFeed = [...recentPatients, ...recentDocs, ...recentApps]
    .filter(a => a.createdAt)
    .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
    .slice(0, 10)

  const slaMetrics = useMemo(() => {
    if (!isSuperAdmin) return null
    const withDates = approvedApps.filter(a => a.submittedAt && a.approvedAt)
    const avgDays = withDates.length === 0 ? null
      : Math.round(
          withDates.reduce((sum, a) => {
            const sub = tsToDate(a.submittedAt)
            const app = tsToDate(a.approvedAt)
            return sum + ((app?.getTime() ?? 0) - (sub?.getTime() ?? 0)) / 86400000
          }, 0) / withDates.length
        )
    const total = approvedCount + rejectedCount
    const approvalRate = total === 0 ? null : Math.round((approvedCount / total) * 100)
    return { avgDays, approvalRate, certBacklog }
  }, [isSuperAdmin, approvedApps, approvedCount, rejectedCount, certBacklog])

  // Action-first: an operator's live workload (open requests, docs to verify)
  // leads; program totals (patients, agencies) follow.
  const METRICS = [
    {
      label: 'Open Requests',   value: openRequests,
      Icon: MdListAlt, valueCls: 'text-brand-600', bg: 'bg-brand-50', iconCls: 'text-brand-600', path: '/admin/requests',
    },
    {
      label: 'Pending Docs',    value: pendingDocs,
      Icon: MdDescription, valueCls: 'text-amber-600', bg: 'bg-amber-50', iconCls: 'text-amber-600', path: '/admin/requests',
    },
    {
      label: 'Total Patients',  value: patientCount,
      Icon: MdGroup, valueCls: 'text-gray-900', bg: 'bg-blue-50', iconCls: 'text-blue-600', path: '/admin/patients',
    },
    {
      label: 'Active Agencies', value: agencyCount,
      Icon: MdLocalHospital, valueCls: 'text-green-600', bg: 'bg-green-50', iconCls: 'text-green-600', path: '/admin/agencies',
    },
  ]

  const MANAGE_ACTIONS = [
    { label: 'Agencies',     icon: MdBusiness,             color: 'bg-green-50  text-green-600',  path: '/admin/agencies',     forAll: true },
    isSuperAdmin && { label: 'Accounts', icon: MdSupervisedUserCircle, color: 'bg-purple-50 text-purple-600', path: '/admin/accounts' },
    { label: 'Doc Types',    icon: MdDescription,          color: 'bg-blue-50   text-blue-600',   path: '/admin/doctypes',     forAll: true },
    { label: 'Assistance',   icon: MdFavorite,             color: 'bg-pink-50   text-pink-600',   path: '/admin/assistance',   forAll: true },
    { label: 'Patients',     icon: MdGroup,                color: 'bg-red-50    text-red-600',    path: '/admin/patients',     forAll: true },
  ].filter(Boolean)

  const REVIEW_ACTIONS = [
    { label: 'Requests',    icon: MdFactCheck, color: 'bg-brand-50  text-brand-600',  path: '/admin/requests',     forAll: true },
    { label: 'App Logs',    icon: MdListAlt,  color: 'bg-teal-50   text-teal-600',   path: '/admin/logs',         forAll: true },
    { label: 'Messages',    icon: MdMessage,  color: 'bg-cyan-50   text-cyan-600',   path: '/admin/messages',     forAll: true },
    { label: 'Reports',     icon: MdFlag,     color: 'bg-orange-50 text-orange-600', path: '/admin/reports',      forAll: true },
    { label: 'Export',      icon: MdDownload, color: 'bg-brand-50  text-brand-600',  path: '/admin/export',       forAll: true },
    { label: 'Announcements', icon: MdCampaign, color: 'bg-yellow-50 text-yellow-700', path: '/admin/announcements', forAll: true },
    isSuperAdmin && { label: 'Audit Log',  icon: MdHistory,  color: 'bg-gray-50   text-gray-600',   path: '/admin/auditlog' },
  ].filter(Boolean)

  const handleActivityClick = (item) => {
    const cfg = ACTIVITY_CONFIG[item.type]
    if (cfg?.path) navigate(cfg.path(item))
  }

  const alerts = [
    staleApps.length > 0 && {
      key: 'stale',
      Icon: MdAccessTime,
      label: `${staleApps.length} stale application${staleApps.length === 1 ? '' : 's'}`,
      detail: 'No agency response in 7+ days',
      tone: 'red',
      path: '/admin/logs',
    },
    lowSlotAgencies.length > 0 && {
      key: 'lowslots',
      Icon: MdWarning,
      label: `${lowSlotAgencies.length} ${lowSlotAgencies.length === 1 ? 'agency' : 'agencies'} low on slots`,
      detail: lowSlotAgencies.map(a => a.name).slice(0, 3).join(', '),
      tone: 'amber',
      path: '/admin/agencies',
    },
    openReports > 0 && {
      key: 'reports',
      Icon: MdFlag,
      label: `${openReports} open report${openReports === 1 ? '' : 's'}`,
      detail: 'Awaiting review or resolution',
      tone: 'orange',
      path: '/admin/reports',
    },
    deliveryFailures > 0 && {
      key: 'delivery',
      Icon: MdMarkEmailUnread,
      label: `${deliveryFailures} notification${deliveryFailures === 1 ? '' : 's'} failed to send`,
      detail: 'Delivery errors in the last 7 days — check email configuration',
      tone: 'red',
      path: '/admin/logs',
    },
  ].filter(Boolean)

  const TONE_CLS = {
    red:    'bg-red-50    border-red-100    text-red-700',
    amber:  'bg-amber-50  border-amber-100  text-amber-700',
    orange: 'bg-orange-50 border-orange-100 text-orange-700',
    blue:   'bg-blue-50   border-blue-100   text-blue-700',
  }

  // Active-request distribution across the CRMC lifecycle stages (live) — open
  // stages only (fully_funded/closed/rejected aren't loaded). Shared stageCounts
  // helper so the label mapping isn't duplicated with Analytics.
  const pipelineStages = useMemo(
    () => stageCounts(pipelineReqs, ['submitted', 'under_review', 'assessment', 'endorsed', 'partially_funded']),
    [pipelineReqs])

  return (
    <Layout breadcrumb={isSuperAdmin ? 'System Administration' : 'Operations'}>
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">

        {/* Header — compact; processing-health chips inline (super admin), so
            the health read sits at first glance without a separate strip. */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="eyebrow">Console</p>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              {isSuperAdmin ? 'System Administration' : 'Operations'}
            </h1>
          </div>
          {isSuperAdmin && slaMetrics && (
            <div className="flex items-center gap-2">
              {[
                { label: 'Avg. processing', value: slaMetrics.avgDays != null ? `${slaMetrics.avgDays}d` : '—' },
                { label: 'Approval rate',   value: slaMetrics.approvalRate != null ? `${slaMetrics.approvalRate}%` : '—' },
                { label: 'GL backlog',      value: slaMetrics.certBacklog },
              ].map(h => (
                <div key={h.label} className="rounded-lg border border-gray-100 bg-white px-3 py-1.5 text-center min-w-[74px]">
                  <p className="text-sm font-semibold text-gray-800 tabular-nums leading-none">{h.value}</p>
                  <p className="text-[11px] text-gray-400 mt-1">{h.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* KPI tiles — live workload first */}
        <div data-tour-id="admin-metrics" className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {METRICS.map((m, i) => (
            <button key={i} onClick={() => navigate(m.path)}
              className="stat-tile text-left hover:shadow-md transition-all">
              <div className="flex items-center justify-between">
                <div className={`w-9 h-9 ${m.bg} rounded-xl flex items-center justify-center`}>
                  <m.Icon className={m.iconCls} size={20} />
                </div>
                <p className={`stat-num ${m.valueCls}`}>{m.value}</p>
              </div>
              <p className="stat-label mt-2">{m.label}</p>
            </button>
          ))}
        </div>

        {/* Main grid — attention + pipeline (priority, left) · shortcuts +
            activity (right). Compact so the whole console reads on one screen. */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">

          <div className="lg:col-span-8 space-y-4">
            {/* Needs attention — the first thing an operator should act on. */}
            {alerts.length > 0 && (
              <div data-tour-id="admin-alerts" className="card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <MdWarning size={16} className="text-amber-500" />
                  <p className="text-sm font-semibold text-gray-800">Needs attention</p>
                  <span className="text-xs text-gray-400">{alerts.length} item{alerts.length === 1 ? '' : 's'}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {alerts.map(a => (
                    <button key={a.key} onClick={() => navigate(a.path)}
                      className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-all hover:shadow-sm ${TONE_CLS[a.tone]}`}>
                      <a.Icon size={17} className="mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{a.label}</p>
                        <p className="text-xs opacity-80 truncate">{a.detail}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Request pipeline — where the active workload sits. */}
            <PipelineFunnel stages={pipelineStages} onOpenQueue={() => navigate('/admin/requests')} />
          </div>

          {/* Right — shortcuts + recent activity, both compact. */}
          <div className="lg:col-span-4 space-y-4">
            <div data-tour-id="admin-actions" className="card p-4">
              <p className="eyebrow mb-2">Manage</p>
              <div className="grid grid-cols-3 gap-2">
                {MANAGE_ACTIONS.map((qa, i) => (
                  <button key={i} onClick={() => navigate(qa.path)}
                    className="flex flex-col items-center gap-1.5 rounded-lg border border-gray-100 p-2.5 hover:bg-gray-50 hover:shadow-sm transition-all text-center">
                    <div className={`w-8 h-8 ${qa.color} rounded-lg flex items-center justify-center`}><qa.icon size={17} /></div>
                    <p className="text-[11px] text-gray-600 font-medium leading-tight">{qa.label}</p>
                  </button>
                ))}
              </div>
              <p className="eyebrow mb-2 mt-4">Review</p>
              <div className="grid grid-cols-3 gap-2">
                {REVIEW_ACTIONS.map((qa, i) => (
                  <button key={i} onClick={() => navigate(qa.path)}
                    className="flex flex-col items-center gap-1.5 rounded-lg border border-gray-100 p-2.5 hover:bg-gray-50 hover:shadow-sm transition-all text-center">
                    <div className={`w-8 h-8 ${qa.color} rounded-lg flex items-center justify-center`}><qa.icon size={17} /></div>
                    <p className="text-[11px] text-gray-600 font-medium leading-tight">{qa.label}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Recent activity — top 6, compact. */}
            <div data-tour-id="admin-activity" className="card overflow-hidden">
              <div className="flex items-center justify-between px-4 pt-4 pb-1">
                <h2 className="text-sm font-semibold text-gray-800">Recent activity</h2>
                <button onClick={() => navigate('/admin/logs')}
                  className="text-xs text-brand-500 hover:text-brand-600 font-medium">View all →</button>
              </div>
              {activityFeed.length === 0 ? (
                <div className="py-8 text-center">
                  <MdInbox className="mx-auto mb-2 text-gray-300" size={30} />
                  <p className="text-sm text-gray-400">No recent activity yet</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {activityFeed.slice(0, 6).map((item) => {
                    const cfg = ACTIVITY_CONFIG[item.type] || ACTIVITY_CONFIG.doc_upload
                    return (
                      <button key={item.id + item.type} onClick={() => handleActivityClick(item)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors text-left">
                        <div className={`w-7 h-7 ${cfg.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                          <cfg.Icon className="text-gray-600" size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-700">{cfg.label}</p>
                          <p className="text-xs text-gray-400 truncate">{item.body}</p>
                        </div>
                        <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">{timeAgo(item.createdAt)}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Replay-tour link — compact footer. */}
        <div className="mt-6 text-center">
          <button
            onClick={() => { resetTourFlag('admin-dashboard', user?.uid); window.location.reload() }}
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-brand-600 transition-colors">
            <MdTour size={14} /> Show welcome tour again
          </button>
        </div>
      </div>

      {/* First-visit guided tour for CRMC operators. Auto-fires once per
          uid; spotlights metrics, alerts, activity feed, and Manage /
          Review shortcuts. */}
      <Tour steps={adminDashboardTour} storageKey="admin-dashboard" />
    </Layout>
  )
}
