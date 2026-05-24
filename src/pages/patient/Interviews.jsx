import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import { MdVideoCall, MdCalendarToday, MdOpenInNew, MdWarning } from 'react-icons/md'
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'

const fmtDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

const isPastDate = (iso) => {
  if (!iso) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(iso + 'T00:00:00') < today
}

export default function Interviews() {
  const { t }                       = useTranslation()
  const { user }                    = useAuth()
  const navigate                    = useNavigate()
  const [interviews,           setInterviews]           = useState([])
  const [loading,              setLoading]              = useState(true)
  const [hasActiveApp,         setHasActiveApp]         = useState(false)
  const [hasCompletedInterview, setHasCompletedInterview] = useState(false)
  // Per-card prep panel state — keyed by application id so multiple
  // interviews can expand/collapse independently.
  const [expandedPrep,         setExpandedPrep]         = useState(new Set())
  const togglePrep = (id) => setExpandedPrep(p => {
    const next = new Set(p)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  useEffect(() => {
    if (!user?.uid) return
    const q = query(
      collection(db, 'applications'),
      where('patientId', '==', user.uid),
      where('status', '==', 'interview')
    )
    // Check if patient has any active application for context-aware empty state
    getDocs(query(
      collection(db, 'applications'),
      where('patientId', '==', user.uid),
    )).then(snap => {
      const all = snap.docs.map(d => d.data())
      setHasActiveApp(all.some(d =>
        !['rejected', 'certificate'].includes(d.status)
      ))
      // Detect if patient recently went through an interview (has interviewDate + post-interview status)
      setHasCompletedInterview(all.some(d =>
        d.interviewDate && ['approved', 'rejected', 'certificate'].includes(d.status)
      ))
    })

    const unsub = onSnapshot(q,
      snap => {
        setInterviews(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setLoading(false)
      },
      () => {
        toast.error(t('patient.interviews.loadError'))
        setLoading(false)
      }
    )
    return unsub
  }, [user?.uid])

  return (
    <Layout breadcrumb={t('patient.interviews.title')}>
      <div className="p-4 sm:p-6">

        <div className="max-w-2xl mx-auto mb-5">
          <h1 className="page-title">{t('patient.interviews.title')}</h1>
          <p className="page-sub">{t('patient.interviews.subtitle')}</p>
        </div>

        {/* Skeleton loading */}
        {loading && (
          <div className="card p-5 max-w-2xl mx-auto animate-pulse">
            <div className="flex gap-3 mb-4 pb-4 border-b border-gray-50">
              <div className="w-10 h-10 bg-gray-100 rounded-xl" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-100 rounded w-32" />
                <div className="h-2 bg-gray-100 rounded w-24" />
              </div>
            </div>
            <div className="h-4 bg-gray-100 rounded w-48 mb-5" />
            <div className="h-11 bg-gray-100 rounded-xl" />
          </div>
        )}

        {/* Interview cards */}
        {!loading && interviews.length > 0 && (
          <div className="space-y-4 max-w-2xl mx-auto">
            {interviews.map(app => {
              const isPast  = isPastDate(app.interviewDate)
              const todayStr = new Date().toISOString().split('T')[0]
              const isToday  = app.interviewDate === todayStr
              return (
              <div key={app.id} className={`card p-5 ${isToday ? 'border-2 border-brand-400' : ''}`}>
                {/* Agency header */}
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-50">
                  <div className={`w-10 h-10 ${app.agencyColor ?? 'bg-gray-400'} rounded-xl text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}>
                    {app.agencyInitials ?? app.agencyName?.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-800">{app.agencyName}</h2>
                    <p className="text-xs text-gray-400">{app.appId}</p>
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    {isToday && (
                      <span className="badge badge-amber text-xs font-bold">{t('patient.interviews.todayBadge')}</span>
                    )}
                    <span className={`badge ${isPast ? 'badge-red' : 'badge-purple'}`}>
                      {isPast ? t('patient.interviews.datePassedBadge') : t('patient.interviews.scheduledBadge')}
                    </span>
                  </div>
                </div>

                {/* Past interview warning */}
                {isPast && (
                  <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2 flex-1">
                      <MdWarning size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-amber-700">
                        {t('patient.interviews.pastWarning')}
                      </p>
                    </div>
                    <button
                      className="flex-shrink-0 text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                      onClick={() => navigate('/patient/messages')}>
                      {t('patient.interviews.messageAgency')} →
                    </button>
                  </div>
                )}

                {/* Date & time */}
                <div className="flex items-center gap-2 mb-1 text-sm text-gray-700">
                  <MdCalendarToday size={16} className={isPast ? 'text-red-400' : isToday ? 'text-brand-500' : 'text-brand-500'} />
                  <strong className={isPast ? 'text-red-500' : isToday ? 'text-brand-600' : ''}>
                    {fmtDate(app.interviewDate)}
                  </strong>
                  {app.interviewTime && <span>{t('patient.interviews.atTime', { time: app.interviewTime })}</span>}
                </div>

                {!isPast && (
                  <>
                    <p className="text-sm text-gray-500 mt-2 leading-relaxed">
                      {t('patient.interviews.joinIntro')}
                    </p>
                    <button
                      className="mt-2 text-sm text-brand-500 hover:text-brand-600 font-medium flex items-center gap-1"
                      onClick={() => togglePrep(app.id)}>
                      {expandedPrep.has(app.id)
                        ? `${t('patient.interviews.hideDetails')} ↑`
                        : `${t('patient.interviews.whatToExpect')} ↓`}
                    </button>
                    {expandedPrep.has(app.id) && (
                      <div className="mt-3 bg-gray-50 rounded-xl p-4 space-y-2 text-sm text-gray-600 border border-gray-100">
                        <p>{t('patient.interviews.prep.documents')}</p>
                        <p>{t('patient.interviews.prep.questions')}</p>
                        <p>{t('patient.interviews.prep.duration')}</p>
                        <p>{t('patient.interviews.prep.decision')}</p>
                        <p>{t('patient.interviews.prep.internet')}</p>
                      </div>
                    )}
                  </>
                )}

                {!isPast && (app.meetLink ? (
                  <a
                    href={app.meetLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-sm mt-4">
                    <MdVideoCall size={18} />
                    {t('patient.interviews.joinBtn')}
                    <MdOpenInNew size={14} />
                  </a>
                ) : (
                  <div className="w-full py-3 rounded-xl bg-gray-100 text-center text-sm text-gray-400 mt-4">
                    {t('patient.interviews.noLink')}
                  </div>
                ))}

                {!isPast && (
                  <p className="text-xs text-gray-400 text-center mt-3">
                    {t('patient.interviews.meetHint')}
                  </p>
                )}
              </div>
            )})}
          </div>
        )}

        {/* Empty state — context-aware */}
        {!loading && interviews.length === 0 && (
          <div className="card p-8 max-w-md mx-auto text-center">
            <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <MdVideoCall size={28} className="text-gray-400" />
            </div>
            {hasCompletedInterview ? (
              <>
                <h2 className="text-base font-semibold text-gray-700 mb-1">{t('patient.interviews.empty.completedTitle')}</h2>
                <p className="text-sm text-gray-400 mb-5 leading-relaxed">
                  {t('patient.interviews.empty.completedDesc')}
                </p>
                <button className="btn-primary text-sm flex items-center gap-1.5 mx-auto"
                  onClick={() => navigate('/patient/status')}>
                  {t('patient.interviews.empty.completedBtn')} →
                </button>
              </>
            ) : hasActiveApp ? (
              <>
                <h2 className="text-base font-semibold text-gray-700 mb-1">{t('patient.interviews.empty.notYetTitle')}</h2>
                <p className="text-sm text-gray-400 mb-5 leading-relaxed">
                  {t('patient.interviews.empty.notYetDesc')}
                </p>
                <button className="btn-secondary text-sm mx-auto"
                  onClick={() => navigate('/patient/status')}>
                  {t('patient.interviews.empty.notYetBtn')} →
                </button>
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold text-gray-700 mb-1">{t('patient.interviews.empty.noAppTitle')}</h2>
                <p className="text-sm text-gray-400 mb-5 leading-relaxed">
                  {t('patient.interviews.empty.noAppDesc')}
                </p>
                <button className="btn-primary text-sm mx-auto"
                  onClick={() => navigate('/patient/screening')}>
                  {t('patient.interviews.empty.noAppBtn')} →
                </button>
              </>
            )}
          </div>
        )}

      </div>
    </Layout>
  )
}
