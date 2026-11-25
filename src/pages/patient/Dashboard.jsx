import { useState, useEffect } from 'react'
import { isRequestActive } from '../../shared/caseState'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  MdUpload, MdCheckCircle, MdPending,
  MdArrowForward, MdExpandMore, MdExpandLess,
  MdAssignment, MdCancel, MdChatBubbleOutline,
  MdEmail, MdSchedule, MdHandshake, MdReceipt,
} from 'react-icons/md'
import Layout from '../../components/Layout'
import JourneyStrip from '../../components/patient/JourneyStrip'
import PatientHero from '../../components/patient/PatientHero'
import ProfileGapsCard from '../../components/patient/ProfileGapsCard'
import CoverageBar from '../../components/patient/CoverageBar'
import PatientPage from '../../components/patient/PatientPage'
import InstallPrompt from '../../components/InstallPrompt'
import Tour from '../../components/Tour'
import { patientDashboardTour } from '../../utils/tours'
import { tsToDate } from '../../utils/dates'
import { useAuth } from '../../contexts/AuthContext'
import {
  collection, query, where, orderBy, onSnapshot,
} from 'firebase/firestore'
import { db, auth } from '../../firebase'
import { ORG } from '../../config/org'
import { isGLExpired } from '../../utils/constants'
import { isSliceTerminal, computeFunding, REQ_RANK } from '../../utils/requests'
import { peso } from '../../utils/format'
import { needsEmailConfirm } from '../../utils/emailConfirm'
import { patientNextAction, caseDocuments } from '../../utils/patientNextAction'
import AnnouncementFeedCard from '../../components/AnnouncementFeedCard'
import { useFeedAnnouncements } from '../../utils/announcements'

