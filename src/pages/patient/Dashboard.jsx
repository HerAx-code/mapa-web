import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  MdUpload, MdCheckCircle, MdPending,
  MdArrowForward, MdExpandMore, MdExpandLess,
  MdHourglassEmpty, MdAssignment, MdSchedule, MdVideoCall,
  MdReceipt, MdCancel, MdLocalHospital, MdCalendarMonth, MdAccessTime,
  MdOpenInNew, MdCheck, MdClose, MdMenuBook,
} from 'react-icons/md'
import Layout from '../../components/Layout'
import InstallPrompt from '../../components/InstallPrompt'
import StatusBadge from '../../components/ui/StatusBadge'
import Tour from '../../components/Tour'
import { patientDashboardTour } from '../../utils/tours'
import { useAuth } from '../../contexts/AuthContext'
import {
  collection, query, where, orderBy, onSnapshot, getDocs,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { notify } from '../../utils/notifications'
import { REQUEST_STATUS_CONFIG } from '../../utils/constants'

// Parses "YYYY-MM-DD" + "2:00 PM" / "14:00" / "2:00 pm" into a Date.
// Returns null if either part can't be parsed.
function parseInterviewMoment(iso, timeStr) {
  if (!iso || !timeStr) return null
  const s = String(timeStr).trim()
  // 12h with AM/PM
  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm|AM|PM)$/)
  let hours = null, minutes = null
  if (m12) {
    hours   = parseInt(m12[1], 10) % 12
    minutes = parseInt(m12[2], 10)
    if (/pm/i.test(m12[3])) hours += 12
  } else {
    // 24h fallback
    const m24 = s.match(/^(\d{1,2}):(\d{2})$/)
    if (m24) {
      hours   = parseInt(m24[1], 10)
      minutes = parseInt(m24[2], 10)
    }
  }
  if (hours == null) return null
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  d.setHours(hours, minutes, 0, 0)
  return d
}

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
  // Co-funding: an endorsed slice means CRMC matched agencies and the patient
  // must review the coverage plan + Proceed. Points to the request, not the
  // per-slice tracker.
  endorsed: {
    icon:     MdReceipt,
    iconBg:   'bg-purple-100 text-purple-600',
    path:     '/patient/request',
    border:   'border-purple-300',
    bg:       'bg-purple-50',
    text:     'text-purple-800',
    subtext:  'text-purple-600',
    btnClass: 'bg-purple-500 hover:bg-purple-600 text-white',
  },
  reviewing: {
    icon:     MdAssignment,
    iconBg:   'bg-amber-100 text-amber-600',
    path:     '/patient/request',
    border:   'border-amber-300',
    bg:       'bg-amber-50',
    text:     'text-amber-800',
    subtext:  'text-amber-600',
    btnClass: 'bg-amber-500 hover:bg-amber-600 text-white',
  },
  awaiting_info: {
    icon:     MdSchedule,
    iconBg:   'bg-orange-100 text-orange-600',
    path:     '/patient/request',
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
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
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

  const [activeApp,  setActiveApp]  = useState(null)
  const [activeRequest, setActiveRequest] = useState(null)
  const [appCount,   setAppCount]   = useState(0)
  const [docStats,   setDocStats]   = useState({ verified: 0, pending: 0 })
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
    setWelcomeDismissed(localStorage.getItem(`mapa_welcome_dismissed_${user.uid}`) === '1')
  }, [user?.uid])
  const dismissWelcome = () => {
    if (user?.uid) localStorage.setItem(`mapa_welcome_dismissed_${user.uid}`, '1')
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
      setAppCount(all.length)
      setActiveApp(all.find(a => a.status !== 'rejected') ?? null)
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

  // Interview reminder sweep — client-side, best-effort.
  // For each upcoming interview, fire a notification at 24h and 1h before
  // the meeting. Per-device localStorage dedup: keys are scoped to user +
  // interview id so a patient checking their dashboard repeatedly doesn't
  // get the same reminder twice. The previous implementation tried to
  // persist the dedup flag on the doc itself (reminderSent24h /
  // reminderSent1h) but firestore.rules don't permit patients to write
  // those fields -- the .catch was silently swallowing permission-denied
  // and the dedup never actually worked.
  //
  // Two parallel sweeps because under the redesign:
  //   - legacy direct-to-agency apps may still be in status 'interview'
  //   - new-model interviews live on the REQUEST (CRMC-conducted, single
  //     assessment) and never set application.status to 'interview'.
  useEffect(() => {
    if (!user?.uid) return
    const remindedKey = (kind, id, tier) => `mapa_reminder_${tier}_${user.uid}_${kind}_${id}`
    const isReminded = (kind, id, tier) => localStorage.getItem(remindedKey(kind, id, tier)) === '1'
    const markReminded = (kind, id, tier) => {
      try { localStorage.setItem(remindedKey(kind, id, tier), '1') } catch (_e) { /* private mode / quota: best-effort */ }
    }
    const fireReminder = async (kind, item, target, msUntil) => {
      const within24h = msUntil <= 24 * 60 * 60 * 1000 && msUntil > 60 * 60 * 1000 && !isReminded(kind, item.id, '24h')
      const within1h  = msUntil <= 60 * 60 * 1000      && !isReminded(kind, item.id, '1h')
      const isRequest = kind === 'request'
      const scope     = isRequest ? 'CRMC' : item.agencyName
      if (within24h) {
        await notify(user.uid, {
          type:  'interview_sched',
          title: isRequest ? 'Reminder: CRMC assessment tomorrow' : 'Reminder: interview tomorrow',
          body:  `Your interview with ${scope} is scheduled for ${item.interviewDate} at ${item.interviewTime}. Make sure you have the Google Meet link ready.`,
          conversationId: null,
        }).catch(() => {})
        markReminded(kind, item.id, '24h')
      }
      if (within1h) {
        await notify(user.uid, {
          type:  'interview_sched',
          title: isRequest ? 'Your CRMC assessment starts soon' : 'Your interview starts soon',
          body:  `Your interview with ${scope} starts in less than an hour (${item.interviewTime}). Open it from the Interviews page.`,
          conversationId: null,
        }).catch(() => {})
        markReminded(kind, item.id, '1h')
      }
    }

    const run = async () => {
      try {
        const now = Date.now()
        // Legacy: per-agency apps in status 'interview'.
        const appSnap = await getDocs(query(
          collection(db, 'applications'),
          where('patientId', '==', user.uid),
          where('status', '==', 'interview'),
        ))
        for (const d of appSnap.docs) {
          const a = { id: d.id, ...d.data() }
          if (!a.interviewDate || !a.interviewTime) continue
          const target = parseInterviewMoment(a.interviewDate, a.interviewTime)
          if (!target) continue
          const msUntil = target.getTime() - now
          if (msUntil <= 0) continue
          await fireReminder('app', a, target, msUntil)
        }

        // New model: CRMC assessment interview on the request.
        const reqSnap = await getDocs(query(
          collection(db, 'requests'),
          where('patientId', '==', user.uid),
        ))
        for (const d of reqSnap.docs) {
          const r = { id: d.id, ...d.data() }
          if (!r.interviewDate || !r.interviewTime) continue
          if (r.interviewOutcome === 'completed' || r.interviewOutcome === 'no_show') continue
          const target = parseInterviewMoment(r.interviewDate, r.interviewTime)
          if (!target) continue
          const msUntil = target.getTime() - now
          if (msUntil <= 0) continue
          await fireReminder('request', r, target, msUntil)
        }
      } catch (err) {
        console.error('Interview reminder sweep failed:', err)
      }
    }
    run()
  }, [user?.uid])

  // Live document stats so the verified/pending counts update the moment
  // CRMC verifies or rejects a doc -- no reload required.
  useEffect(() => {
    if (!user?.uid) return
    const unsub = onSnapshot(
      query(collection(db, 'documents'), where('patientId', '==', user.uid)),
      snap => {
        const all = snap.docs.map(d => d.data())
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
      path:   null,
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
      <div className="px-3 py-4 sm:p-6 mx-auto w-full max-w-[100vw] sm:max-w-3xl overflow-x-clip space-y-4">

        {/* Compact greeting — banking-app pattern: the GREETING is a
            small line at the top, the STATUS card below is the hero.
            On desktop (sm+) the greeting returns to page-title weight
            so the dashboard reads like a landing page. */}
        <div data-tour-id="patient-greeting">
          <h1 className="text-base sm:text-xl font-semibold text-gray-700 sm:text-gray-900">
            {t('patient.dashboard.subtitle', { name: firstName })}
          </h1>
          {greetingStatus && (
            <p className="hidden sm:block text-sm text-gray-500 mt-1 leading-snug">{greetingStatus}</p>
          )}
        </div>

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
        ) : activeRequest ? (
            <div className="card p-6">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-lg font-semibold text-gray-900">{t('patient.dashboard.activeRequestTitle')}</h2>
                <StatusBadge status={activeRequest.status} kind="request" className="ml-auto flex-shrink-0" />
              </div>
              <p className="text-sm text-gray-500 mb-1">{activeRequest.requestId} · {activeRequest.assistanceType}</p>
              <p className="text-sm text-gray-500 mb-4">{t('patient.dashboard.activeRequestDesc')}</p>
              <button className="btn-primary w-full text-sm" onClick={() => navigate('/patient/status')}>
                {t('patient.nav.myApplication')} →
              </button>
            </div>
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
              <p className="text-xs text-center mt-2 text-gray-400">
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
              <p className="text-xs text-gray-400 mt-0.5">{t('patient.dashboard.welcomeCard.compactSub')}</p>
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
              <p className="text-xs text-gray-400 mt-2">{t('patient.dashboard.welcomeCard.fromAgencies')}</p>
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

        {/* Document status — always a clickable card, shows both verified
            and pending counts so the patient sees their full picture. */}
        {showDocSection && (() => {
          const { verified, pending } = docStats
          const hasAny = verified > 0 || pending > 0
          // Pick the dominant tone: pending wins (active concern), then
          // verified (good news), then empty (call to action).
          const tone = pending > 0
            ? { iconBg: 'bg-amber-50',  icon: MdPending,     iconColor: 'text-amber-500' }
            : verified > 0
              ? { iconBg: 'bg-green-50', icon: MdCheckCircle, iconColor: 'text-green-500' }
              : { iconBg: 'bg-gray-100', icon: MdUpload,      iconColor: 'text-gray-400'  }
          const Icon = tone.icon

          const headline = !hasAny
            ? t('patient.dashboard.docs.noneYet')
            : pending > 0 && verified > 0
              ? t('patient.dashboard.docs.bothCounts', { verified, pending })
              : pending > 0
                ? t(pending === 1 ? 'patient.dashboard.docs.pendingOne' : 'patient.dashboard.docs.pendingMany', { count: pending })
                : t(verified === 1 ? 'patient.dashboard.docs.verifiedOne' : 'patient.dashboard.docs.verifiedMany', { count: verified })
          const subline = !hasAny
            ? t('patient.dashboard.docs.tapToUpload')
            : pending > 0
              ? t('patient.dashboard.docs.tapToManage')
              : t('patient.dashboard.docs.allUpToDate')

          return (
            <button
              data-tour-id="patient-docs"
              className="w-full card p-4 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
              onClick={() => navigate('/patient/request')}>
              <div className={`w-10 h-10 rounded-xl ${tone.iconBg} flex items-center justify-center flex-shrink-0`}>
                <Icon size={20} className={tone.iconColor} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">{headline}</p>
                <p className="text-xs text-gray-400 mt-0.5">{subline}</p>
              </div>
              <MdArrowForward size={16} className="text-gray-300 flex-shrink-0" />
            </button>
          )
        })()}

        {/* Step guide — collapsible */}
        <div data-tour-id="patient-steps" className="card overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
            onClick={() => setStepsOpen(!stepsOpenEffective)}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800">{t('patient.dashboard.steps.title')}</p>
              <p className="text-xs text-gray-400 mt-0.5">{t('patient.dashboard.steps.completedOf', { done: doneCount, total: STEPS.length })}</p>
              {/* Visual progress bar — gives an at-a-glance read of journey
                  progress without needing to expand the accordion. */}
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden max-w-xs">
                <div className="h-full bg-brand-500 transition-all" style={{ width: `${(doneCount / STEPS.length) * 100}%` }} />
              </div>
            </div>
            {stepsOpenEffective
              ? <MdExpandLess size={20} className="text-gray-400 flex-shrink-0 ml-3" />
              : <MdExpandMore size={20} className="text-gray-400 flex-shrink-0 ml-3" />
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
                          : 'border-2 border-gray-200 text-gray-400'}`}>
                      {step.done ? <MdCheck size={14} /> : step.num}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${
                        step.done ? 'text-gray-800'
                        : isActive ? 'text-brand-700'
                        : 'text-gray-400'}`}>
                        {step.title}
                        {step.done   && <span className="ml-1.5 badge badge-green text-xs">{t('patient.dashboard.steps.done')}</span>}
                        {isActive    && <span className="ml-1.5 badge badge-blue text-xs">{t('patient.dashboard.steps.current')}</span>}
                      </p>
                      <p className={`text-xs mt-0.5 leading-relaxed ${isActive ? 'text-brand-600' : 'text-gray-400'}`}>
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
