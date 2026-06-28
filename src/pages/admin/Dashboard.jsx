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
  MdWarning, MdSpeed, MdCheckCircle, MdTimer, MdTour, MdAutoFixHigh,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import { logAudit } from '../../utils/auditLog'
import Tour from '../../components/Tour'
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
  registration:  { emoji: '👤', label: 'New patient registered',   bg: 'bg-blue-50',   path: (it) => `/admin/patients?openId=${it.targetId}` },
  doc_upload:    { emoji: '📄', label: 'Document uploaded',        bg: 'bg-gray-100',  path: () => `/admin/patients` },
  doc_verified:  { emoji: '✅', label: 'Document verified',        bg: 'bg-green-50',  path: () => `/admin/patients` },
  doc_rejected:  { emoji: '❌', label: 'Document rejected',        bg: 'bg-red-50',    path: () => `/admin/patients` },
  app_submitted: { emoji: '📋', label: 'Application submitted',    bg: 'bg-brand-50',  path: () => `/admin/logs` },
  app_approved:  { emoji: '🎉', label: 'Application approved',     bg: 'bg-green-50',  path: () => `/admin/logs?status=approved` },
  app_rejected:  { emoji: '🚫', label: 'Application rejected',     bg: 'bg-red-50',    path: () => `/admin/logs?status=rejected` },
  cert_issued:   { emoji: '🏆', label: 'Guarantee Letter issued',  bg: 'bg-purple-50', path: () => `/admin/logs?status=certificate` },
}

