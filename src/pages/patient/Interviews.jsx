import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import { MdVideoCall, MdCalendarToday, MdOpenInNew, MdArrowBack, MdWarning } from 'react-icons/md'
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
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
  const { user }                    = useAuth()
  const navigate                    = useNavigate()
  const [interviews,           setInterviews]           = useState([])
  const [loading,              setLoading]              = useState(true)
  const [hasActiveApp,         setHasActiveApp]         = useState(false)
  const [hasCompletedInterview, setHasCompletedInterview] = useState(false)
  const [showPrep,             setShowPrep]             = useState(false)

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
        toast.error('Could not load interview details. Please refresh.')
        setLoading(false)
      }
    )
    return unsub
  }, [user?.uid])

  return (
    <Layout breadcrumb="My Interview">
      <div className="p-4 sm:p-6">

        <div className="max-w-lg mx-auto mb-5">
          <h1 className="page-title">My Interview</h1>
          <p className="page-sub">Join your scheduled video interview with the agency.</p>
        </div>

        {/* Skeleton loading */}
        {loading && (
          <div className="card p-5 max-w-lg mx-auto animate-pulse">
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
          <div className="space-y-4 max-w-lg mx-auto">
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
                      <span className="badge badge-amber text-xs font-bold">Today!</span>
                    )}
                    <span className={`badge ${isPast ? 'badge-red' : 'badge-purple'}`}>
                      {isPast ? 'Date Passed' : 'Scheduled'}
                    </span>
                  </div>
                </div>

                {/* Past interview warning */}
                {isPast && (
                  <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2 flex-1">
                      <MdWarning size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-amber-700">
                        This interview date has passed. Message the agency for an update on your status.
                      </p>
                    </div>
                    <button
                      className="flex-shrink-0 text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                      onClick={() => navigate('/patient/messages')}>
                      Message Agency →
                    </button>
                  </div>
                )}

                {/* Date & time */}
                <div className="flex items-center gap-2 mb-1 text-sm text-gray-700">
                  <MdCalendarToday size={16} className={isPast ? 'text-red-400' : isToday ? 'text-brand-500' : 'text-brand-500'} />
                  <strong className={isPast ? 'text-red-500' : isToday ? 'text-brand-600' : ''}>
                    {fmtDate(app.interviewDate)}
                  </strong>
                  {app.interviewTime && <span>at <strong>{app.interviewTime}</strong></span>}
                </div>

                {!isPast && (
                  <>
                    <p className="text-sm text-gray-500 mt-2 leading-relaxed">
                      Please join the video call on time. Make sure your camera and microphone are working before the interview.
                    </p>
                    <button
                      className="mt-2 text-sm text-brand-500 hover:text-brand-600 font-medium flex items-center gap-1"
                      onClick={() => setShowPrep(p => !p)}>
                      {showPrep ? 'Hide details ↑' : 'What to expect in the interview ↓'}
                    </button>
                    {showPrep && (
                      <div className="mt-3 bg-gray-50 rounded-xl p-4 space-y-2 text-sm text-gray-600 border border-gray-100">
                        <p>📄 Have your verified documents ready to show if asked.</p>
                        <p>💬 Expect questions about your medical situation and financial need.</p>
                        <p>⏱ The interview typically takes 15–20 minutes.</p>
                        <p>📋 A decision will be communicated to you after the review.</p>
                        <p>📶 Make sure you have a stable internet connection.</p>
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
                    Join Video Interview
                    <MdOpenInNew size={14} />
                  </a>
                ) : (
                  <div className="w-full py-3 rounded-xl bg-gray-100 text-center text-sm text-gray-400 mt-4">
                    Meeting link not yet provided
                  </div>
                ))}

                {!isPast && (
                  <p className="text-xs text-gray-400 text-center mt-3">
                    Video call via Google Meet · No account needed · Opens in a new tab
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
                <h2 className="text-base font-semibold text-gray-700 mb-1">Interview Complete</h2>
                <p className="text-sm text-gray-400 mb-5 leading-relaxed">
                  Your interview has been completed. Check My Application to see the outcome of your application.
                </p>
                <button className="btn-primary text-sm flex items-center gap-1.5 mx-auto"
                  onClick={() => navigate('/patient/status')}>
                  View My Application →
                </button>
              </>
            ) : hasActiveApp ? (
              <>
                <h2 className="text-base font-semibold text-gray-700 mb-1">No Interview Scheduled Yet</h2>
                <p className="text-sm text-gray-400 mb-5 leading-relaxed">
                  Once the agency reviews your application and approves it, they will schedule a video interview and you will be notified.
                </p>
                <button className="btn-secondary text-sm flex items-center gap-1.5 mx-auto"
                  onClick={() => navigate('/patient/status')}>
                  <MdArrowBack size={15} /> View My Application
                </button>
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold text-gray-700 mb-1">No Application Yet</h2>
                <p className="text-sm text-gray-400 mb-5 leading-relaxed">
                  You need to apply for a medical assistance program first. Interviews are scheduled after your application is reviewed and approved.
                </p>
                <button className="btn-primary text-sm mx-auto"
                  onClick={() => navigate('/patient/screening')}>
                  Find a Program →
                </button>
              </>
            )}
          </div>
        )}

      </div>
    </Layout>
  )
}
