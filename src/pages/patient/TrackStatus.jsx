import { useState, useEffect } from 'react'
import {
  MdTimeline, MdHistory, MdDownload, MdMailOutline,
  MdCalendarMonth, MdAssignment, MdCelebration, MdCheckCircle,
  MdInbox, MdCheck, MdWarning, MdChevronRight,
} from 'react-icons/md'
import Layout from '../../components/Layout'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, orderBy, onSnapshot, doc, getDoc, getDocs, updateDoc, serverTimestamp, runTransaction } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import { GL_VALIDITY_DAYS, REQUEST_STATUS_CONFIG, APP_STATUS_CONFIG } from '../../utils/constants'
import { computeFunding } from '../../utils/requests'
import GLDocumentPanel from '../../components/GLDocumentPanel'
import Tour from '../../components/Tour'
import { patientTrackStatusTour } from '../../utils/tours'
import { tsToDate } from '../../utils/dates'

const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`

// Request-lifecycle stepper for the patient's single co-funding request.
const buildRequestStages = (request, t) => {
  const DEFS = [
    { key: 'submitted',    label: t('patient.track.reqStages.submittedLabel'),    note: t('patient.track.reqStages.submittedNote') },
    { key: 'under_review', label: t('patient.track.reqStages.reviewLabel'),       note: t('patient.track.reqStages.reviewNote') },
    { key: 'assessment',   label: t('patient.track.reqStages.assessmentLabel'),   note: t('patient.track.reqStages.assessmentNote') },
    { key: 'endorsed',     label: t('patient.track.reqStages.endorsedLabel'),     note: t('patient.track.reqStages.endorsedNote') },
    { key: 'funded',       label: t('patient.track.reqStages.fundedLabel'),       note: t('patient.track.reqStages.fundedNote') },
    { key: 'completed',    label: t('patient.track.reqStages.completedLabel'),    note: t('patient.track.reqStages.completedNote') },
  ]
  const order = ['submitted', 'under_review', 'assessment', 'endorsed', 'funded', 'completed']
  const activeMap = {
    submitted: 'submitted', under_review: 'under_review', assessment: 'assessment',
    endorsed: 'endorsed', partially_funded: 'funded', fully_funded: 'completed', closed: 'completed',
  }
  const activeKey = activeMap[request.status] ?? 'submitted'
  const activeIdx = order.indexOf(activeKey)
  return DEFS.map((s, i) => {
    const active = i === activeIdx
    const done   = i < activeIdx
    // R14: per-row shortcuts. Stages where the patient has a real
    // destination (interview details, coverage plan) become tap targets so
    // they don't have to hunt for the right tab. Stages without a useful
    // destination stay informational — clicking a "Request Submitted" or
    // "CRMC Reviewing" row would land on a screen with nothing actionable.
    let path = null
    let cta  = null
    if (active && s.key === 'assessment') {
      path = '/patient/interviews'
      cta  = t('patient.track.reqStages.assessmentCta')
    } else if (active && s.key === 'endorsed') {
      path = '/patient/request'
      cta  = t('patient.track.reqStages.endorsedCta')
    }
    return { ...s, done, active, path, cta }
  })
}
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'

// ── Helpers ───────────────────────────────────────────────────────────────

// Badge colors come from APP_STATUS_CONFIG in utils/constants (shared
// across patient/agency/admin). Labels stay in i18n at patient.status.*
// because the patient-side wording is perspective-specific (e.g., "Needs
// Info" reads as "you need to give us info" for the patient, whereas the
// agency-side canonical label means the same thing from the agency's seat).
const badgeFor = (s) => APP_STATUS_CONFIG[s]?.badge ?? 'badge-gray'

const FALLBACK_COLOR = 'bg-gray-400'

const formatDate = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }) : null
}

// GL_VALIDITY_DAYS imported from utils/constants so the patient view
// shares the single source of truth that the agency-side enforces.
const glExpiryInfo = (app) => {
  if (app?.status !== 'certificate') return null
  const issued = app.approvedAt?.toDate?.() ?? null
  if (!issued) return null
  const expiresAt = new Date(issued.getTime() + GL_VALIDITY_DAYS * 86_400_000)
  const daysLeft  = Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000)
  return { expiresAt, daysLeft, expired: daysLeft < 0 }
}

// Build stages from application status. Takes `t` so the stage labels/notes
// come from the locale files (patient.track.stages.*) rather than being
// hardcoded English.
const buildStages = (app, t) => {
  // Co-funding slice (new model): CRMC owns intake, doc verification, and
  // the interview on the parent request, so a per-slice stepper that
  // shows "Document Verification" or "Interview Scheduled" is misleading.
  // Slices only cover the agency's funding leg: Endorsed → Funding Review
  // → Approved → GL Issued.
  if (app.requestId) {
    const SLICE_DEFS = [
      { key: 'endorsed',    label: t('patient.track.stages.endorsedLabel'),    note: t('patient.track.stages.endorsedNote') },
      { key: 'funding',     label: t('patient.track.stages.fundingLabel'),     note: t('patient.track.stages.fundingNote') },
      { key: 'approved',    label: t('patient.track.stages.approvedLabel'),    note: t('patient.track.stages.approvedNote') },
      { key: 'certificate', label: t('patient.track.stages.certificateLabel'), note: t('patient.track.stages.certificateNote') },
    ]
    const sliceDoneMap = {
      endorsed:      [],
      reviewing:     ['endorsed'],
      awaiting_info: ['endorsed'],
      approved:      ['endorsed', 'funding'],
      certificate:   ['endorsed', 'funding', 'approved'],
      rejected:      [],
    }
    const sliceActiveMap = {
      endorsed:      'endorsed',
      reviewing:     'funding',
      awaiting_info: 'funding',
      approved:      'approved',
      certificate:   'certificate',
      rejected:      null,
    }
    const doneKeys  = sliceDoneMap[app.status]  ?? []
    const activeKey = sliceActiveMap[app.status] ?? null
    return SLICE_DEFS.map(s => ({
      ...s,
      done:   doneKeys.includes(s.key),
      active: s.key === activeKey,
      date:   s.key === 'endorsed' ? formatDate(app.submittedAt) : null,
    }))
  }

  // Legacy direct-to-agency application (pre-redesign): the agency owned
  // verification + interview, so the full 6-stage stepper still applies.
  const STAGE_DEFS = [
    { key: 'submitted',   label: t('patient.track.stages.submittedLabel'),   note: t('patient.track.stages.submittedNote') },
    { key: 'docs',        label: t('patient.track.stages.docsLabel'),        note: t('patient.track.stages.docsNote') },
    { key: 'reviewing',   label: t('patient.track.stages.reviewingLabel'),   note: t('patient.track.stages.reviewingNote') },
    { key: 'interview',   label: t('patient.track.stages.interviewLabel'),   note: t('patient.track.stages.interviewNote') },
    { key: 'approved',    label: t('patient.track.stages.approvedLabel'),    note: t('patient.track.stages.approvedNote') },
    { key: 'certificate', label: t('patient.track.stages.certificateLabel'), note: t('patient.track.stages.certificateNote') },
  ]

  const doneMap = {
    pending:     ['submitted'],
    endorsed:    ['submitted', 'docs'],
    reviewing:   ['submitted', 'docs'],
    interview:   ['submitted', 'docs', 'reviewing'],
    approved:    ['submitted', 'docs', 'reviewing', 'interview'],
    certificate: ['submitted', 'docs', 'reviewing', 'interview', 'approved'],
    rejected:    ['submitted'],
  }

  const activeMap = {
    pending:     'docs',
    endorsed:    'reviewing',
    reviewing:   'reviewing',
    interview:   'interview',
    approved:    'approved',
    certificate: 'certificate',
    rejected:    null,
  }

  const doneKeys  = doneMap[app.status]  ?? ['submitted']
  const activeKey = activeMap[app.status] ?? null

  // Use stages stored on document if available, else build from status
  if (app.stages?.length) {
    return app.stages.map((s, i) => ({
      ...s,
      done:   doneKeys.includes(s.key),
      active: s.key === activeKey,
    }))
  }

  return STAGE_DEFS.map(s => ({
    ...s,
    done:   doneKeys.includes(s.key),
    active: s.key === activeKey,
    date:   s.key === 'submitted' ? formatDate(app.submittedAt) : null,
  }))
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function TrackStatus() {
  const { user }                        = useAuth()
  const navigate                        = useNavigate()
  const { t }                           = useTranslation()
  const [applications, setApplications] = useState([])
  const [requests,     setRequests]     = useState([])
  const [reqSlices,    setReqSlices]    = useState([])
  const [agencyMap,    setAgencyMap]    = useState({})
  const [loading,      setLoading]      = useState(true)
  const [tab,          setTab]          = useState('active')
  const [downloading,      setDownloading]      = useState(null)
  const [expandedApps,     setExpandedApps]     = useState(new Set())
  const [confirmWithdrawId, setConfirmWithdrawId] = useState(null)
  const [withdrawing,      setWithdrawing]      = useState(null)

  const handleWithdraw = async (app) => {
    setWithdrawing(app.id)
    try {
      // Mark as rejected with withdrawal reason
      await updateDoc(doc(db, 'applications', app.id), {
        status:          'rejected',
        rejectionReason: 'Withdrawn by applicant.',
        updatedAt:       serverTimestamp(),
        stages: (app.stages ?? []).map(s => ({
          ...s,
          done:   s.key === 'submitted',
          active: false,
        })),
      })

      // Restore slot if submitted today — wrapped in a transaction so a
      // simultaneous return (e.g., agency reject) on the same agency can't
      // silently lose one increment via lost-update.
      const submittedDate = app.submittedAt?.toDate?.()
      const isToday = submittedDate &&
        submittedDate.toDateString() === new Date().toDateString()
      if (isToday) {
        try {
          const agencyRef = doc(db, 'agencies', app.agencyId)
          await runTransaction(db, async (tx) => {
            const snap = await tx.get(agencyRef)
            if (!snap.exists()) return
            const current = snap.data()?.slots?.remaining ?? 0
            const total   = snap.data()?.slots?.total    ?? 0
            tx.update(agencyRef, { 'slots.remaining': Math.min(current + 1, total) })
          })
        } catch (err) {
          // Slot restore is best-effort — the withdrawal already committed.
          console.error('[TrackStatus] slot restore failed:', err)
        }
      }

      // Notify agency users
      const agencyUsers = await getDocs(query(
        collection(db, 'users'),
        where('agencyId', '==', app.agencyId),
        where('role', '==', 'agency')
      ))
      await Promise.all(agencyUsers.docs.map(d => notify(d.id, {
        type:  'app_withdrawn',
        title: 'Application withdrawn',
        body:  `${app.patientName} has withdrawn their application (${app.appId}).`,
      }))).catch(() => {})

      setConfirmWithdrawId(null)
      toast.success(t('patient.track.withdrawSuccess'))
    } catch (err) {
      console.error('Withdraw error:', err)
      toast.error(t('patient.track.withdrawFailed'))
    } finally {
      setWithdrawing(null)
    }
  }

  const toggleStages = (id) => setExpandedApps(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  useEffect(() => {
    if (!user) return
    const q = query(
      collection(db, 'applications'),
      where('patientId', '==', user.uid),
      orderBy('submittedAt', 'desc')
    )
    const unsub = onSnapshot(q,
      snap => {
        setApplications(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setLoading(false)
      },
      err => {
        console.error('TrackStatus query error:', err)
        setLoading(false)
      }
    )
    return unsub
  }, [user])

  // Co-funding requests — the patient's primary tracked item.
  useEffect(() => {
    if (!user) return
    const unsub = onSnapshot(
      query(collection(db, 'requests'), where('patientId', '==', user.uid)),
      snap => setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    )
    return unsub
  }, [user])

  const REQ_ACTIVE = (s) => !['closed', 'rejected', 'fully_funded'].includes(s)
  const activeRequest = requests.find(r => REQ_ACTIVE(r.status)) ?? null
  const pastRequests  = requests.filter(r => !REQ_ACTIVE(r.status))

  // Slices of the active request — the per-agency coverage breakdown.
  useEffect(() => {
    if (!activeRequest?.id) { setReqSlices([]); return }
    const unsub = onSnapshot(
      query(collection(db, 'applications'), where('requestId', '==', activeRequest.id)),
      snap => setReqSlices(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    )
    return unsub
  }, [activeRequest?.id])

  const activeApps = applications.filter(a =>
    !['rejected', 'certificate'].includes(a.status)
  )
  const pastApps = applications.filter(a =>
    ['rejected', 'certificate'].includes(a.status)
  )

  // Fetch agency color/initials for agencies not stored on the application doc
  useEffect(() => {
    const uniqueIds = [...new Set(applications.map(a => a.agencyId).filter(Boolean))]
    if (uniqueIds.length === 0) return
    Promise.all(uniqueIds.map(id => getDoc(doc(db, 'agencies', id))))
      .then(snaps => {
        const map = {}
        snaps.forEach(s => { if (s.exists()) map[s.id] = s.data() })
        setAgencyMap(map)
      })
  }, [applications])

  const agencyColor    = (app) =>
    app.agencyColor ?? agencyMap[app.agencyId]?.color ?? FALLBACK_COLOR

  const agencyInitials = (app) =>
    app.agencyInitials
    ?? agencyMap[app.agencyId]?.initials
    ?? app.agencyName?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    ?? '?'

  const handleDownloadCertificate = async (app) => {
    setDownloading(app.id)
    try {
      const snap = await getDoc(doc(db, 'certificates', app.id))
      if (!snap.exists()) { toast.error(t('patient.track.certNotReady')); return }
      // New uploads carry a downloadUrl (Cloud Storage); pre-Storage uploads
      // carry the file inline as a base64 data URL. Prefer the Storage URL.
      const data     = snap.data()
      const href     = data.downloadUrl ?? data.base64
      if (!href) { toast.error(t('patient.track.certNotReady')); return }
      const isPdf    = data.contentType === 'application/pdf'
        || (typeof data.base64 === 'string' && data.base64.startsWith('data:application/pdf'))
      const a = document.createElement('a')
      a.href     = href
      a.download = data.fileName ?? `guarantee-letter-${app.appId}.${isPdf ? 'pdf' : 'jpg'}`
      a.click()
    } catch (err) {
      console.error('[TrackStatus] download certificate failed:', err)
      toast.error(t('patient.track.downloadFailed'))
    } finally {
      setDownloading(null)
    }
  }

  return (
    <Layout breadcrumb={t('patient.track.title')}>
      {/* Hard viewport cap (max-w-[100vw]) + overflow-x-clip so long
          agency names, awaiting-info messages, or app IDs can't push
          the page wider than the phone screen. Restores max-w-2xl
          for centering on tablet+. */}
      <div className="px-3 py-4 sm:p-6 mx-auto w-full max-w-[100vw] sm:max-w-3xl overflow-x-clip">

        <div className="w-full min-w-0">

        <div className="mb-5">
          <h1 className="page-title">{t('patient.track.title')}</h1>
          <p className="page-sub">{t('patient.track.subtitle')}</p>
        </div>

        {/* Tabs — flex-wrap allows the second tab to drop to its own
            row if the active/past labels are long (Filipino is longer
            than English). */}
        <div data-tour-id="track-tabs" className="flex gap-2 mb-5 flex-wrap">
          <button
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'active' ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
            onClick={() => setTab('active')}>
            <MdTimeline size={16} /> {t('patient.track.tabInProgress')}
            {activeApps.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${tab === 'active' ? 'bg-white text-brand-600' : 'bg-brand-100 text-brand-600'}`}>
                {activeApps.length}
              </span>
            )}
          </button>
          <button
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'past' ? 'bg-brand-500 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
            onClick={() => setTab('past')}>
            <MdHistory size={16} /> {t('patient.track.tabPast')}
            {pastApps.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${tab === 'past' ? 'bg-white/20' : 'bg-brand-100 text-brand-600'}`}>
                {pastApps.length}
              </span>
            )}
          </button>
        </div>

        {/* Skeleton loading — sized to match the collapsed default view
            (header + status banner + 2 done/active timeline rows) so the
            layout doesn't shrink jarringly once data loads. */}
        {loading && (
          <div className="space-y-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="card p-5 animate-pulse">
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-50">
                  <div className="w-10 h-10 rounded-xl bg-gray-100 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-gray-100 rounded w-40" />
                    <div className="h-2.5 bg-gray-100 rounded w-56" />
                  </div>
                  <div className="h-5 bg-gray-100 rounded-full w-24" />
                </div>
                <div className="h-10 bg-gray-100 rounded-xl mb-4" />
                <div className="space-y-4">
                  {Array.from({ length: 2 }).map((_, j) => (
                    <div key={j} className="flex gap-3">
                      <div className="w-7 h-7 rounded-full bg-gray-100 flex-shrink-0" />
                      <div className="flex-1 space-y-1.5 pt-1">
                        <div className="h-3 bg-gray-100 rounded w-36" />
                        <div className="h-2.5 bg-gray-100 rounded w-48" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Active co-funding request ── */}
        {!loading && tab === 'active' && activeRequest && (() => {
          const cfg     = REQUEST_STATUS_CONFIG[activeRequest.status] ?? REQUEST_STATUS_CONFIG.submitted
          const stages  = buildRequestStages(activeRequest, t)
          const { committed, balance, pct } = computeFunding(activeRequest.amountNeeded, reqSlices)
          return (
            <div data-tour-id="track-request" className="card p-5 mb-5">
              <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-50">
                <div className="w-10 h-10 bg-brand-500 rounded-xl text-white flex items-center justify-center flex-shrink-0">
                  <MdAssignment size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-gray-800 truncate">{activeRequest.requestId}</h2>
                  <p className="text-sm text-gray-500 truncate">{activeRequest.assistanceType} · {peso(activeRequest.amountNeeded)}</p>
                </div>
                <span className={`badge ${cfg.badge} ml-auto flex-shrink-0`}>{cfg.label}</span>
              </div>

              {/* Lifecycle stepper */}
              <div className="space-y-1 mb-4">
                {stages.map((s, i) => {
                  const dot = (
                    <div className="flex flex-col items-center">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${s.done ? 'bg-green-500 text-white' : s.active ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
                        {s.done ? <MdCheck size={15} /> : <span className="text-xs font-semibold">{i + 1}</span>}
                      </div>
                      {i < stages.length - 1 && <div className={`w-0.5 flex-1 min-h-4 ${s.done ? 'bg-green-300' : 'bg-gray-100'}`} />}
                    </div>
                  )
                  const labelBlock = (
                    <div className="pb-1 min-w-0 flex-1">
                      <p className={`text-sm ${s.active ? 'font-semibold text-gray-900' : s.done ? 'text-gray-700' : 'text-gray-400'}`}>{s.label}</p>
                      {(s.active || s.done) && <p className="text-xs text-gray-400 leading-snug">{s.note}</p>}
                      {s.path && s.cta && (
                        <p className="text-xs font-medium text-brand-600 mt-1">{s.cta} →</p>
                      )}
                    </div>
                  )
                  if (s.path) {
                    return (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => navigate(s.path)}
                        className="w-full flex gap-3 items-start text-left rounded-lg -mx-2 px-2 py-2 min-h-[44px] hover:bg-brand-50/60 focus:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 transition-colors">
                        {dot}
                        {labelBlock}
                        <MdChevronRight size={20} className="text-brand-500 flex-shrink-0 self-center" aria-hidden="true" />
                      </button>
                    )
                  }
                  return (
                    <div key={s.key} className="flex gap-3 px-2 py-2">
                      {dot}
                      {labelBlock}
                    </div>
                  )
                })}
              </div>

              {/* Coverage */}
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>{peso(committed)} {t('patient.request.secured')}</span>
                  <span>{peso(balance)} {t('patient.request.remaining')}</span>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-green-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                {reqSlices.length > 0 && (
                  <div className="space-y-1.5 mt-3">
                    {reqSlices.map(s => {
                      const scfg    = APP_STATUS_CONFIG[s.status] ?? APP_STATUS_CONFIG.pending
                      const secured = ['approved', 'certificate'].includes(s.status)
                      const amt     = secured ? (s.amountApproved ?? s.amountRequested) : s.amountRequested
                      return (
                        <div key={s.id} className="flex items-center gap-2 text-xs">
                          <div className={`w-6 h-6 ${s.agencyColor ?? 'bg-gray-400'} rounded text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0`}>{s.agencyInitials}</div>
                          <span className="flex-1 min-w-0 truncate text-gray-600">{s.agencyName}</span>
                          <span className="text-gray-500">{peso(amt)}</span>
                          <span className={`badge text-xs flex-shrink-0 ${scfg.badge}`}>{scfg.label}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {reqSlices.some(s => s.status === 'endorsed') && (
                <button className="btn-primary w-full mt-4 text-sm" onClick={() => navigate('/patient/request')}>
                  {t('patient.track.reviewCoverage')} →
                </button>
              )}
            </div>
          )
        })()}

        {/* ── Active Applications ── */}
        {!loading && tab === 'active' && !activeRequest && (
          <>
            {activeApps.length === 0 ? (
              <div className="card p-10 text-center">
                <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <MdInbox size={28} className="text-gray-400" />
                </div>
                <p className="text-sm font-medium text-gray-600 mb-1">{t('patient.track.noActive')}</p>
                <p className="text-xs text-gray-400 mb-4">
                  {pastApps.length > 0
                    ? t('patient.track.hasPastApps')
                    : t('patient.track.neverApplied')}
                </p>
                {pastApps.length > 0 ? (
                  <button className="btn-secondary text-sm" onClick={() => setTab('past')}>
                    {t('patient.track.viewHistory')} →
                  </button>
                ) : (
                  <button className="btn-primary text-sm" onClick={() => navigate('/patient/request')}>
                    {t('patient.nav.requestAssistance')} →
                  </button>
                )}
              </div>
            ) : (
              <div data-tour-id="track-slices" className="space-y-5">
                {activeApps.map(app => {
                  const stages = buildStages(app, t)
                  const color    = agencyColor(app)
                  const initials = agencyInitials(app)

                  const isExpanded    = expandedApps.has(app.id)
                  const visibleStages = isExpanded
                    ? stages
                    : stages.filter(s => s.done || s.active)
                  const hiddenCount   = stages.filter(s => !s.done && !s.active).length

                  return (
                    <div key={app.id} className="card p-5">
                      {/* App header — min-w-0 on the middle text block
                          + truncate so a long agency name doesn't push
                          the badge off-screen. */}
                      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-50">
                        <div className={`w-10 h-10 ${color} rounded-xl text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}>
                          {initials}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h2 className="text-sm font-semibold text-gray-800 truncate">{app.agencyName}</h2>
                          <p className="text-sm text-gray-500 truncate">
                            {app.appId} · {t('patient.track.submittedOn', { date: formatDate(app.submittedAt) })}
                          </p>
                        </div>
                        <span className={`badge ${badgeFor(app.status)} ml-auto flex-shrink-0`}>
                          {t(`patient.status.${app.status}`, { defaultValue: app.status })}
                        </span>
                      </div>

                      {/* #7 — Agency disabled while this app is in flight.
                          Admin chose "hold" instead of "auto-reject", so
                          surface that to the patient — silence here would
                          leave them confused why their app sits forever. */}
                      {agencyMap[app.agencyId]?.enabled === false && (
                        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3">
                          <p className="text-sm text-amber-700 font-medium flex items-start gap-2">
                            <MdWarning size={16} className="flex-shrink-0 mt-0.5" />
                            <span>{t('patient.track.banner.agencyPaused', { agency: app.agencyName })}</span>
                          </p>
                        </div>
                      )}

                      {/* What to do next — shown FIRST before timeline */}
                      {app.status === 'pending' && (() => {
                        // #5a — Show "Waiting X days" once the app has been
                        // sitting > 2 days. Sets expectations; mirrors the
                        // SLA admins are working toward without making
                        // promises the system can't enforce.
                        const submittedMs = app.submittedAt?.toDate?.()?.getTime() ?? Date.now()
                        const days = Math.floor((Date.now() - submittedMs) / 86_400_000)
                        const showWaiting = days >= 3
                        return (
                          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-3">
                            <p className="text-sm text-blue-700 font-medium flex items-start gap-2">
                              <MdMailOutline size={16} className="flex-shrink-0 mt-0.5" />
                              <span className="flex-1">{t('patient.track.banner.pending')}</span>
                              {showWaiting && (
                                <span className="flex-shrink-0 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold whitespace-nowrap">
                                  {t('patient.track.waitingDays', { count: days })}
                                </span>
                              )}
                            </p>
                          </div>
                        )
                      })()}
                      {/* Endorsed (slice only): CRMC has sent this slice to
                          the agency and the patient needs to confirm on the
                          Request page before the agency review starts. */}
                      {app.requestId && app.status === 'endorsed' && (
                        <div className="mb-4 bg-purple-50 border border-purple-200 rounded-xl p-3 flex items-center justify-between gap-3">
                          <p className="text-sm text-purple-700 font-medium flex items-start gap-2 flex-1">
                            <MdAssignment size={16} className="flex-shrink-0 mt-0.5" />
                            <span>{t('patient.track.banner.endorsed')}</span>
                          </p>
                          <button
                            className="flex-shrink-0 inline-flex items-center min-h-[44px] text-sm bg-purple-500 hover:bg-purple-600 text-white px-4 rounded-lg font-medium transition-colors"
                            onClick={() => navigate('/patient/request')}>
                            {t('patient.track.banner.endorsedBtn')} →
                          </button>
                        </div>
                      )}
                      {app.status === 'interview' && (
                        <div className="mb-4 bg-purple-50 border border-purple-200 rounded-xl p-3 flex items-center justify-between gap-3">
                          <p className="text-sm text-purple-700 font-medium flex items-start gap-2 flex-1">
                            <MdCalendarMonth size={16} className="flex-shrink-0 mt-0.5" />
                            <span>{t('patient.track.banner.interview')}</span>
                          </p>
                          <button
                            className="flex-shrink-0 inline-flex items-center min-h-[44px] text-sm bg-purple-500 hover:bg-purple-600 text-white px-4 rounded-lg font-medium transition-colors"
                            onClick={() => navigate('/patient/interviews')}>
                            {t('patient.track.banner.interviewBtn')} →
                          </button>
                        </div>
                      )}
                      {app.status === 'reviewing' && (
                        app.requestId ? (
                          // Slice: agency is reviewing funding, patient has nothing to do.
                          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3">
                            <p className="text-sm text-amber-700 font-medium flex items-start gap-2">
                              <MdAssignment size={16} className="flex-shrink-0 mt-0.5" />
                              <span>{t('patient.track.banner.fundingReview')}</span>
                            </p>
                          </div>
                        ) : (
                          // Legacy direct-to-agency app: agency review may need docs.
                          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between gap-3">
                            <p className="text-sm text-amber-700 font-medium flex items-start gap-2 flex-1">
                              <MdAssignment size={16} className="flex-shrink-0 mt-0.5" />
                              <span>{t('patient.track.banner.reviewing')}</span>
                            </p>
                            <button
                              className="flex-shrink-0 inline-flex items-center min-h-[44px] text-sm bg-amber-500 hover:bg-amber-600 text-white px-4 rounded-lg font-medium transition-colors"
                              onClick={() => navigate('/patient/request')}>
                              {t('patient.track.banner.reviewingBtn')} →
                            </button>
                          </div>
                        )
                      )}
                      {/* Awaiting info (slice only): agency asked the patient
                          for more info; surface as actionable. */}
                      {app.requestId && app.status === 'awaiting_info' && (
                        <div className="mb-4 bg-orange-50 border border-orange-200 rounded-xl p-3 flex items-center justify-between gap-3">
                          <p className="text-sm text-orange-700 font-medium flex items-start gap-2 flex-1">
                            <MdWarning size={16} className="flex-shrink-0 mt-0.5" />
                            <span>{t('patient.track.banner.awaitingInfo')}</span>
                          </p>
                          <button
                            className="flex-shrink-0 inline-flex items-center min-h-[44px] text-sm bg-orange-500 hover:bg-orange-600 text-white px-4 rounded-lg font-medium transition-colors"
                            onClick={() => navigate('/patient/request')}>
                            {t('patient.track.banner.awaitingInfoBtn')} →
                          </button>
                        </div>
                      )}
                      {(app.status === 'approved' || app.status === 'certificate') && app.approvedAmount != null && (() => {
                        // #6 — Patient-side GL expiry visibility. The agency
                        // already enforces a 30-day window; without surfacing
                        // it here, the patient finds out at the provider
                        // counter that their GL is expired. Show:
                        // - red "Expired on X" when past validity
                        // - amber "Expires in N days" when ≤ 7 days remain
                        const expiry = glExpiryInfo(app)
                        return (
                        <div className={`mb-4 rounded-xl p-3 border ${expiry?.expired ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                          <p className={`text-sm font-medium mb-2 flex items-start gap-2 ${expiry?.expired ? 'text-red-700' : 'text-green-700'}`}>
                            {app.status === 'certificate' && app.certificateUploaded
                              ? <><MdCelebration size={16} className="flex-shrink-0 mt-0.5" /><span>{t('patient.track.banner.certReady')}</span></>
                              : app.status === 'certificate'
                                ? <><MdAssignment size={16} className="flex-shrink-0 mt-0.5" /><span>{t('patient.track.banner.certPreparing')}</span></>
                                : <><MdCheckCircle size={16} className="flex-shrink-0 mt-0.5" /><span>{t('patient.track.banner.approvedPreparing')}</span></>}
                          </p>
                          {expiry?.expired && (
                            <div className="mb-2 -mt-1 text-xs text-red-700 bg-white/60 border border-red-200 rounded-lg px-2.5 py-1.5">
                              <strong>{t('patient.track.expiry.expiredOn', { date: formatDate(expiry.expiresAt) })}</strong>
                              <p className="mt-0.5 text-red-600 leading-relaxed">{t('patient.track.expiry.expiredDesc')}</p>
                            </div>
                          )}
                          {!expiry?.expired && expiry?.daysLeft != null && expiry.daysLeft <= 7 && (
                            <div className="mb-2 -mt-1 text-xs text-amber-700 bg-white/60 border border-amber-200 rounded-lg px-2.5 py-1.5">
                              <strong>{t('patient.track.expiry.expiresIn', { count: expiry.daysLeft })}</strong>
                              <p className="mt-0.5 text-amber-600 leading-relaxed">{t('patient.track.expiry.expiresDesc')}</p>
                            </div>
                          )}
                          {/* Amount dominates — full-width hero on top, supporting
                              metadata as smaller cards below. The approved peso
                              figure is the headline of the patient's journey. */}
                          <div className="bg-white/70 rounded-lg px-4 py-3 mb-2">
                            <p className="text-xs text-green-600 uppercase tracking-wide">{t('patient.track.approval.amountLabel')}</p>
                            <p className="text-2xl sm:text-3xl font-bold text-green-700 leading-tight">
                              ₱{Number(app.approvedAmount).toLocaleString()}
                            </p>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {app.purposeOfAssistance?.length > 0 && (
                              <div className="bg-white/60 rounded-lg px-3 py-2">
                                <p className="text-xs text-green-600 uppercase tracking-wide">{t('patient.track.approval.forLabel')}</p>
                                <p className="text-sm font-medium text-green-700">{app.purposeOfAssistance.join(', ')}</p>
                              </div>
                            )}
                            {app.payableTo && (
                              <div className={`bg-white/60 rounded-lg px-3 py-2 ${app.purposeOfAssistance?.length > 0 ? '' : 'sm:col-span-2'}`}>
                                <p className="text-xs text-green-600 uppercase tracking-wide">{t('patient.track.approval.payableLabel')}</p>
                                <p className="text-sm font-medium text-green-700">{app.payableTo}</p>
                                <p className="text-xs text-green-500 mt-1">{t('patient.track.approval.payableHint')}</p>
                              </div>
                            )}
                          </div>
                        </div>
                        )
                      })()}
                      {app.status === 'approved' && app.approvedAmount == null && (
                        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-3">
                          <p className="text-sm text-green-700 font-medium flex items-start gap-2">
                            <MdCheckCircle size={16} className="flex-shrink-0 mt-0.5" />
                            <span>{t('patient.track.banner.approvedNoAmount')}</span>
                          </p>
                        </div>
                      )}

                      {/* GL document panel */}
                      {(app.status === 'approved' || app.status === 'certificate') && app.approvedAmount != null && (
                        <div className="mb-4">
                          <GLDocumentPanel app={app} compact />
                        </div>
                      )}

                      {/* Timeline — completed + current only by default */}
                      <div className="space-y-0">
                        {visibleStages.map((stage, i) => (
                          <div key={stage.key} className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <div className={`flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold z-10
                                ${stage.done
                                  ? 'bg-brand-500 border-brand-500 text-white'
                                  : stage.active
                                  ? 'border-brand-500 bg-brand-50 text-brand-600'
                                  : 'border-gray-200 bg-white text-gray-300'}`}>
                                {stage.done ? <MdCheck size={14} /> : i + 1}
                              </div>
                              {i < visibleStages.length - 1 && (
                                <div className={`w-0.5 flex-1 my-1 ${stage.done ? 'bg-brand-300' : 'bg-gray-100'}`}
                                  style={{ minHeight: '28px' }} />
                              )}
                            </div>
                            <div className={`flex-1 pb-5 ${i === visibleStages.length - 1 ? 'pb-0' : ''}`}>
                              <div className="flex items-start justify-between">
                                <p className={`text-sm font-medium ${stage.done ? 'text-gray-800' : stage.active ? 'text-brand-700' : 'text-gray-400'}`}>
                                  {stage.label}
                                  {stage.active && <span className="ml-2 badge badge-blue text-xs">{t('patient.track.timeline.current')}</span>}
                                </p>
                                {stage.date && <span className="text-xs text-gray-400">{stage.date}</span>}
                              </div>
                              <p className={`text-sm mt-0.5 ${stage.done || stage.active ? 'text-gray-500' : 'text-gray-300'}`}>
                                {stage.note}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Expand / collapse future stages */}
                      {hiddenCount > 0 && (
                        <button
                          className="mt-3 inline-flex items-center min-h-[44px] text-sm text-brand-500 hover:text-brand-600 font-medium border border-brand-200 bg-brand-50 hover:bg-brand-100 px-4 rounded-lg transition-colors"
                          onClick={() => toggleStages(app.id)}>
                          {isExpanded
                            ? `${t('patient.track.timeline.hideFuture')} ↑`
                            : `${t('patient.track.timeline.seeAll', { count: hiddenCount })} ↓`}
                        </button>
                      )}

                      {/* Withdraw — only when pending and agency hasn't started reviewing */}
                      {app.status === 'pending' && (
                        <div className="mt-4 pt-3 border-t border-gray-50">
                          {confirmWithdrawId === app.id ? (
                            <div className="space-y-2.5">
                              <p className="text-sm text-gray-600">
                                {t('patient.track.withdrawConfirm')}
                              </p>
                              <div className="flex gap-2">
                                <button
                                  className="flex-1 min-h-[44px] text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2.5 rounded-lg font-medium transition-colors"
                                  onClick={() => setConfirmWithdrawId(null)}>
                                  {t('patient.track.cancel')}
                                </button>
                                <button
                                  className="flex-1 min-h-[44px] text-sm bg-red-500 hover:bg-red-600 text-white px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-60"
                                  onClick={() => handleWithdraw(app)}
                                  disabled={withdrawing === app.id}>
                                  {withdrawing === app.id ? t('patient.track.withdrawing') : t('patient.track.withdrawYes')}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              className="min-h-[44px] py-2 text-sm text-gray-400 hover:text-red-500 transition-colors"
                              onClick={() => setConfirmWithdrawId(app.id)}>
                              {t('patient.track.withdraw')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ── Past Applications ── */}
        {!loading && tab === 'past' && (
          <div className="space-y-3">
            {pastApps.length === 0 ? (
              <div className="card p-8 text-center">
                <p className="text-sm text-gray-400">{t('patient.track.noPast')}</p>
                <p className="text-xs text-gray-400 mt-1">{t('patient.track.noPastSub')}</p>
                <button className="btn-primary mt-3 text-sm" onClick={() => navigate('/patient/request')}>
                  {t('patient.nav.requestAssistance')} →
                </button>
              </div>
            ) : (
              pastApps.map(app => (
                <div key={app.id} className="card p-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className={`w-9 h-9 ${agencyColor(app)} rounded-xl text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}>
                      {agencyInitials(app)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{app.agencyName}</p>
                      <p className="text-sm text-gray-500 truncate">{app.appId} · {t('patient.track.submittedOn', { date: formatDate(app.submittedAt) })}</p>
                    </div>
                    <span className={`badge ${badgeFor(app.status)}`}>
                      {t(`patient.status.${app.status}`, { defaultValue: app.status })}
                    </span>
                    {app.certificateUploaded ? (
                      <button
                        className="flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-white font-semibold transition-colors disabled:opacity-60 shadow-sm"
                        onClick={() => handleDownloadCertificate(app)}
                        disabled={downloading === app.id}>
                        <MdDownload size={15} />
                        {downloading === app.id ? t('patient.track.downloading') : t('patient.track.downloadGL')}
                      </button>
                    ) : app.status === 'certificate' ? (
                      // R12 (2026-06-03): when the slice is at 'certificate'
                      // but the agency hasn't uploaded the wet-signed scan
                      // yet, the Download GL button is intentionally absent.
                      // Without this hint the patient sees an empty space
                      // next to a green 'Issued' badge and reports
                      // 'where?' (real field report from the demo patient
                      // 2026-06-03). Inline pill makes the wait visible.
                      <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md whitespace-nowrap">
                        {t('patient.track.awaitingScan')}
                      </span>
                    ) : null}
                  </div>
                  {app.status === 'rejected' && app.rejectionReason && (
                    <div className="mt-3 bg-red-50 border border-red-100 rounded-xl p-3">
                      <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">
                        {t('patient.track.reasonForRejection')}
                      </p>
                      <p className="text-sm text-red-700 leading-relaxed">{app.rejectionReason}</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        </div> {/* end inner content wrapper */}
      </div>

      {/* First-visit guided tour. Auto-fires once per uid; spotlights
          the active/past tabs, the request lifecycle stepper, and the
          per-agency slice cards (latter falls back to centered when
          the request hasn't been endorsed yet). */}
      <Tour steps={patientTrackStatusTour(t)} storageKey="patient-track" />
    </Layout>
  )
}
