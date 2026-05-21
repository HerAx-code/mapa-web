import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  MdUpload, MdCheckCircle, MdPending,
  MdArrowForward, MdExpandMore, MdExpandLess,
} from 'react-icons/md'
import Layout from '../../components/Layout'
import { useAuth } from '../../contexts/AuthContext'
import {
  collection, query, where, orderBy, onSnapshot, getDocs,
  doc, updateDoc,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { notify } from '../../utils/notifications'

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

const STATUS_CONFIG = {
  pending: {
    emoji:    '⏳',
    label:    'Application Under Review',
    desc:     'The agency has received your application and will review it soon. You do not need to do anything right now.',
    btn:      'View Application Status',
    path:     '/patient/status',
    border:   'border-blue-300',
    bg:       'bg-blue-50',
    text:     'text-blue-800',
    subtext:  'text-blue-600',
    btnClass: 'bg-blue-500 hover:bg-blue-600 text-white',
  },
  reviewing: {
    emoji:    '📋',
    label:    'Documents Being Checked',
    desc:     'The agency is checking your uploaded documents. Make sure all your required documents are uploaded.',
    btn:      'Check My Documents',
    path:     '/patient/documents',
    border:   'border-amber-300',
    bg:       'bg-amber-50',
    text:     'text-amber-800',
    subtext:  'text-amber-600',
    btnClass: 'bg-amber-500 hover:bg-amber-600 text-white',
  },
  awaiting_info: {
    emoji:    '⏰',
    label:    'Action Needed From You',
    desc:     'The agency has asked you for more information. Open your documents and upload what they requested.',
    btn:      'Open My Documents',
    path:     '/patient/documents',
    border:   'border-orange-300',
    bg:       'bg-orange-50',
    text:     'text-orange-800',
    subtext:  'text-orange-700',
    btnClass: 'bg-orange-500 hover:bg-orange-600 text-white',
  },
  interview: {
    emoji:    '📅',
    label:    'Interview Scheduled',
    desc:     'You have a video interview scheduled with the agency. Tap the button below to see the date and details.',
    btn:      'View My Interview',
    path:     '/patient/interviews',
    border:   'border-purple-300',
    bg:       'bg-purple-50',
    text:     'text-purple-800',
    subtext:  'text-purple-600',
    btnClass: 'bg-purple-500 hover:bg-purple-600 text-white',
  },
  approved: {
    emoji:    '✅',
    label:    'Application Approved',
    desc:     'Congratulations! Your application has been approved for a specific amount. Your Guarantee Letter is being prepared.',
    btn:      'View Application',
    path:     '/patient/status',
    border:   'border-green-300',
    bg:       'bg-green-50',
    text:     'text-green-800',
    subtext:  'text-green-600',
    btnClass: 'bg-green-500 hover:bg-green-600 text-white',
  },
  certificate: {
    emoji:    '🏅',
    label:    'Guarantee Letter Ready',
    desc:     'Your Guarantee Letter has been issued. View it on the My Application page once the signed copy is uploaded.',
    btn:      'View My Guarantee Letter',
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
  const firstName = user?.name?.split(' ')[0] || 'Patient'

  const [activeApp,  setActiveApp]  = useState(null)
  const [appCount,   setAppCount]   = useState(0)
  const [docStats,   setDocStats]   = useState({ verified: 0, pending: 0 })
  const [loading,    setLoading]    = useState(true)
  const [docLoading, setDocLoading] = useState(true)
  const [stepsOpen,  setStepsOpen]  = useState(false)

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
    })
    return unsub
  }, [user?.uid])

  // Interview reminder sweep — client-side, best-effort.
  // For each upcoming interview, fire a notification at 24h and 1h before
  // the meeting. Each tier sets an idempotent flag on the application so the
  // same reminder doesn't fire twice across sessions.
  useEffect(() => {
    if (!user?.uid) return
    const run = async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'applications'),
          where('patientId', '==', user.uid),
          where('status', '==', 'interview'),
        ))
        const now = Date.now()
        for (const d of snap.docs) {
          const a = { id: d.id, ...d.data() }
          if (!a.interviewDate || !a.interviewTime) continue
          // interviewDate is YYYY-MM-DD; interviewTime is free-form
          // (e.g. "2:00 PM"). Parse the combined string.
          const target = parseInterviewMoment(a.interviewDate, a.interviewTime)
          if (!target) continue
          const msUntil = target.getTime() - now
          if (msUntil <= 0) continue   // already past

          const within24h = msUntil <= 24 * 60 * 60 * 1000 && !a.reminderSent24h
          const within1h  = msUntil <= 60 * 60 * 1000      && !a.reminderSent1h

          if (within24h) {
            await notify(user.uid, {
              type:  'interview_sched',
              title: 'Reminder: interview tomorrow',
              body:  `Your interview with ${a.agencyName} is scheduled for ${a.interviewDate} at ${a.interviewTime}. Make sure you have the Google Meet link ready.`,
              conversationId: null,
            }).catch(() => {})
            updateDoc(doc(db, 'applications', a.id), { reminderSent24h: true }).catch(() => {})
          }
          if (within1h) {
            await notify(user.uid, {
              type:  'interview_sched',
              title: 'Your interview starts soon',
              body:  `Your interview with ${a.agencyName} starts in less than an hour (${a.interviewTime}). Open it from the Interviews page.`,
              conversationId: null,
            }).catch(() => {})
            updateDoc(doc(db, 'applications', a.id), { reminderSent1h: true }).catch(() => {})
          }
        }
      } catch (err) {
        console.error('Interview reminder sweep failed:', err)
      }
    }
    run()
  }, [user?.uid])

  // Document stats
  useEffect(() => {
    if (!user?.uid) return
    getDocs(query(collection(db, 'documents'), where('patientId', '==', user.uid)))
      .then(snap => {
        const all = snap.docs.map(d => d.data())
        setDocStats({
          verified: all.filter(d => d.status === 'verified').length,
          pending:  all.filter(d => d.status === 'pending').length,
        })
        setDocLoading(false)
      })
  }, [user?.uid])

  const hasApp       = appCount > 0
  const activeStatus = activeApp?.status ?? null

  // ── Step guide ────────────────────────────────────────────────────────
  const STEPS = [
    {
      num: 1, title: 'Upload Required Documents',
      desc:   'Upload and submit required documents for pre-verification.',
      action: 'Manage →', path: '/patient/documents',
      done: docStats.verified > 0,
    },
    {
      num: 2, title: 'Find and Apply to a Program',
      desc:   'Answer a few questions to find a matching program, then submit your application.',
      action: 'Find Programs →', path: '/patient/screening',
      done: hasApp,
    },
    {
      num: 3, title: 'Wait for Agency Review',
      desc:   'The agency will review your application and documents.',
      action: 'Track →', path: '/patient/status',
      done: ['interview','approved','certificate'].includes(activeStatus),
    },
    {
      num: 4, title: 'Attend Your Interview',
      desc:   'You will be scheduled for a video interview with the agency.',
      action: 'View →', path: '/patient/interviews',
      done: ['approved','certificate'].includes(activeStatus),
    },
    {
      num: 5, title: 'Receive your Guarantee Letter',
      desc:   'Get your official Guarantee Letter — present it at the named provider for the guaranteed assistance.',
      action: null, path: null,
      done: activeStatus === 'certificate',
    },
  ]

  const doneCount      = STEPS.filter(s => s.done).length
  const currentStepNum = STEPS.find(s => !s.done)?.num ?? null

  // Only show doc section once they have docs or an active application
  const showDocSection = !docLoading && (hasApp || docStats.verified > 0 || docStats.pending > 0)

  return (
    <Layout breadcrumb={t('patient.dashboard.title')}>
      <div className="p-4 sm:p-6 space-y-4">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('patient.dashboard.subtitle', { name: firstName })}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('common.appFull')} · CRMC</p>
        </div>

        {/* Main status card */}
        {loading ? (
          <div className="card p-6 animate-pulse">
            <div className="h-6 bg-gray-100 rounded w-48 mb-3" />
            <div className="h-4 bg-gray-100 rounded w-full mb-2" />
            <div className="h-4 bg-gray-100 rounded w-3/4 mb-5" />
            <div className="h-12 bg-gray-100 rounded-xl" />
          </div>
        ) : activeApp && STATUS_CONFIG[activeApp.status] ? (() => {
          const cfg = STATUS_CONFIG[activeApp.status]
          const isAwaiting = activeApp.status === 'awaiting_info'
          return (
            <div className={`card p-5 border-2 ${cfg.border} ${cfg.bg}`}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-3xl">{cfg.emoji}</span>
                <h2 className={`text-lg font-bold ${cfg.text}`}>{cfg.label}</h2>
              </div>
              <p className={`text-sm leading-relaxed mb-4 ${cfg.subtext}`}>{cfg.desc}</p>
              {isAwaiting && activeApp.awaitingInfoMessage && (
                <div className="bg-white border border-orange-200 rounded-xl p-3 mb-4">
                  <p className="text-xs font-semibold text-orange-700 mb-1">Message from {activeApp.agencyName}:</p>
                  <p className="text-sm text-gray-700 leading-relaxed">{activeApp.awaitingInfoMessage}</p>
                </div>
              )}
              <button
                className={`w-full py-3 rounded-xl font-semibold text-sm transition-colors ${cfg.btnClass}`}
                onClick={() => navigate(cfg.path)}>
                {cfg.btn} →
              </button>
              <p className="text-xs text-center mt-2 text-gray-400">
                {activeApp.appId} · {activeApp.agencyName} · Submitted {formatDate(activeApp.submittedAt)}
              </p>
            </div>
          )
        })() : appCount > 0 ? (
          <div className="card p-5 border-2 border-red-200 bg-red-50">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl">❌</span>
              <h2 className="text-lg font-bold text-red-800">Application Not Approved</h2>
            </div>
            <p className="text-sm text-red-700 leading-relaxed mb-4">
              Your previous {appCount === 1 ? 'application was' : `${appCount} applications were`} not approved.
              You may apply again to a different program.
            </p>
            <button
              className="w-full py-3 rounded-xl font-semibold text-sm bg-brand-500 hover:bg-brand-600 text-white transition-colors"
              onClick={() => navigate('/patient/programs')}>
              Browse Programs →
            </button>
          </div>
        ) : (
          <div className="card p-5 border-2 border-brand-200 bg-brand-50">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl">👋</span>
              <h2 className="text-lg font-bold text-brand-800">Welcome to MAPA!</h2>
            </div>
            <p className="text-sm text-brand-700 leading-relaxed mb-4">
              To get started, answer a few questions to find the right medical assistance program for you.
            </p>
            <button
              className="w-full py-3 rounded-xl font-semibold text-sm bg-brand-500 hover:bg-brand-600 text-white transition-colors"
              onClick={() => navigate('/patient/screening')}>
              Find a Program →
            </button>
            <button
              className="w-full mt-2 text-xs text-brand-600 hover:text-brand-800 transition-colors text-center py-1"
              onClick={() => navigate('/patient/guide')}>
              New to MAPA? Read the User Guide →
            </button>
          </div>
        )}

        {/* Document status — prescriptive single message */}
        {showDocSection && (
          docStats.pending > 0 ? (
            <button
              className="w-full card p-4 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
              onClick={() => navigate('/patient/documents')}>
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                <MdPending size={20} className="text-amber-500" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-800">
                  {docStats.pending} document{docStats.pending !== 1 ? 's' : ''} waiting for review
                </p>
                <p className="text-xs text-gray-400 mt-0.5">Tap to manage your documents</p>
              </div>
              <MdArrowForward size={16} className="text-gray-300 flex-shrink-0" />
            </button>
          ) : docStats.verified > 0 ? (
            <div className="card p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                <MdCheckCircle size={20} className="text-green-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  {docStats.verified} verified document{docStats.verified !== 1 ? 's' : ''}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">All documents are up to date</p>
              </div>
            </div>
          ) : (
            <button
              className="w-full card p-4 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
              onClick={() => navigate('/patient/documents')}>
              <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                <MdUpload size={20} className="text-gray-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-800">No documents uploaded yet</p>
                <p className="text-xs text-gray-400 mt-0.5">Tap to upload required documents</p>
              </div>
              <MdArrowForward size={16} className="text-gray-300 flex-shrink-0" />
            </button>
          )
        )}

        {/* Step guide — collapsible */}
        <div className="card overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
            onClick={() => setStepsOpen(s => !s)}>
            <div>
              <p className="text-sm font-semibold text-gray-800">Application Steps</p>
              <p className="text-xs text-gray-400 mt-0.5">{doneCount} of {STEPS.length} steps completed</p>
            </div>
            {stepsOpen
              ? <MdExpandLess size={20} className="text-gray-400 flex-shrink-0" />
              : <MdExpandMore size={20} className="text-gray-400 flex-shrink-0" />
            }
          </button>

          {stepsOpen && (
            <div className="divide-y divide-gray-50 border-t border-gray-100">
              {STEPS.map((step) => {
                const isActive = step.num === currentStepNum
                return (
                  <div key={step.num}
                    className={`flex items-start gap-3 py-3 px-4 ${isActive ? 'bg-brand-50' : ''}`}>
                    <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium
                      ${step.done
                        ? 'bg-brand-500 text-white'
                        : isActive
                          ? 'border-2 border-brand-500 text-brand-500 bg-white'
                          : 'border-2 border-gray-200 text-gray-400'}`}>
                      {step.done ? '✓' : step.num}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${
                        step.done ? 'text-gray-800'
                        : isActive ? 'text-brand-700'
                        : 'text-gray-400'}`}>
                        {step.title}
                        {step.done   && <span className="ml-1.5 badge badge-green text-xs">Done</span>}
                        {isActive    && <span className="ml-1.5 badge badge-blue text-xs">Current</span>}
                      </p>
                      <p className={`text-xs mt-0.5 ${isActive ? 'text-brand-600' : 'text-gray-400'}`}>
                        {step.desc}
                      </p>
                    </div>
                    {step.action && step.path && (
                      <button
                        className={`flex-shrink-0 text-xs font-medium ${isActive ? 'text-brand-500' : 'text-brand-400'}`}
                        onClick={() => navigate(step.path)}>
                        {step.action}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </Layout>
  )
}
