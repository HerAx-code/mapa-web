import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  MdUpload, MdCheckCircle, MdPending,
  MdArrowForward, MdExpandMore, MdExpandLess,
  MdHourglassEmpty, MdAssignment, MdSchedule, MdVideoCall,
  MdReceipt, MdCancel, MdLocalHospital, MdCalendarMonth, MdAccessTime,
  MdOpenInNew, MdCheck, MdClose, MdMenuBook, MdChatBubbleOutline,
} from 'react-icons/md'
import Layout from '../../components/Layout'
import BalanceHero from '../../components/patient/BalanceHero'
import JourneyStrip from '../../components/patient/JourneyStrip'
import StatusHero from '../../components/patient/StatusHero'
import InstallPrompt from '../../components/InstallPrompt'
import StatusBadge from '../../components/ui/StatusBadge'
import Tour from '../../components/Tour'
import { patientDashboardTour } from '../../utils/tours'
import { tsToDate } from '../../utils/dates'
import { useAuth } from '../../contexts/AuthContext'
import {
  collection, query, where, orderBy, onSnapshot,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { REQUEST_STATUS_CONFIG, isGLExpired } from '../../utils/constants'
import { isSliceTerminal, computeFunding } from '../../utils/requests'
import AnnouncementFeedCard from '../../components/AnnouncementFeedCard'
import { useFeedAnnouncements } from '../../utils/announcements'

// ── Plain-language status config ──────────────────────────────────────────

// Icon + color choices per application status. Translatable strings
// (label/desc/btn) live in the i18n locale files under
// patient.dashboard.statusCard.<status> — read via t() at render time so
// the dashboard supports Filipino + English without code changes.
const STATUS_VISUAL = {
  pending: {
    icon:     MdHourglassEmpty,
    iconBg:   'bg-blue-100 text-blue-600',
    path:     '/patient/status',
    border:   'border-blue-300',
    bg:       'bg-blue-50',
    text:     'text-blue-800',
    subtext:  'text-blue-600',
    btnClass: 'bg-blue-500 hover:bg-blue-600 text-white',
  },
  // R19: endorsed / reviewing / awaiting_info CTAs now point at the
  // patient's Status page, not the new-request wizard. The previous
  // /patient/request target relied on RequestAssistance detecting an
  // active request and rendering its proceed view -- the detection
  // failed when the parent-request lookup didn't match (test data,
  // legacy slices, parent in terminal state) and patients landed on
  // Step 1 of the new-request wizard with no obvious way back.
  // /patient/status is now self-contained for the proceed action
  // (see R16 inline handler) and surfaces awaiting_info messages too.
  endorsed: {
    icon:     MdReceipt,
    iconBg:   'bg-purple-100 text-purple-600',
    path:     '/patient/status',
    border:   'border-purple-300',
    bg:       'bg-purple-50',
    text:     'text-purple-800',
    subtext:  'text-purple-600',
    btnClass: 'bg-purple-500 hover:bg-purple-600 text-white',
  },
  reviewing: {
    icon:     MdAssignment,
    iconBg:   'bg-amber-100 text-amber-600',
    path:     '/patient/status',
    border:   'border-amber-300',
    bg:       'bg-amber-50',
    text:     'text-amber-800',
    subtext:  'text-amber-600',
    btnClass: 'bg-amber-500 hover:bg-amber-600 text-white',
  },
  awaiting_info: {
    icon:     MdSchedule,
    iconBg:   'bg-orange-100 text-orange-600',
    path:     '/patient/status',
    border:   'border-orange-300',
    bg:       'bg-orange-50',
    text:     'text-orange-800',
    subtext:  'text-orange-700',
    btnClass: 'bg-orange-500 hover:bg-orange-600 text-white',
  },
  interview: {
    icon:     MdVideoCall,
    iconBg:   'bg-purple-100 text-purple-600',
    path:     '/patient/interviews',
    border:   'border-purple-300',
    bg:       'bg-purple-50',
    text:     'text-purple-800',
    subtext:  'text-purple-600',
    btnClass: 'bg-purple-500 hover:bg-purple-600 text-white',
  },
  approved: {
    icon:     MdCheckCircle,
    iconBg:   'bg-green-100 text-green-600',
    path:     '/patient/status',
    border:   'border-green-300',
    bg:       'bg-green-50',
    text:     'text-green-800',
    subtext:  'text-green-600',
    btnClass: 'bg-green-500 hover:bg-green-600 text-white',
  },
  certificate: {
    icon:     MdReceipt,
    iconBg:   'bg-green-100 text-green-600',
    path:     '/patient/status',
    border:   'border-green-300',
    bg:       'bg-green-50',
    text:     'text-green-800',
    subtext:  'text-green-600',
    btnClass: 'bg-green-500 hover:bg-green-600 text-white',
  },
}

const formatDate = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }) : '—'
}

