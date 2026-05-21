import Layout from '../../components/Layout'
import { useState, useEffect } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import OutcomeModal, { OUTCOME_BADGE, OUTCOME_LABEL } from '../../components/OutcomeModal'
import {
  MdVideoCall, MdCalendarToday, MdSearch, MdOpenInNew, MdPerson,
  MdCheckCircle, MdEventBusy, MdEventRepeat,
} from 'react-icons/md'

const formatDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

const isToday = (iso) => {
  if (!iso) return false
  return iso === new Date().toISOString().slice(0, 10)
}

const isPast = (iso) => {
  if (!iso) return false
  return iso < new Date().toISOString().slice(0, 10)
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function AgencyInterviews() {
  const { user }          = useAuth()
  const [apps, setApps]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [tab, setTab]         = useState('upcoming')
  const [modal, setModal]     = useState(null)

  useEffect(() => {
    if (!user?.agencyId) return
    const q = query(
      collection(db, 'applications'),
      where('agencyId', '==', user.agencyId),
      where('status', '==', 'interview'),
    )
    const unsub = onSnapshot(q, snap => {
      setApps(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.interviewDate ?? '').localeCompare(b.interviewDate ?? ''))
      )
      setLoading(false)
    }, (err) => {
      setLoading(false)
      console.error('[Interviews] interviews snapshot error:', err)
    })
    return unsub
  }, [user?.agencyId])

  const today    = apps.filter(a => isToday(a.interviewDate) && !a.outcome)
  const upcoming = apps.filter(a => !isToday(a.interviewDate) && !isPast(a.interviewDate) && !a.outcome)
  const past     = apps.filter(a => isPast(a.interviewDate) || a.outcome)

  const tabList = { today, upcoming, past }

  const filtered = (tabList[tab] ?? []).filter(a => {
    const q = search.toLowerCase()
    return !q ||
      a.patientName?.toLowerCase().includes(q) ||
      a.appId?.toLowerCase().includes(q) ||
      a.patientContact?.includes(q)
  })

  return (
    <Layout breadcrumb="Online Interviews">
      <div className="p-4 sm:p-6">

        {/* Header */}
        <div className="mb-5">
          <h1 className="page-title">Online Interviews</h1>
          <p className="page-sub">Scheduled interviews and outcomes for your agency.</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4 mb-5">
          {[
            { label: 'Today',    value: today.length,    color: 'text-purple-600', bg: 'bg-purple-50' },
            { label: 'Upcoming', value: upcoming.length, color: 'text-brand-600',  bg: 'bg-brand-50'  },
            { label: 'Past',     value: past.length,     color: 'text-gray-500',   bg: 'bg-gray-50'   },
          ].map((m, i) => (
            <div key={i} className="card p-4">
              <p className="text-xs text-gray-400 mb-1">{m.label}</p>
              <p className={`text-3xl font-semibold ${m.color}`}>{loading ? '—' : m.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs + Search */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {[['today','Today'], ['upcoming','Upcoming'], ['past','Past']].map(([key, label]) => (
            <button key={key}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                tab === key
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
              onClick={() => setTab(key)}>
              {label}
              {!loading && tabList[key].length > 0 && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
                  tab === key ? 'bg-white/20' : 'bg-gray-100'
                }`}>
                  {tabList[key].length}
                </span>
              )}
            </button>
          ))}
          <div className="relative flex-1 min-w-48 ml-auto">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input className="input pl-9 text-sm" placeholder="Search patient name or app ID..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-gray-100 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-gray-100 rounded w-40" />
                    <div className="h-3 bg-gray-100 rounded w-56" />
                  </div>
                  <div className="h-8 bg-gray-100 rounded-lg w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center">
            <MdVideoCall size={40} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400 font-medium">
              {search ? 'No interviews match your search.' : `No ${tab} interviews.`}
            </p>
            {tab === 'upcoming' && !search && (
              <p className="text-xs text-gray-300 mt-1">
                Schedule interviews from the Application Inbox.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(app => {
              const todayMark = isToday(app.interviewDate) && !app.outcome
              const pastMark  = isPast(app.interviewDate) || app.outcome
              const recorded  = !!app.outcome
              return (
                <div key={app.id}
                  className={`card p-4 border-l-4 ${
                    todayMark ? 'border-purple-400'
                    : recorded && app.outcome === 'completed' ? 'border-green-400'
                    : recorded && app.outcome === 'no_show'    ? 'border-red-400'
                    : recorded ? 'border-amber-400'
                    : pastMark ? 'border-gray-200'
                    : 'border-brand-400'
                  }`}>
                  <div className="flex items-start gap-4 flex-wrap">

                    {/* Icon */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      todayMark ? 'bg-purple-50' : pastMark ? 'bg-gray-50' : 'bg-brand-50'
                    }`}>
                      <MdVideoCall size={20} className={
                        todayMark ? 'text-purple-500' : pastMark ? 'text-gray-400' : 'text-brand-500'
                      } />
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="text-sm font-semibold text-gray-800">{app.patientName}</p>
                        {todayMark && (
                          <span className="badge badge-purple text-xs">Today</span>
                        )}
                        {recorded && (
                          <span className={`badge text-xs ${OUTCOME_BADGE[app.outcome]}`}>
                            {OUTCOME_LABEL[app.outcome]}
                          </span>
                        )}
                        {!recorded && pastMark && (
                          <span className="badge badge-gray text-xs">Past · No outcome</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-500 mb-0.5">
                        <MdCalendarToday size={12} />
                        <span>{formatDate(app.interviewDate)} · {app.interviewTime}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        <MdPerson size={12} />
                        <span>{app.patientContact || '—'}</span>
                        <span className="mx-1 text-gray-200">·</span>
                        <span className="font-mono">{app.appId || app.id.slice(0, 10)}</span>
                        {app.conductedBy && (
                          <>
                            <span className="mx-1 text-gray-200">·</span>
                            <span>SW: {app.conductedBy}</span>
                          </>
                        )}
                      </div>
                      {app.outcomeNotes && (
                        <p className="text-xs text-gray-500 mt-2 bg-gray-50 px-2 py-1.5 rounded italic">
                          "{app.outcomeNotes}"
                        </p>
                      )}
                    </div>

                    {/* Action column: Join + Outcome buttons */}
                    <div className="flex flex-col gap-2 flex-shrink-0 items-end">
                      {app.meetLink && !recorded ? (
                        <a
                          href={app.meetLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium transition-colors ${
                            todayMark
                              ? 'bg-purple-500 text-white hover:bg-purple-600'
                              : 'bg-brand-500 text-white hover:bg-brand-600'
                          }`}>
                          <MdOpenInNew size={14} /> Join Meet
                        </a>
                      ) : !recorded && !app.meetLink ? (
                        <span className="text-xs text-gray-300">No link</span>
                      ) : null}

                      {!recorded && (
                        <div className="flex gap-1">
                          <button title="Mark Completed"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                            onClick={() => setModal({ app, outcome: 'completed' })}>
                            <MdCheckCircle size={16} />
                          </button>
                          <button title="No-Show"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            onClick={() => setModal({ app, outcome: 'no_show' })}>
                            <MdEventBusy size={16} />
                          </button>
                          <button title="Reschedule"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                            onClick={() => setModal({ app, outcome: 'rescheduled' })}>
                            <MdEventRepeat size={16} />
                          </button>
                        </div>
                      )}

                      {recorded && (
                        <button className="text-xs text-gray-400 hover:text-brand-600 underline"
                          onClick={() => setModal({ app, outcome: app.outcome })}>
                          Edit outcome
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {modal && (
          <OutcomeModal
            app={modal.app}
            outcome={modal.outcome}
            currentUser={user}
            onClose={() => setModal(null)}
          />
        )}
      </div>
    </Layout>
  )
}