// Short "when" for the messages preview.
const formatWhen = (ts, t) => {
  const d = tsToDate(ts)
  if (!d) return ''
  const diff = Date.now() - d.getTime()
  const hrs  = Math.floor(diff / 3_600_000)
  if (hrs < 1)  return t('patient.dashboard.messagesCard.now')
  if (hrs < 24) return t('patient.dashboard.messagesCard.hoursAgo', { count: hrs })
  const days = Math.floor(hrs / 24)
  if (days < 7) return t('patient.dashboard.messagesCard.daysAgo', { count: days })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ── Bill breakdown ──────────────────────────────────────────────────────────
// How the amount needed was reached: bill − discounts − PhilHealth − other.
// Collapsed by default (review 2026-11-25): the hero and the coverage bar
// already show approved and remaining, so this is detail on request.
// Legacy requests with no totalBill fall back to amountNeeded.
function BillBreakdown({ request, t }) {
  const [open, setOpen] = useState(false)
  const bill   = Number(request.totalBill ?? request.amountNeeded) || 0
  const disc   = Number(request.discountsApplied) || 0
  const ph     = Number(request.philhealthCovered) || 0
  const other  = Number(request.otherCovered) || 0
  const needed = Number(request.amountNeeded) || 0
  if (needed <= 0 && bill <= 0) return null

  const rows = [
    { label: t('patient.dashboard.coverage.bill'), value: peso(bill) },
    ...(disc > 0  ? [{ label: t('patient.dashboard.coverage.discounts'),  value: `− ${peso(disc)}`,  muted: true }] : []),
    ...(ph > 0    ? [{ label: t('patient.dashboard.coverage.philhealth'), value: `− ${peso(ph)}`,    muted: true }] : []),
    ...(other > 0 ? [{ label: t('patient.dashboard.coverage.other'),      value: `− ${peso(other)}`, muted: true }] : []),
    { label: t('patient.dashboard.coverage.needed'), value: peso(needed), strong: true },
  ]

  return (
    <div className="card overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full min-h-[44px] px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-gray-50 transition-colors">
        <span className="text-sm font-semibold text-gray-800">{t('patient.dashboard.coverage.title')}</span>
        <span className="flex items-center gap-1 text-sm text-gray-600">
          <span className="tabular-nums">{peso(needed)}</span>
          {open ? <MdExpandLess size={20} aria-hidden="true" /> : <MdExpandMore size={20} aria-hidden="true" />}
        </span>
      </button>
      {open && (
        <dl className="space-y-2 px-4 pb-4 pt-3 border-t border-gray-100">
          {rows.map((r, i) => (
            <div key={i} className={`flex items-center justify-between gap-3 text-sm ${r.strong ? 'pt-2 mt-1 border-t border-gray-100' : ''}`}>
              <dt className={r.muted ? 'text-gray-500' : r.strong ? 'font-semibold text-gray-800' : 'text-gray-600'}>{r.label}</dt>
              <dd className={`tabular-nums ${r.muted ? 'text-brand-600' : r.strong ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
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
              <span className="flex-1 min-w-0 text-sm text-gray-800 truncate">{d.documentTypeName ?? d.name ?? t('patient.dashboard.docsCard.untitled')}</span>
              <span className={`text-xs flex-shrink-0 font-medium ${m.cls}`}>{m.label}</span>
            </li>
          )
        })}
      </ul>
      <button onClick={() => navigate('/patient/request')}
        className="w-full min-h-[44px] border-t border-gray-100 px-4 py-2.5 text-left text-sm font-medium text-brand-600 hover:bg-gray-50 flex items-center gap-1.5 transition-colors">
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
          className="-my-2 -mr-2 min-h-[44px] px-2 text-sm font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1">
          {t('patient.dashboard.messagesCard.viewAll')} <MdArrowForward size={14} />
        </button>
      </div>
      <ul className="mt-2 divide-y divide-gray-50">
        {convos.slice(0, 3).map(c => {
          const otherUid = (c.participants ?? []).find(p => p !== uid)
          const sender   = c.names?.[otherUid] ?? ORG.gatewayName
          const unread   = (c.unread?.[uid] ?? 0) > 0
          return (
            <li key={c.id}>
              <button onClick={() => navigate('/patient/messages')}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-2">
                  {unread && <span className="w-2 h-2 rounded-full bg-brand-500 flex-shrink-0" aria-hidden="true" />}
                  <span className={`text-sm truncate ${unread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>{sender}</span>
                  <span className="ml-auto text-xs text-gray-500 flex-shrink-0">{formatWhen(c.lastAt, t)}</span>
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
// The one thing the patient should do now (utils/patientNextAction.js), or
// nothing when the ball is with the hospital or an agency.
const ACTION_ICON = {
  confirmEmail: MdEmail, hold: MdSchedule, fixDoc: MdUpload,
  proceed: MdHandshake, respond: MdAssignment, collectGL: MdReceipt,
}

// The action's words: title, a detail line and the button label.
function actionText(action, t) {
  const k = `patient.dashboard.nextAction.${action.kind}`
  const detail = action.kind === 'collectGL'
    ? t(`${k}.detail`, { agency: action.detail, count: Math.max(0, action.days ?? 0) })
    : action.kind === 'confirmEmail' || action.kind === 'hold'
      ? t(`${k}.detail`)
      : action.detail
  return { title: t(`${k}.title`, { count: action.count ?? 1 }), detail, cta: t(`${k}.cta`) }
}

function NextActionCard({ action, t, navigate }) {
  const Icon = ACTION_ICON[action.kind] ?? MdAssignment
  const { title, detail, cta } = actionText(action, t)
  return (
    <button onClick={() => navigate(action.path)}
      className="w-full text-left rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5 flex items-start gap-3 hover:bg-amber-100/60 transition-colors">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-amber-600 border border-amber-200">
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">{t('patient.dashboard.nextAction.eyebrow')}</p>
        <p className="text-sm font-semibold text-gray-900 mt-0.5">{title}</p>
        {detail && <p className="text-xs text-gray-600 mt-0.5">{detail}</p>}
      </div>
      <span className="text-sm font-semibold text-amber-700 flex-shrink-0 self-center">{cta} →</span>
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
    if (!raw) return t('patient.dashboard.nameFallback')
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
  })()

  // R38: dashboard "What's new" feed — the gateway notices opted into 'feed'
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
  const [requestCount, setRequestCount]   = useState(0)
  const [reqLoading, setReqLoading] = useState(true)
  const [appCount,   setAppCount]   = useState(0)
  const [docStats,   setDocStats]   = useState({ verified: 0, pending: 0 })
  const [docList,    setDocList]    = useState([])
  const [convos,     setConvos]     = useState([])
  const [appsLoading, setAppsLoading] = useState(true)
  const [docLoading, setDocLoading] = useState(true)
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
      setAppsLoading(false)
    }, (err) => {
      setAppsLoading(false)
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
        setRequestCount(reqs.length)
        setActiveRequest(reqs.find(r => isRequestActive(r)) ?? null)
        setReqLoading(false)
      },
      (err) => {
        setReqLoading(false)
        console.error('[PatientDashboard] requests snapshot error:', err)
      },
    )
    return unsub
  }, [user?.uid])

  // Live document stats so the verified/pending counts update the moment
  // the gateway verifies or rejects a doc -- no reload required.
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

  const loading     = appsLoading || reqLoading
  // Anything filed, ever. A patient with no history sees the welcome, the
  // "How it works" guide and the tour; a returning one doesn't.
  const hasActivity = appCount > 0 || requestCount > 0

  // Funding figures for the balance hero — computed over the active request's
  // own slices (committed + outstanding) against amountNeeded.
  const reqSlices = activeRequest ? apps.filter(a => a.requestId === activeRequest.id) : []
  const funding   = activeRequest ? computeFunding(activeRequest.amountNeeded, reqSlices) : null
  const reqRank   = activeRequest ? (REQ_RANK[activeRequest.status] ?? 0) : 0

  // The active case's own documents (never a past case's, never one already
  // replaced by a corrected upload).
  const caseDocs = caseDocuments(activeRequest, docList)

  // The single most pressing thing to do, or null when the ball is elsewhere.
  const nextAction = loading ? null : patientNextAction({
    activeRequest, slices: reqSlices, docs: docList,
    cooldown: user?.cooldown,
    emailUnconfirmed: needsEmailConfirm(user, auth?.currentUser),
  })
  // The pine StatusHero (before endorsement) carries the action as its button.
  const heroAction = nextAction
    ? { cta: actionText(nextAction, t).cta, onClick: () => navigate(nextAction.path) }
    : null
  const heroCarriesAction = !!(activeRequest && funding && reqRank < 3)

  // Documents: while the hospital is still checking them, or while one of
  // them still needs something. Once endorsed and all verified, it's noise.
  const showDocSection = !docLoading && caseDocs.length > 0
    && (reqRank < 3 || caseDocs.some(d => d.status !== 'verified'))

  // "How it works" — first-run orientation, in the order things really happen.
  const STEPS = [1, 2, 3, 4].map(n => ({
    num: n,
    title: t(`patient.dashboard.steps.s${n}Title`),
    desc:  t(`patient.dashboard.steps.s${n}Desc`),
  }))

  return (
    <Layout breadcrumb={t('patient.dashboard.title')}>
      {/* Shared patient width (wide: dashboards/grids). overflow-x-clip is a
          hard cap so no descendant (long agency name, awaiting-info URL, etc.)
          can push the page wider than its column / the phone screen. */}
      <PatientPage width="wide" className="overflow-x-clip space-y-4">

        {/* Compact greeting — banking-app pattern: the GREETING is a
            small line at the top, the STATUS card below is the hero.
            On desktop (sm+) the greeting returns to page-title weight
            so the dashboard reads like a landing page. */}
        <div data-tour-id="patient-greeting">
          <h1 className="font-display text-lg sm:text-2xl font-bold tracking-tight text-gray-800 sm:text-gray-900">
            {t('patient.dashboard.subtitle', { name: firstName })}
          </h1>
        </div>

        {/* R38: "What's new" feed — renders null when empty so it stays
            out of the way on a clean dashboard. */}
        <AnnouncementFeedCard items={feedAnnouncements} />

        {/* Two-column on desktop: the journey column (hero → coverage →
            timeline → steps) beside an aside (documents + messages). Single
            column on phone, where the aside stacks after the main column. */}
        <div className="grid gap-5 items-start lg:grid-cols-12">
          <div className="space-y-4 min-w-0 lg:col-span-8">
          {/* Phase 3B: once, for accounts made before sign-up asked for birthdate + sex. */}
          <ProfileGapsCard />

        {/* Main status card — wrapped so the tour can spotlight whichever
            of the conditional branches is currently rendered (welcome
            hero / active request / status / rejected). */}
        <div data-tour-id="patient-hero">
          <PatientHero
            loading={loading}
            activeRequest={activeRequest}
            funding={funding}
            nextAction={heroAction}
            activeApp={activeApp}
            pastCase={hasActivity && !activeRequest}
            docStats={docStats}
            welcomeDismissed={welcomeDismissed}
            dismissWelcome={dismissWelcome}
            navigate={navigate}
          />
        </div>{/* /patient-hero wrapper */}

        {/* The one thing to do now, right under the hero — unless the pine
            StatusHero already carries it as its button. */}
        {nextAction && !heroCarriesAction
          && <NextActionCard action={nextAction} t={t} navigate={navigate} />}

        {/* At-a-glance journey strip — the redesign's "where am I" answered
            without reading, right under the hero. Full detail lives in the
            Status timeline below / on the Status tab. */}
        {activeRequest && (
          <div className="card px-3 py-3.5">
            <JourneyStrip request={activeRequest} />
          </div>
        )}

        {/* Per-agency path-to-zero — funding stage only. Makes co-funding
            legible at a glance; sits right under the strip so it reads high on
            mobile (matches the redesign mockup). */}
        {activeRequest && funding && reqRank >= 3 && reqSlices.length > 0 && (
          <CoverageBar request={activeRequest} slices={reqSlices} />
        )}

        {/* How the amount needed was reached — collapsed. */}
        {activeRequest && <BillBreakdown request={activeRequest} t={t} />}

        {/* How it works — first-run orientation only (nothing filed yet). Once
            there is a case, the journey strip + My Application show progress. */}
        {!loading && !hasActivity && (
        <section data-tour-id="patient-steps" className="card overflow-hidden" aria-labelledby="how-it-works">
          <h2 id="how-it-works" className="px-4 pt-4 text-sm font-semibold text-gray-800">{t('patient.dashboard.steps.title')}</h2>
          <ol className="mt-2 divide-y divide-gray-50">
            {STEPS.map((step) => (
              <li key={step.num} className="flex items-start gap-3 py-3.5 px-4">
                <span aria-hidden="true" className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold mt-0.5 ${
                  step.num === 1 ? 'bg-brand-500 text-white' : 'border-2 border-gray-200 text-gray-500'}`}>
                  {step.num}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{step.title}</p>
                  <p className="text-xs mt-0.5 leading-relaxed text-gray-600">{step.desc}</p>
                </div>
              </li>
            ))}
          </ol>
          <button onClick={() => navigate('/patient/request')}
            className="w-full min-h-[44px] border-t border-gray-100 px-4 py-2.5 text-left text-sm font-semibold text-brand-600 hover:bg-gray-50 flex items-center gap-1.5 transition-colors">
            {t('patient.dashboard.steps.start')} <MdArrowForward size={16} />
          </button>
        </section>
        )}
          </div>{/* /main column */}

          {/* Aside — the case's documents + messages. Stacks
              after the main column on phone; sits beside it on desktop. */}
          <div className="space-y-4 min-w-0 lg:col-span-4">
            {showDocSection && (
              <DocumentsList docs={caseDocs} t={t} navigate={navigate} />
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

      </PatientPage>

      {/* First-visit guided tour, for a new account only (nothing filed yet):
          it spotlights the greeting, the hero and "How it works", which a
          returning patient doesn't have. Once per user (localStorage). */}
      {!loading && !hasActivity && <Tour steps={patientDashboardTour(t)} storageKey="patient-dashboard" />}
    </Layout>
  )
}