// Local peso formatter — matches the per-page pattern used across the app
// (RequestAssistance, TrackStatus, admin/Requests all define their own).
const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`

// Short "when" for the messages preview.
const formatWhen = (ts) => {
  const d = tsToDate(ts)
  if (!d) return ''
  const diff = Date.now() - d.getTime()
  const hrs  = Math.floor(diff / 3_600_000)
  if (hrs < 1)  return 'now'
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ── Coverage / balance breakdown ────────────────────────────────────────────
// Wholly derived from the request doc (totalBill / philhealthCovered /
// otherCovered / amountNeeded + the server-derived amountCommitted) — no extra
// query, no touch to the funding path. Surfaces the PhilHealth-first model:
// bill → PhilHealth first charge → residual the agencies co-fund → approved →
// remaining. Legacy requests with no totalBill fall back to amountNeeded.
function CoverageCard({ request, t }) {
  const bill     = Number(request.totalBill ?? request.amountNeeded) || 0
  const ph       = Number(request.philhealthCovered) || 0
  const other    = Number(request.otherCovered) || 0
  const needed   = Number(request.amountNeeded) || 0
  const approved = Number(request.amountCommitted) || 0
  const balance  = Math.max(0, needed - approved)
  const pct      = needed > 0 ? Math.min(100, Math.round((approved / needed) * 100)) : 0
  if (needed <= 0 && bill <= 0) return null

  const rows = [
    { label: t('patient.dashboard.coverage.bill'), value: peso(bill) },
    ...(ph > 0    ? [{ label: t('patient.dashboard.coverage.philhealth'), value: `− ${peso(ph)}`,    muted: true }] : []),
    ...(other > 0 ? [{ label: t('patient.dashboard.coverage.other'),      value: `− ${peso(other)}`, muted: true }] : []),
    { label: t('patient.dashboard.coverage.needed'), value: peso(needed), strong: true },
  ]

  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">{t('patient.dashboard.coverage.title')}</h3>
      <dl className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className={`flex items-center justify-between text-sm ${r.strong ? 'pt-2 mt-1 border-t border-gray-100' : ''}`}>
            <dt className={r.muted ? 'text-gray-500' : r.strong ? 'font-semibold text-gray-800' : 'text-gray-600'}>{r.label}</dt>
            <dd className={`tabular-nums ${r.muted ? 'text-brand-600' : r.strong ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>{r.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4">
        <div className="flex items-baseline justify-between text-sm mb-1.5">
          <span className="text-gray-600">{t('patient.dashboard.coverage.approved')}</span>
          <span className="font-semibold text-gray-900 tabular-nums">{peso(approved)} <span className="text-gray-500 font-normal">/ {peso(needed)}</span></span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-gray-500">{t('patient.dashboard.coverage.funded', { pct })}</span>
          <span className="text-sm font-semibold text-gray-800">
            {t('patient.dashboard.coverage.remaining')}: <span className="tabular-nums">{peso(balance)}</span>
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Application timeline ─────────────────────────────────────────────────────
// A real event timeline driven by the request's own lifecycle rank, with dates
// where they exist. Degrades gracefully: future steps read "upcoming".
const REQ_RANK = { submitted: 0, under_review: 1, assessment: 2, endorsed: 3, partially_funded: 4, fully_funded: 5 }
function TimelineCard({ request, docStats, t }) {
  const rank = REQ_RANK[request.status] ?? 0
  const interviewWhen = request.interviewDate
    ? `${new Date(`${request.interviewDate}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}${request.interviewTime ? ` · ${request.interviewTime}` : ''}`
    : t('patient.dashboard.timeline.s3metaTBD')

  const steps = [
    { entry: 0, label: t('patient.dashboard.timeline.s1'), meta: formatDate(request.submittedAt) },
    { entry: 1, label: t('patient.dashboard.timeline.s2'), meta: rank > 1 ? t('patient.dashboard.timeline.s2metaDone', { verified: docStats.verified }) : t('patient.dashboard.timeline.s2metaReviewing') },
    { entry: 2, label: t('patient.dashboard.timeline.s3'), meta: interviewWhen },
    { entry: 3, label: t('patient.dashboard.timeline.s4'), meta: t('patient.dashboard.timeline.s4meta') },
    { entry: 4, label: t('patient.dashboard.timeline.s5'), meta: rank >= 5 ? t('patient.dashboard.timeline.s5metaDone') : t('patient.dashboard.timeline.s5metaAfter') },
  ]
  const doneCount = steps.filter(s => rank > s.entry).length

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-800">{t('patient.dashboard.timeline.title')}</h3>
        <span className="text-xs text-gray-500">{t('patient.dashboard.timeline.completedOf', { done: doneCount, total: steps.length })}</span>
      </div>
      <ol>
        {steps.map((s, i) => {
          const status = rank > s.entry ? 'done' : rank === s.entry ? 'current' : 'upcoming'
          const isLast = i === steps.length - 1
          return (
            <li key={i} className="relative flex gap-3 pb-5 last:pb-0">
              {!isLast && (
                <span aria-hidden="true"
                  className={`absolute left-[13px] top-7 bottom-0 w-px ${status === 'done' ? 'bg-brand-300' : 'bg-gray-200'}`} />
              )}
              <span aria-hidden="true"
                className={`relative z-10 mt-0.5 flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  status === 'done'    ? 'bg-brand-500 text-white'
                  : status === 'current' ? 'bg-white text-brand-600 ring-2 ring-brand-500'
                  : 'bg-white text-gray-500 ring-1 ring-gray-200'
                }`}>
                {status === 'done' ? <MdCheck size={15} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`text-sm ${status === 'upcoming' ? 'font-medium text-gray-500' : 'font-semibold text-gray-800'}`}>{s.label}</p>
                  {status === 'current' && (
                    <span className="badge badge-blue text-xs">{t('patient.dashboard.timeline.current')}</span>
                  )}
                </div>
                <p className={`text-xs mt-0.5 ${status === 'upcoming' ? 'text-gray-500' : 'text-gray-500'}`}>{s.meta}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ── Itemized documents ──────────────────────────────────────────────────────
function DocumentsList({ docs, t, navigate }) {
  const verified = docs.filter(d => d.status === 'verified').length
  const meta = {
    verified: { icon: MdCheckCircle, cls: 'text-green-600', bg: 'bg-green-50', label: t('patient.dashboard.docsCard.verified') },
    pending:  { icon: MdPending,     cls: 'text-amber-600', bg: 'bg-amber-50', label: t('patient.dashboard.docsCard.pending')  },
    rejected: { icon: MdCancel,      cls: 'text-red-500',   bg: 'bg-red-50',   label: t('patient.dashboard.docsCard.rejected') },
  }
  return (
    <div className="card overflow-hidden">
      <div className="flex items-baseline justify-between px-4 pt-4">
        <h3 className="text-sm font-semibold text-gray-800">{t('patient.dashboard.docsCard.title')}</h3>
        <span className="text-xs text-gray-500 tabular-nums">{verified}/{docs.length}</span>
      </div>
      <ul className="mt-2 divide-y divide-gray-50">
        {docs.map(d => {
          const m = meta[d.status] ?? meta.pending
          const Icon = m.icon
          return (
            <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${m.bg} ${m.cls}`}>
                <Icon size={14} />
              </span>
              <span className="flex-1 min-w-0 text-sm text-gray-800 truncate">{d.documentTypeName ?? d.name ?? 'Document'}</span>
              <span className={`text-xs flex-shrink-0 font-medium ${m.cls}`}>{m.label}</span>
            </li>
          )
        })}
      </ul>
      <button onClick={() => navigate('/patient/request')}
        className="w-full border-t border-gray-100 px-4 py-2.5 text-left text-sm font-medium text-brand-600 hover:bg-gray-50 flex items-center gap-1.5 transition-colors">
        <MdUpload size={16} /> {t('patient.dashboard.docsCard.manage')}
      </button>
    </div>
  )
}