export default function AdminDashboard() {
  const navigate          = useNavigate()
  const { user }          = useAuth()
  const isSuperAdmin      = user?.role === ROLES.SUPER_ADMIN

  // Phase 4.7: Seed demo announcements from the dashboard. The original
  // scripts/seed-demo-scenario.js seeds requests + documents + announcements
  // via the admin SDK (bypasses rules). From the client, super_admin can
  // create announcements but NOT requests/documents (those are patient-
  // create-only by rule -- on purpose). So this button reseeds the
  // demo announcements that expire after 14 days, removing the
  // CLI-with-service-account dependency for defense walkthroughs.
  // Requests + documents persist in Firestore and don't need re-seeding.
  const [seeding, setSeeding] = useState(false)
  const handleSeedAnnouncements = async () => {
    if (seeding) return
    setSeeding(true)
    try {
      const now   = Date.now()
      const start = new Date(now)
      const end   = new Date(now + 14 * 24 * 60 * 60 * 1000)
      // 1. CRMC info: visible on dashboard card + top banner, all roles
      await addDoc(collection(db, 'announcements'), {
        type: 'info',
        title: 'Office hours updated for the holidays',
        message: 'CRMC Malasakit Center will be open 9am-12nn on December 24 and December 31. Regular hours resume January 2.',
        startAt: start, endAt: end,
        surface: 'both',
        targetRoles: ['patient', 'agency', 'agency_admin'],
        source: 'crmc',
        active: true,
        reminderSent: true,
        createdAt: serverTimestamp(),
        createdBy: user?.name ?? 'Admin (Seed)',
        createdById: user?.uid ?? 'seed-button',
      })
      // 2. Malasakit promo (best-effort -- skip if reference data missing)
      let malasakitId = null
      try {
        const malSnap = await getDocs(query(collection(db, 'agencies'), where('name', '==', 'Malasakit Center'), limit(1)))
        if (!malSnap.empty) malasakitId = malSnap.docs[0].id
      } catch { /* tolerate */ }
      if (malasakitId) {
        await addDoc(collection(db, 'announcements'), {
          type: 'info',
          title: 'New: Bilirubin therapy assistance available this month',
          message: 'Malasakit Center is now covering bilirubin lights and phototherapy supplies for indigent newborns. Walk in or apply through MAPA -- ask your social worker.',
          startAt: start, endAt: end,
          surface: 'feed',
          targetRoles: ['patient'],
          source: 'agency',
          agencyId: malasakitId,
          agencyName: 'Malasakit Center',
          active: true,
          reminderSent: true,
          createdAt: serverTimestamp(),
          createdBy: user?.name ?? 'Admin (Seed)',
          createdById: user?.uid ?? 'seed-button',
        })
      }
      logAudit(user, {
        action: 'demo_announcements_seeded',
        targetType: 'announcement',
        targetName: `Demo seed (${malasakitId ? 2 : 1} announcements)`,
        details: `Reseeded for defense walkthrough`,
      })
      toast.success(`Seeded ${malasakitId ? 2 : 1} demo announcement${malasakitId ? 's' : ''}.`)
    } catch (err) {
      console.error('[Dashboard] demo seed failed:', err)
      toast.error('Failed to seed demo announcements. Check console.')
    } finally {
      setSeeding(false)
    }
  }

  const [patientCount,   setPatientCount]   = useState('—')
  const [agencyCount,    setAgencyCount]    = useState('—')
  const [openRequests,   setOpenRequests]   = useState('—')
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
      snap => setOpenRequests(snap.size), () => setOpenRequests('—')
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

  const METRICS = [
    {
      label: 'Total Patients',  value: patientCount,
      emoji: '👥', valueCls: 'text-gray-900', bg: 'bg-blue-50', path: '/admin/patients',
    },
    {
      label: 'Active Agencies', value: agencyCount,
      emoji: '🏥', valueCls: 'text-green-600', bg: 'bg-green-50', path: '/admin/agencies',
    },
    {
      label: 'Open Requests',   value: openRequests,
      emoji: '📋', valueCls: 'text-brand-600', bg: 'bg-brand-50', path: '/admin/requests',
    },
    {
      label: 'Pending Docs',    value: pendingDocs,
      emoji: '📄', valueCls: 'text-amber-600', bg: 'bg-amber-50', path: '/admin/requests',
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
      icon: '⏰',
      label: `${staleApps.length} stale application${staleApps.length === 1 ? '' : 's'}`,
      detail: 'No agency response in 7+ days',
      tone: 'red',
      path: '/admin/logs',
    },
    lowSlotAgencies.length > 0 && {
      key: 'lowslots',
      icon: '⚠️',
      label: `${lowSlotAgencies.length} ${lowSlotAgencies.length === 1 ? 'agency' : 'agencies'} low on slots`,
      detail: lowSlotAgencies.map(a => a.name).slice(0, 3).join(', '),
      tone: 'amber',
      path: '/admin/agencies',
    },
    openReports > 0 && {
      key: 'reports',
      icon: '🚩',
      label: `${openReports} open report${openReports === 1 ? '' : 's'}`,
      detail: 'Awaiting review or resolution',
      tone: 'orange',
      path: '/admin/reports',
    },
  ].filter(Boolean)

  const TONE_CLS = {
    red:    'bg-red-50    border-red-100    text-red-700',
    amber:  'bg-amber-50  border-amber-100  text-amber-700',
    orange: 'bg-orange-50 border-orange-100 text-orange-700',
    blue:   'bg-blue-50   border-blue-100   text-blue-700',
  }

  return (
    <Layout breadcrumb={isSuperAdmin ? 'System Administration' : 'Operations'}>
      <div className="p-4 sm:p-6">

        {/* Page header */}
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="page-title">
              {isSuperAdmin ? 'System Administration' : 'Operations Dashboard'}
            </h1>
            <p className="page-sub">
              {isSuperAdmin
                ? 'Global overview of MAPA metrics, alerts, and processing health.'
                : 'Daily operations — review documents, manage applications, and respond to patient needs.'}
            </p>
          </div>
          {/* Phase 4.7: defense reliability button. Reseeds the demo
              announcements (which expire after 14 days) without needing
              to drop to CLI + service-account.json. Super-admin only --
              the announcements rule requires admin write. */}
          {isSuperAdmin && (
            <button
              onClick={handleSeedAnnouncements}
              disabled={seeding}
              className="btn-secondary text-xs flex items-center gap-1.5 flex-shrink-0 disabled:opacity-60"
              title="Reseed the two demo announcements (14-day expiry)">
              <MdAutoFixHigh size={14} /> {seeding ? 'Seeding…' : 'Seed demo'}
            </button>
          )}
        </div>

        {/* ── Metric cards ── */}
        <div data-tour-id="admin-metrics" className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          {METRICS.map((m, i) => (
            <button key={i} onClick={() => navigate(m.path)}
              className="card p-4 text-left hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-2">
                <div className={`w-9 h-9 ${m.bg} rounded-xl flex items-center justify-center text-lg`}>
                  {m.emoji}
                </div>
                <p className={`text-2xl font-bold ${m.valueCls}`}>{m.value}</p>
              </div>
              <p className="text-xs font-medium text-gray-500">{m.label}</p>
            </button>
          ))}
        </div>

        {/* ── SLA strip (super admin only) ── */}
        {isSuperAdmin && slaMetrics && (
          <div className="card p-4 mb-5">
            <div className="flex items-center gap-2 mb-3">
              <MdSpeed size={16} className="text-brand-500" />
              <p className="text-sm font-semibold text-gray-800">Processing Health</p>
              <span className="text-xs text-gray-400 ml-auto">Last 30 days · all agencies</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-brand-50 rounded-xl flex items-center justify-center flex-shrink-0">
                  <MdTimer size={18} className="text-brand-500" />
                </div>
                <div>
                  <p className="text-xs text-gray-400">Avg. Processing Time</p>
                  <p className="text-xl font-semibold text-gray-800">
                    {slaMetrics.avgDays != null ? `${slaMetrics.avgDays}d` : '—'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center flex-shrink-0">
                  <MdCheckCircle size={18} className="text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-400">Approval Rate</p>
                  <p className="text-xl font-semibold text-gray-800">
                    {slaMetrics.approvalRate != null ? `${slaMetrics.approvalRate}%` : '—'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-purple-50 rounded-xl flex items-center justify-center flex-shrink-0">
                  <MdFactCheck size={18} className="text-purple-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-400">Guarantee Letter Backlog</p>
                  <p className="text-xl font-semibold text-gray-800">{slaMetrics.certBacklog}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Funds overview removed — CRMC has zero fund authority. Each
            agency manages its own allocation via /agency/allocation. */}

        {/* ── Alerts panel ── */}
        {alerts.length > 0 && (
          <div data-tour-id="admin-alerts" className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <MdWarning size={16} className="text-amber-500" />
              <p className="text-sm font-semibold text-gray-800">Needs Attention</p>
              <span className="text-xs text-gray-400">{alerts.length} item{alerts.length === 1 ? '' : 's'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {alerts.map(a => (
                <button key={a.key} onClick={() => navigate(a.path)}
                  className={`flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-all hover:shadow-sm ${TONE_CLS[a.tone]}`}>
                  <span className="text-lg leading-none mt-0.5">{a.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{a.label}</p>
                    <p className="text-xs opacity-80 truncate">{a.detail}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Two-column layout ── */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">

          {/* Recent Activity (3/5) */}
          <div data-tour-id="admin-activity" className="xl:col-span-3">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-800">Recent Activity</h2>
              <button onClick={() => navigate('/admin/logs')}
                className="text-xs text-brand-500 hover:text-brand-600 font-medium">
                View all →
              </button>
            </div>
            <div className="card overflow-hidden divide-y divide-gray-50">
              {activityFeed.length === 0 && (
                <div className="py-12 text-center">
                  <p className="text-3xl mb-2">📭</p>
                  <p className="text-sm text-gray-400">No recent activity yet</p>
                  <p className="text-xs text-gray-300 mt-1">Activity will appear as patients register and upload documents</p>
                </div>
              )}
              {activityFeed.map((item) => {
                const cfg = ACTIVITY_CONFIG[item.type] || ACTIVITY_CONFIG.doc_upload
                return (
                  <button key={item.id + item.type}
                    onClick={() => handleActivityClick(item)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left">
                    <div className={`w-8 h-8 ${cfg.bg} rounded-lg flex items-center justify-center text-base flex-shrink-0`}>
                      {cfg.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-700">{cfg.label}</p>
                      <p className="text-xs text-gray-400 truncate">{item.body}</p>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">
                      {timeAgo(item.createdAt)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Quick Actions (2/5) */}
          <div data-tour-id="admin-actions" className="xl:col-span-2 flex flex-col gap-4">
            {/* Manage */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Manage</p>
              <div className="grid grid-cols-3 gap-2">
                {MANAGE_ACTIONS.map((qa, i) => (
                  <button key={i} onClick={() => navigate(qa.path)}
                    className="card p-3 flex flex-col items-center gap-1.5 hover:shadow-md transition-all text-center">
                    <div className={`w-9 h-9 ${qa.color} rounded-xl flex items-center justify-center`}>
                      <qa.icon size={18} />
                    </div>
                    <p className="text-xs text-gray-600 font-medium leading-tight">{qa.label}</p>
                  </button>
                ))}
              </div>
            </div>
            {/* Review */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Review</p>
              <div className="grid grid-cols-3 gap-2">
                {REVIEW_ACTIONS.map((qa, i) => (
                  <button key={i} onClick={() => navigate(qa.path)}
                    className="card p-3 flex flex-col items-center gap-1.5 hover:shadow-md transition-all text-center">
                    <div className={`w-9 h-9 ${qa.color} rounded-xl flex items-center justify-center`}>
                      <qa.icon size={18} />
                    </div>
                    <p className="text-xs text-gray-600 font-medium leading-tight">{qa.label}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

        </div>

        {/* Replay-tour link. Unobtrusive footer placement so it's
            available when needed (onboarding new staff_admins, thesis
            demo) without crowding the daily-use surface. */}
        <div className="mt-8 pt-4 border-t border-gray-100 text-center">
          <button
            onClick={() => {
              resetTourFlag('admin-dashboard', user?.uid)
              // Force a refresh so <Tour> re-evaluates its localStorage
              // gate on mount. Simpler than wiring an external trigger.
              window.location.reload()
            }}
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