// ── Messages preview ────────────────────────────────────────────────────────
function MessagesPreview({ convos, uid, t, navigate }) {
  if (!convos.length) return null
  return (
    <div className="card overflow-hidden">
      <div className="flex items-baseline justify-between px-4 pt-4">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
          <MdChatBubbleOutline size={15} className="text-gray-500" /> {t('patient.dashboard.messagesCard.title')}
        </h3>
        <button onClick={() => navigate('/patient/messages')}
          className="text-sm font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1">
          {t('patient.dashboard.messagesCard.viewAll')} <MdArrowForward size={14} />
        </button>
      </div>
      <ul className="mt-2 divide-y divide-gray-50">
        {convos.slice(0, 3).map(c => {
          const otherUid = (c.participants ?? []).find(p => p !== uid)
          const sender   = c.names?.[otherUid] ?? 'CRMC'
          const unread   = (c.unread?.[uid] ?? 0) > 0
          return (
            <li key={c.id}>
              <button onClick={() => navigate('/patient/messages')}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-2">
                  {unread && <span className="w-2 h-2 rounded-full bg-brand-500 flex-shrink-0" aria-hidden="true" />}
                  <span className={`text-sm truncate ${unread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>{sender}</span>
                  <span className="ml-auto text-xs text-gray-500 flex-shrink-0">{formatWhen(c.lastAt)}</span>
                </div>
                <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{c.lastMessage || '—'}</p>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// BalanceHero lives in components/patient/BalanceHero.jsx — shared with
// TrackStatus so both surfaces read as one flow. Imported at the top.

// ── Next-action card ─────────────────────────────────────────────────────────
// Surfaces the single most pressing real action (fix a rejected doc / respond
// to an agency / join a scheduled interview). Renders nothing when the ball is
// in CRMC's court.
function NextActionCard({ action }) {
  const Icon = action.icon
  return (
    <button onClick={action.onClick}
      className="w-full text-left rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5 flex items-start gap-3 hover:bg-amber-100/60 transition-colors">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-amber-600 border border-amber-200">
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">{action.eyebrow}</p>
        <p className="text-sm font-semibold text-gray-900 mt-0.5">{action.title}</p>
        {action.detail && <p className="text-xs text-gray-500 mt-0.5">{action.detail}</p>}
      </div>
      <span className="text-sm font-semibold text-amber-700 flex-shrink-0 self-center">{action.cta} →</span>
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function PatientDashboard() {
  const navigate  = useNavigate()
  const { user }  = useAuth()
  const { t }     = useTranslation()
  // Strip trailing punctuation in case the name is stored last-first
  // (e.g. "De La Cruz, Juan" → splitting on space gives "De,"; we strip
  // the comma so the greeting reads naturally). Also title-case it so
  // patients who registered with all-lowercase names (common on mobile)
  // don't see "Welcome back, sod" — the display layer normalizes for
  // presentation while storage keeps the original casing for records.
  const firstName = (() => {
    const raw = (user?.name?.split(' ')[0] || '').replace(/[,;]+$/, '')
    if (!raw) return 'Patient'
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
  })()

  // R38: dashboard "What's new" feed — CRMC notices opted into 'feed'
  // or 'both', plus all active agency promotions (targetRoles includes
  // 'patient'). The hook handles the source-aware default in
  // computeTargetRoles so agency promos surface here even on legacy
  // docs that pre-date the targetRoles field.
  const feedAnnouncements = useFeedAnnouncements({
    role: user?.role, agencyId: user?.agencyId, uid: user?.uid,
  })

  const [activeApp,  setActiveApp]  = useState(null)
  const [apps,       setApps]       = useState([])
  const [activeRequest, setActiveRequest] = useState(null)
  const [appCount,   setAppCount]   = useState(0)
  const [docStats,   setDocStats]   = useState({ verified: 0, pending: 0 })
  const [docList,    setDocList]    = useState([])
  const [convos,     setConvos]     = useState([])
  const [loading,    setLoading]    = useState(true)
  const [docLoading, setDocLoading] = useState(true)
  // Default the steps guide OPEN for new patients (no application yet) —
  // they need the orientation most. Returning patients with an active
  // application can collapse it themselves.
  const [stepsOpen,  setStepsOpen]  = useState(null)
  // Welcome hero is great onboarding for first-time visitors but turns
  // into noise on every subsequent visit. Per-device localStorage flag
  // (keyed by uid so multiple accounts on the same phone get fresh
  // welcomes). Reuploads/cache clears resurface it — acceptable for a
  // hero that's just educational.
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)
  useEffect(() => {
    if (!user?.uid) return
    // localStorage access can throw when storage is blocked — treat any
    // failure as "not dismissed" rather than crashing the dashboard on mount.
    try {
      setWelcomeDismissed(localStorage.getItem(`mapa_welcome_dismissed_${user.uid}`) === '1')
    } catch { setWelcomeDismissed(false) }
  }, [user?.uid])
  const dismissWelcome = () => {
    try {
      if (user?.uid) localStorage.setItem(`mapa_welcome_dismissed_${user.uid}`, '1')
    } catch { /* storage blocked — dismissal is in-memory only this session */ }
    setWelcomeDismissed(true)
  }

  // Most recent non-rejected application (real-time)
  useEffect(() => {
    if (!user?.uid) return
    const q = query(
      collection(db, 'applications'),
      where('patientId', '==', user.uid),
      orderBy('submittedAt', 'desc'),
    )
    const unsub = onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setApps(all)
      setAppCount(all.length)
      // R18: a redeemed or lapsed certificate slice is NOT active; without
      // this filter the Dashboard kept showing "Your application is in
      // progress" for slices the patient already claimed weeks ago.
      setActiveApp(all.find(a => !isSliceTerminal(a, { isGLExpired })) ?? null)
      setLoading(false)
    }, (err) => {
      setLoading(false)
      console.error('[PatientDashboard] applications snapshot error:', err)
    })
    return unsub
  }, [user?.uid])

  // Active co-funding request — the patient's primary tracked item.
  useEffect(() => {
    if (!user?.uid) return
    const unsub = onSnapshot(
      query(collection(db, 'requests'), where('patientId', '==', user.uid)),
      snap => {
        const reqs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setActiveRequest(reqs.find(r => !['closed', 'rejected', 'fully_funded'].includes(r.status)) ?? null)
      },
      (err) => console.error('[PatientDashboard] requests snapshot error:', err),
    )
    return unsub
  }, [user?.uid])

  // Interview reminders are handled entirely server-side by the
  // `interviewReminders` Cloud Function (scheduled; fires 24h + 1h before,
  // in-app + email). The old client-side sweep that used to live here was
  // removed: it duplicated those reminders (patients could get each one
  // twice) and one of its queries tripped a Firestore rules denial that
  // surfaced as a console error on the patient dashboard.

  // Live document stats so the verified/pending counts update the moment
  // CRMC verifies or rejects a doc -- no reload required.
  useEffect(() => {
    if (!user?.uid) return
    const unsub = onSnapshot(
      query(collection(db, 'documents'), where('patientId', '==', user.uid)),
      snap => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setDocList(all)
        setDocStats({
          verified: all.filter(d => d.status === 'verified').length,
          pending:  all.filter(d => d.status === 'pending').length,
        })
        setDocLoading(false)
      },
      (err) => {
        setDocLoading(false)
        console.error('[PatientDashboard] documents snapshot error:', err)
      },
    )
    return unsub
  }, [user?.uid])

  // Conversations for the dashboard messages preview. Sorted client-side by
  // lastAt so no composite index is needed (single array-contains filter).
  useEffect(() => {
    if (!user?.uid) return
    const unsub = onSnapshot(
      query(collection(db, 'conversations'), where('participants', 'array-contains', user.uid)),
      snap => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        all.sort((a, b) => (b.lastAt?.seconds ?? 0) - (a.lastAt?.seconds ?? 0))
        setConvos(all)
      },
      (err) => console.error('[PatientDashboard] conversations snapshot error:', err),
    )
    return unsub
  }, [user?.uid])

  const hasApp       = appCount > 0
  const hasActivity  = hasApp || !!activeRequest
  const activeStatus = activeApp?.status ?? null
  // Resolve null (initial) to true for new patients, false for returning ones
  // (an active co-funding request counts as activity too).
  const stepsOpenEffective = stepsOpen ?? (!loading && !hasActivity)

  // ── Step guide ────────────────────────────────────────────────────────
  // Title/desc strings come from patient.dashboard.steps.* in the locale
  // files; the action/path/done predicates stay here as code.
  const STEPS = [
    {
      num: 1, title: t('patient.dashboard.steps.s1Title'),
      desc:   t('patient.dashboard.steps.s1Desc'),
      path:   '/patient/request',
      done:   docStats.verified > 0,
    },
    {
      num: 2, title: t('patient.dashboard.steps.s2Title'),
      desc:   t('patient.dashboard.steps.s2Desc'),
      path:   '/patient/programs',
      done:   hasApp,
    },
    {
      num: 3, title: t('patient.dashboard.steps.s3Title'),
      desc:   t('patient.dashboard.steps.s3Desc'),
      path:   '/patient/status',
      done:   ['interview','approved','certificate'].includes(activeStatus),
    },
    {
      num: 4, title: t('patient.dashboard.steps.s4Title'),
      desc:   t('patient.dashboard.steps.s4Desc'),
      path:   '/patient/interviews',
      done:   ['approved','certificate'].includes(activeStatus),
    },
    {
      num: 5, title: t('patient.dashboard.steps.s5Title'),
      desc:   t('patient.dashboard.steps.s5Desc'),
      // R11 (2026-06-03): previously path=null meant the row had no tap
      // target. Patient saw "Done" with no way to navigate to the GL,
      // hitting "where is it?" /patient/status is where the
      // 'Download GL' button lives and where the GL viewer can be
      // opened, so route there for both done + not-done states.
      path:   '/patient/status',
      done:   activeStatus === 'certificate',
    },
  ]

  const doneCount      = STEPS.filter(s => s.done).length
  const currentStepNum = STEPS.find(s => !s.done)?.num ?? null

  // One-line "what's next" cue shown directly under the greeting.
  // Mirrors the detailed status card below but compresses it to a single
  // sentence so the patient knows the score before scrolling.
  const greetingStatus = (() => {
    if (loading) return null
    if (activeStatus && ['pending','reviewing','awaiting_info','interview','approved','certificate'].includes(activeStatus)) {
      return t(`patient.dashboard.greeting.${activeStatus}`)
    }
    if (appCount > 0)             return t('patient.dashboard.greeting.rejected')
    if (docStats.verified === 0)  return t('patient.dashboard.greeting.uploadDocs')
    return t('patient.dashboard.greeting.findProgram')
  })()

  // Funding figures for the balance hero — computed over the active request's
  // own slices (committed + outstanding) against amountNeeded.
  const reqSlices = activeRequest ? apps.filter(a => a.requestId === activeRequest.id) : []
  const funding   = activeRequest ? computeFunding(activeRequest.amountNeeded, reqSlices) : null

  // The single most pressing next action (or null when the ball is with CRMC).
  const nextAction = (() => {
    const rejected = docList.find(d => d.status === 'rejected')
    if (rejected) return {
      icon: MdUpload, eyebrow: t('patient.dashboard.nextAction.eyebrow'),
      title: t('patient.dashboard.nextAction.fixDoc'),
      detail: rejected.documentTypeName ?? rejected.name ?? '',
      cta: t('patient.dashboard.nextAction.upload'),
      onClick: () => navigate('/patient/request'),
    }
    if (activeApp?.status === 'awaiting_info') return {
      icon: MdAssignment, eyebrow: t('patient.dashboard.nextAction.eyebrow'),
      title: t('patient.dashboard.nextAction.respond'),
      detail: activeApp.agencyName ?? '',
      cta: t('patient.dashboard.nextAction.view'),
      onClick: () => navigate('/patient/status'),
    }
    const interviewActive = activeApp?.status === 'interview'
      || (activeRequest?.interviewDate && !['completed', 'no_show'].includes(activeRequest?.interviewOutcome))
    if (interviewActive) {
      const d    = activeRequest?.interviewDate ?? activeApp?.interviewDate
      const time = activeRequest?.interviewTime ?? activeApp?.interviewTime
      return {
        icon: MdVideoCall, eyebrow: t('patient.dashboard.nextAction.eyebrow'),
        title: t('patient.dashboard.nextAction.interview'),
        detail: d ? `${new Date(`${d}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}${time ? ` · ${time}` : ''}` : '',
        cta: t('patient.dashboard.nextAction.join'),
        onClick: () => navigate('/patient/interviews'),
      }
    }
    return null
  })()

  // Only show doc section once they have docs or an active application.
  // Hide once their GL has been issued — by then the doc-workflow phase
  // is complete and the card is just visual noise.
  const showDocSection = !docLoading
    && (hasApp || docStats.verified > 0 || docStats.pending > 0)
    && activeStatus !== 'certificate'
    && activeStatus !== 'approved'

  return (
    <Layout breadcrumb={t('patient.dashboard.title')}>
      {/* Hard viewport cap so no descendant (long agency name, awaiting-
          info message with a URL, etc.) can push the page wider than the
          phone screen. overflow-x-clip is the strict version of -hidden. */}
      <div className="px-3 py-4 sm:p-6 mx-auto w-full max-w-[100vw] sm:max-w-3xl lg:max-w-6xl overflow-x-clip space-y-4">

        {/* Compact greeting — banking-app pattern: the GREETING is a
            small line at the top, the STATUS card below is the hero.
            On desktop (sm+) the greeting returns to page-title weight
            so the dashboard reads like a landing page. */}
        <div data-tour-id="patient-greeting">
          <h1 className="font-display text-lg sm:text-2xl font-bold tracking-tight text-gray-800 sm:text-gray-900">
            {t('patient.dashboard.subtitle', { name: firstName })}
          </h1>
          {greetingStatus && (
            <p className="hidden sm:block text-sm text-gray-500 mt-1 leading-snug">{greetingStatus}</p>
          )}
        </div>

        {/* R38: "What's new" feed — renders null when empty so it stays
            out of the way on a clean dashboard. */}
        <AnnouncementFeedCard items={feedAnnouncements} />

        {/* Two-column on desktop: the journey column (hero → coverage →
            timeline → steps) beside an aside (documents + messages). Single
            column on phone, where the aside stacks after the main column. */}
        <div className="grid gap-5 items-start lg:grid-cols-12">
          <div className="space-y-4 min-w-0 lg:col-span-8">

        {/* Main status card — wrapped so the tour can spotlight whichever
            of the conditional branches is currently rendered (welcome
            hero / active request / status / rejected). */}
        <div data-tour-id="patient-hero">
        {loading ? (
          <div className="card p-6 animate-pulse">
            <div className="h-6 bg-gray-100 rounded w-48 mb-3" />
            <div className="h-4 bg-gray-100 rounded w-full mb-2" />
            <div className="h-4 bg-gray-100 rounded w-3/4 mb-5" />
            <div className="h-12 bg-gray-100 rounded-xl" />
          </div>
        ) : activeRequest && funding ? (
            // Pre-funding stages (submitted → assessment) get the redesign's
            // cohesive "Step X of 6 + one action" pine hero; once money is in
            // play (endorsed onward) the balance/coverage hero is what matters.
            (REQ_RANK[activeRequest.status] ?? 0) < 3
              ? <StatusHero request={activeRequest} nextAction={nextAction} navigate={navigate} />
              : <BalanceHero request={activeRequest} funding={funding} t={t} navigate={navigate} />
        ) : activeApp && STATUS_VISUAL[activeApp.status] ? (() => {
          const vis = STATUS_VISUAL[activeApp.status]
          const txt = `patient.dashboard.statusCard.${activeApp.status}`
          const isAwaiting  = activeApp.status === 'awaiting_info'
          const isInterview = activeApp.status === 'interview'
          const Icon = vis.icon
          // Pre-format interview details for inline display.
          // i18n.language picks 'en' or 'fil' (resolved through i18next at runtime).
          const interviewDateStr = activeApp.interviewDate
            ? new Date(`${activeApp.interviewDate}T00:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
            : null
          return (
            <div className={`card p-5 border-2 ${vis.border} ${vis.bg}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${vis.iconBg}`}>
                  <Icon size={22} />
                </div>
                <h2 className={`text-lg font-bold ${vis.text}`}>{t(`${txt}.label`)}</h2>
              </div>
              <p className={`text-sm leading-relaxed mb-4 ${vis.subtext}`}>{t(`${txt}.desc`)}</p>

              {/* awaiting_info: surface the agency's message */}
              {isAwaiting && activeApp.awaitingInfoMessage && (
                <div className="bg-white border border-orange-200 rounded-xl p-3 mb-4">
                  <p className="text-xs font-semibold text-orange-700 mb-1">
                    {t('patient.dashboard.statusCard.awaiting_info.messageFrom', { agency: activeApp.agencyName })}
                  </p>
                  <p className="text-sm text-gray-700 leading-relaxed">{activeApp.awaitingInfoMessage}</p>
                </div>
              )}

              {/* interview: show date/time/Meet link inline — most time-sensitive
                  event in the journey; patient shouldn't need an extra click. */}
              {isInterview && (interviewDateStr || activeApp.interviewTime || activeApp.meetLink) && (
                <div className="bg-white border border-purple-200 rounded-xl p-3 mb-4 space-y-2">
                  {interviewDateStr && (
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <MdCalendarMonth size={16} className="text-purple-500 flex-shrink-0" />
                      <span className="font-medium">{interviewDateStr}</span>
                    </div>
                  )}
                  {activeApp.interviewTime && (
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <MdAccessTime size={16} className="text-purple-500 flex-shrink-0" />
                      <span className="font-medium">{activeApp.interviewTime}</span>
                    </div>
                  )}
                  {activeApp.meetLink && (
                    <a href={activeApp.meetLink} target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 text-sm text-purple-600 hover:text-purple-700 font-medium pt-1 border-t border-purple-100">
                      <MdVideoCall size={16} className="flex-shrink-0" />
                      <span className="truncate">{t('patient.dashboard.statusCard.interview.joinMeet')}</span>
                      <MdOpenInNew size={13} className="flex-shrink-0 opacity-60" />
                    </a>
                  )}
                </div>
              )}

              <button
                className={`w-full py-3 rounded-xl font-semibold text-sm transition-colors ${vis.btnClass}`}
                onClick={() => navigate(vis.path)}>
                {t(`${txt}.btn`)} →
              </button>
              <p className="text-xs text-center mt-2 text-gray-500">
                {activeApp.appId} · {activeApp.agencyName} · {t('patient.dashboard.metadata.submittedOn', { date: formatDate(activeApp.submittedAt) })}
              </p>
            </div>
          )
        })() : appCount > 0 ? (
          <div className="card p-5 border-2 border-red-200 bg-red-50">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-red-100 text-red-600">
                <MdCancel size={22} />
              </div>
              <h2 className="text-lg font-bold text-red-800">{t('patient.dashboard.rejectedCard.title')}</h2>
            </div>
            <p className="text-sm text-red-700 leading-relaxed mb-4">
              {appCount === 1
                ? t('patient.dashboard.rejectedCard.descOne')
                : t('patient.dashboard.rejectedCard.descMany', { count: appCount })}
            </p>
            <button
              className="w-full py-3 rounded-xl font-semibold text-sm bg-brand-500 hover:bg-brand-600 text-white transition-colors"
              onClick={() => navigate('/patient/programs')}>
              {t('patient.dashboard.rejectedCard.btn')} →
            </button>
          </div>
        ) : (welcomeDismissed || docStats.verified > 0 || docStats.pending > 0) ? (
          // Compact form: once the patient has any progress (uploaded a
          // doc) or explicitly dismissed the hero, swap to a single-row
          // link card. The Application Steps section below is now the
          // primary action surface, and the full hero is overkill.
          <button
            className="w-full card p-4 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors border border-brand-100"
            onClick={() => navigate('/patient/guide')}>
            <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
              <MdMenuBook size={20} className="text-brand-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800">{t('patient.dashboard.welcomeCard.newToMapa')}</p>
              <p className="text-xs text-gray-500 mt-0.5">{t('patient.dashboard.welcomeCard.compactSub')}</p>
            </div>
            <MdArrowForward size={16} className="text-gray-300 flex-shrink-0" />
          </button>
        ) : (
          <div className="card p-5 border-2 border-brand-200 bg-brand-50 relative">
            {/* Dismiss button — once tapped, the hero collapses to the
                compact link form on next render and stays that way. */}
            <button
              onClick={dismissWelcome}
              aria-label={t('common.close')}
              className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center text-brand-400 hover:text-brand-700 hover:bg-brand-100 rounded-lg transition-colors">
              <MdClose size={16} />
            </button>
            <div className="flex items-center gap-3 mb-3 pr-8">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-brand-100 text-brand-600">
                <MdLocalHospital size={22} />
              </div>
              <h2 className="text-lg font-bold text-brand-800">{t('patient.dashboard.welcomeCard.title')}</h2>
            </div>
            <p className="text-sm text-brand-700 leading-relaxed mb-3">
              {t('patient.dashboard.welcomeCard.intro')}
            </p>

            {/* What you can get — concrete value preview so a first-time
                patient knows what kinds of help exist before committing. */}
            <div className="bg-white border border-brand-100 rounded-xl p-3 mb-4">
              <p className="text-xs font-semibold text-brand-700 mb-2 uppercase tracking-wide">{t('patient.dashboard.welcomeCard.whatYouCanApplyFor')}</p>
              <ul className="text-xs text-gray-700 space-y-1">
                <li className="flex items-start gap-2"><span className="text-brand-500 flex-shrink-0">•</span>{t('patient.dashboard.welcomeCard.hospitalBills')}</li>
                <li className="flex items-start gap-2"><span className="text-brand-500 flex-shrink-0">•</span>{t('patient.dashboard.welcomeCard.medicines')}</li>
                <li className="flex items-start gap-2"><span className="text-brand-500 flex-shrink-0">•</span>{t('patient.dashboard.welcomeCard.labTests')}</li>
                <li className="flex items-start gap-2"><span className="text-brand-500 flex-shrink-0">•</span>{t('patient.dashboard.welcomeCard.chemotherapy')}</li>
              </ul>
              <p className="text-xs text-gray-500 mt-2">{t('patient.dashboard.welcomeCard.fromAgencies')}</p>
            </div>

            <button
              className="w-full py-3 rounded-xl font-semibold text-sm bg-brand-500 hover:bg-brand-600 text-white transition-colors"
              onClick={() => navigate('/patient/request')}>
              {t('patient.dashboard.welcomeCard.getStarted')} →
            </button>
            <button
              className="w-full mt-2 min-h-[44px] inline-flex items-center justify-center text-sm text-brand-600 hover:text-brand-800 transition-colors"
              onClick={() => navigate('/patient/guide')}>
              {t('patient.dashboard.welcomeCard.newToMapa')} →
            </button>
          </div>
        )}
        </div>{/* /patient-hero wrapper */}

        {/* At-a-glance journey strip — the redesign's "where am I" answered
            without reading, right under the hero. Full detail lives in the
            Status timeline below / on the Status tab. */}
        {activeRequest && (
          <div className="card px-3 py-3.5">
            <JourneyStrip status={activeRequest.status} />
          </div>
        )}

        {/* Next action (when the ball is with the patient) + the real event
            timeline. Coverage breakdown lives in the aside now. When the pine
            StatusHero is showing it already carries this action as its CTA, so
            we don't repeat it as a separate card. */}
        {nextAction && !(activeRequest && funding && (REQ_RANK[activeRequest.status] ?? 0) < 3)
          && <NextActionCard action={nextAction} />}
        {activeRequest && <TimelineCard request={activeRequest} docStats={docStats} t={t} />}

        {/* Step guide — collapsible */}
        <div data-tour-id="patient-steps" className="card overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
            onClick={() => setStepsOpen(!stepsOpenEffective)}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800">{t('patient.dashboard.steps.title')}</p>
              <p className="text-xs text-gray-500 mt-0.5">{t('patient.dashboard.steps.completedOf', { done: doneCount, total: STEPS.length })}</p>
              {/* Visual progress bar — gives an at-a-glance read of journey
                  progress without needing to expand the accordion. */}
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden max-w-xs">
                <div className="h-full bg-brand-500 transition-all" style={{ width: `${(doneCount / STEPS.length) * 100}%` }} />
              </div>
            </div>
            {stepsOpenEffective
              ? <MdExpandLess size={20} className="text-gray-500 flex-shrink-0 ml-3" />
              : <MdExpandMore size={20} className="text-gray-500 flex-shrink-0 ml-3" />
            }
          </button>

          {stepsOpenEffective && (
            <div className="divide-y divide-gray-50 border-t border-gray-100">
              {STEPS.map((step) => {
                const isActive  = step.num === currentStepNum
                const clickable = !!step.path
                // Whole-row click target instead of a tiny "Manage →" text link.
                // Per CLAUDE.md mobile-first guideline: touch targets ≥44px.
                const RowTag    = clickable ? 'button' : 'div'
                return (
                  <RowTag key={step.num}
                    onClick={clickable ? () => navigate(step.path) : undefined}
                    className={`w-full flex items-start gap-3 py-4 px-4 text-left transition-colors ${
                      isActive ? 'bg-brand-50' : ''
                    } ${clickable ? 'hover:bg-gray-50 cursor-pointer' : ''}`}>
                    <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium mt-0.5
                      ${step.done
                        ? 'bg-brand-500 text-white'
                        : isActive
                          ? 'border-2 border-brand-500 text-brand-500 bg-white'
                          : 'border-2 border-gray-200 text-gray-500'}`}>
                      {step.done ? <MdCheck size={14} /> : step.num}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${
                        step.done ? 'text-gray-800'
                        : isActive ? 'text-brand-700'
                        : 'text-gray-500'}`}>
                        {step.title}
                        {step.done   && <span className="ml-1.5 badge badge-green text-xs">{t('patient.dashboard.steps.done')}</span>}
                        {isActive    && <span className="ml-1.5 badge badge-blue text-xs">{t('patient.dashboard.steps.current')}</span>}
                      </p>
                      <p className={`text-xs mt-0.5 leading-relaxed ${isActive ? 'text-brand-600' : 'text-gray-500'}`}>
                        {step.desc}
                      </p>
                    </div>
                    {clickable && (
                      <MdArrowForward
                        size={16}
                        className={`flex-shrink-0 mt-1 ${isActive ? 'text-brand-500' : 'text-gray-300'}`}
                      />
                    )}
                  </RowTag>
                )
              })}
            </div>
          )}
        </div>
          </div>{/* /main column */}

          {/* Aside — coverage breakdown + itemized documents + messages. Stacks
              after the main column on phone; sits beside it on desktop. */}
          <div className="space-y-4 min-w-0 lg:col-span-4">
            {activeRequest && <CoverageCard request={activeRequest} t={t} />}
            {showDocSection && docList.length > 0 && (
              <div data-tour-id="patient-docs">
                <DocumentsList docs={docList} t={t} navigate={navigate} />
              </div>
            )}
            <MessagesPreview convos={convos} uid={user?.uid} t={t} navigate={navigate} />
          </div>
        </div>{/* /grid */}

        {/* PWA install prompt — bottom of dashboard. The component
            handles its own visibility (only fires when the browser
            says the app is installable, and dismisses to sessionStorage
            so it doesn't nag mid-session). Logged-in patients only;
            unauthenticated visitors never see this. */}
        <InstallPrompt />

      </div>

      {/* First-visit guided tour. Auto-fires once per user (localStorage-
          scoped to uid), four steps spotlighting the greeting, hero card,
          steps card, and docs summary. Strings come from i18n so the
          tour speaks Filipino when the language toggle is set. */}
      <Tour steps={patientDashboardTour(t)} storageKey="patient-dashboard" />
    </Layout>
  )
}
