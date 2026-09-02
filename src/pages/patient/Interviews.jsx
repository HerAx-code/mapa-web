import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import ConfirmModal from '../../components/ConfirmModal'
import {
  MdVideoCall, MdCalendarToday, MdOpenInNew, MdWarning,
  MdDescription, MdChat, MdTimer, MdAssignment, MdWifi,
  MdEvent, MdApartment, MdVideocam, MdCheckCircle, MdLocationOn,
  MdConfirmationNumber,
} from 'react-icons/md'
import {
  collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { CRMC_GATEWAY_NAME, CRMC_GATEWAY_INITIALS, CRMC_GATEWAY_COLOR } from '../../utils/constants'
import {
  canBookInterview, SLOT_MODE, SLOT_STATUS, groupSlotsByDay, isFutureSlot,
} from '../../utils/appointments'
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

// Whole-day delta from today (PH local). Returns null for invalid input,
// 0 for today, positive ints for future. Used to drive the countdown chip.
const daysUntil = (iso) => {
  if (!iso) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(iso + 'T00:00:00')
  if (Number.isNaN(target.getTime())) return null
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

// Build a Google Calendar quick-add URL. Time is best-effort: we parse a
// few common time formats; if parsing fails the event becomes all-day on
// the interview date (still useful as a reminder).
const buildGcalUrl = (app) => {
  const pad = (n) => String(n).padStart(2, '0')
  const fmt = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`
  let dates
  // Try to parse "2:00 PM" / "14:00" / "2:00 pm"
  const t = String(app.interviewTime ?? '').trim()
  const m12 = t.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i)
  const m24 = t.match(/^(\d{1,2}):(\d{2})$/)
  if (m12 || m24) {
    const hh = m12 ? (parseInt(m12[1], 10) % 12) + (/pm/i.test(m12[3]) ? 12 : 0) : parseInt(m24[1], 10)
    const mm = parseInt((m12 ?? m24)[2], 10)
    // App is intended for PH (UTC+8). Build the date in local PH time then
    // emit as UTC for Google Calendar.
    const start = new Date(`${app.interviewDate}T${pad(hh)}:${pad(mm)}:00+08:00`)
    const end   = new Date(start.getTime() + 60 * 60 * 1000) // 1h default
    dates = `${fmt(start)}/${fmt(end)}`
  } else {
    // All-day fallback
    const d = app.interviewDate.replace(/-/g, '')
    dates = `${d}/${d}`
  }
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text:   'MAPA Assessment Interview · CRMC',
    dates,
    details: app.meetLink ? `Google Meet: ${app.meetLink}` : '',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

// ── Booking picker — shown when CRMC has opened booking and nothing is booked
// yet. Day tabs → open-time chips → confirm. Real <button>s (native keyboard),
// ≥44px targets, an explicit timezone note. Bilingual via t().
function BookingPicker({ slots, onBook, booking }) {
  const { t } = useTranslation()
  const days = useMemo(() => groupSlotsByDay(slots), [slots])
  const [dayIdx, setDayIdx] = useState(0)
  const [selectedId, setSelectedId] = useState(null)

  if (days.length === 0) {
    return (
      <div className="card p-6 text-center">
        <MdCalendarToday size={28} className="text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">{t('patient.interviews.booking.noSlots')}</p>
      </div>
    )
  }

  const day       = days[Math.min(dayIdx, days.length - 1)]
  const selected  = day.slots.find(s => s.id === selectedId) ?? null
  const selMode   = selected?.mode ?? day.slots[0]?.mode ?? SLOT_MODE.IN_PERSON
  const online    = selMode === SLOT_MODE.ONLINE
  const ModeIcon  = online ? MdVideocam : MdApartment

  return (
    <div className="card p-5 space-y-4">
      <div>
        <p className="eyebrow">{t('patient.interviews.booking.eyebrow')}</p>
        <h2 className="text-lg font-bold text-gray-900 mt-1">{t('patient.interviews.booking.title')}</h2>
        <p className="text-sm text-gray-500 mt-1">{t('patient.interviews.booking.subtitle')}</p>
      </div>

      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
        online ? 'bg-blue-50 text-blue-700' : 'bg-brand-50 text-brand-700'
      }`}>
        <ModeIcon size={14} /> {online ? t('patient.interviews.booking.modeOnline') : t('patient.interviews.booking.modeInPerson')}
      </span>

      {/* Day tabs */}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1.5">{t('patient.interviews.booking.chooseDay')}</p>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label={t('patient.interviews.booking.chooseDay')}>
          {days.map((d, i) => {
            const on = i === Math.min(dayIdx, days.length - 1)
            const dd = new Date(`${d.date}T12:00:00+08:00`)
            return (
              <button key={d.date} type="button" role="tab" aria-selected={on}
                onClick={() => { setDayIdx(i); setSelectedId(null) }}
                className={`flex-shrink-0 min-w-[64px] min-h-[44px] rounded-xl border px-3 py-1.5 text-center transition-colors ${
                  on ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-brand-300'
                }`}>
                <span className="block text-base font-bold leading-tight">{dd.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', day: 'numeric' })}</span>
                <span className="block text-[11px]">{dd.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', weekday: 'short' })}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Open time chips */}
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1.5">{t('patient.interviews.booking.openTimes')}</p>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('patient.interviews.booking.openTimes')}>
          {day.slots.map(s => {
            const on = s.id === selectedId
            return (
              <button key={s.id} type="button" aria-pressed={on}
                onClick={() => setSelectedId(s.id)}
                className={`min-h-[44px] rounded-lg border text-sm font-medium tabular-nums transition-colors ${
                  on ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-gray-200 text-gray-700 hover:border-brand-300'
                }`}>
                {s.time}
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-gray-400 mt-2">{t('patient.interviews.booking.timezoneNote')}</p>
      </div>

      {/* Confirm */}
      {selected && (
        <div className="border-t border-gray-100 pt-3" aria-live="polite">
          <p className="text-sm text-gray-700 mb-1">{t('patient.interviews.booking.selected', { time: selected.time, date: day.label })}</p>
          <p className="text-xs text-gray-400 mb-3 leading-relaxed">{t('patient.interviews.booking.congestionNote')}</p>
          <button type="button" onClick={() => onBook(selected)} disabled={booking}
            className="btn-primary w-full min-h-[44px] flex items-center justify-center gap-1.5">
            {booking ? t('patient.interviews.booking.confirming') : t('patient.interviews.booking.confirmBtn')}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Booked appointment — rendered from the patient's own booked slot, so it
// works even before the server-side request sync (Phase 2). In-person shows the
// slip (office, queue, what-to-bring); online shows the Meet card.
function BookedAppointment({ slot, onReschedule, rescheduling }) {
  const { t } = useTranslation()
  const online = slot.mode === SLOT_MODE.ONLINE
  return (
    <div className="space-y-4">
      <div className="card-hero">
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-200">{t('patient.interviews.booking.yourAppointment')}</p>
              <p className="mt-2 text-2xl sm:text-[28px] font-bold tracking-tight text-white">{fmtDate(slot.date)}</p>
              <p className="mt-0.5 text-sm text-brand-100">{t('patient.interviews.atTime', { time: slot.time })}</p>
            </div>
            <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full bg-white/15 text-white text-xs font-semibold px-2.5 py-1">
              {online ? <MdVideocam size={13} /> : <MdApartment size={13} />}
              {online ? t('patient.interviews.booking.modeOnline') : t('patient.interviews.booking.modeInPerson')}
            </span>
          </div>
          {online && (
            slot.meetLink ? (
              <a href={slot.meetLink} target="_blank" rel="noopener noreferrer"
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-brand-800 hover:bg-brand-50 transition-colors min-h-[44px]">
                <MdVideoCall size={18} /> {t('patient.interviews.joinBtn')} <MdOpenInNew size={13} />
              </a>
            ) : (
              <div className="mt-5 inline-block rounded-lg bg-white/10 px-4 py-2.5 text-sm text-brand-100">{t('patient.interviews.noLink')}</div>
            )
          )}
        </div>
      </div>

      {online ? (
        <div className="card p-5">
          <p className="text-sm text-gray-600 leading-relaxed">{t('patient.interviews.booking.onlineNote')}</p>
          <p className="text-xs text-gray-500 mt-2">{t('patient.interviews.meetHint')}</p>
        </div>
      ) : (
        <div className="card p-5 space-y-3">
          <div className="flex items-start gap-2">
            <MdLocationOn size={18} className="text-brand-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-gray-700">{t('patient.interviews.booking.office')}</p>
          </div>
          <div className="flex items-center gap-2">
            <MdConfirmationNumber size={18} className="text-brand-500 flex-shrink-0" />
            <p className="text-sm text-gray-700">
              {slot.queueNo
                ? t('patient.interviews.booking.queueNo', { no: slot.queueNo })
                : t('patient.interviews.booking.queuePending')}
            </p>
          </div>
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-600 mb-2">{t('patient.interviews.booking.bring')}</p>
            {['bring1', 'bring2', 'bring3'].map(k => (
              <p key={k} className="flex items-start gap-2 text-sm text-gray-600 mb-1 last:mb-0">
                <MdCheckCircle size={14} className="text-brand-400 flex-shrink-0 mt-0.5" />
                <span>{t(`patient.interviews.booking.${k}`)}</span>
              </p>
            ))}
          </div>
          <p className="text-xs text-gray-500">{t('patient.interviews.booking.joinNote')}</p>
        </div>
      )}

      <button type="button" onClick={onReschedule} disabled={rescheduling}
        className="btn-secondary w-full min-h-[44px]">
        {rescheduling ? t('patient.interviews.booking.rescheduling') : t('patient.interviews.booking.reschedule')}
      </button>
    </div>
  )
}

export default function Interviews() {
  const { t }                       = useTranslation()
  const { user }                    = useAuth()
  const navigate                    = useNavigate()
  const [interviews,           setInterviews]           = useState([])
  const [loading,              setLoading]              = useState(true)
  const [hasActiveApp,         setHasActiveApp]         = useState(false)
  const [hasCompletedInterview, setHasCompletedInterview] = useState(false)
  // Self-service booking (Phase 4): the active request drives the booking gate;
  // the patient's own booked slot renders the appointment (slip / Meet) even
  // before the server-side request sync; open slots feed the picker.
  const [activeRequest, setActiveRequest] = useState(null)
  const [bookedSlot,    setBookedSlot]    = useState(null)
  const [openSlots,     setOpenSlots]     = useState([])
  const [booking,       setBooking]       = useState(false)
  const [confirmReschedule, setConfirmReschedule] = useState(false)
  const [rescheduling,  setRescheduling]  = useState(false)
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
    // The single assessment interview now lives on the patient's co-funding
    // request (conducted by CRMC), not on per-agency applications.
    const unsub = onSnapshot(
      query(collection(db, 'requests'), where('patientId', '==', user.uid)),
      snap => {
        const reqs   = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        const active = reqs.find(r => !['closed', 'rejected', 'fully_funded'].includes(r.status)) ?? null
        setActiveRequest(active)
        setHasActiveApp(!!active)
        setHasCompletedInterview(reqs.some(r => r.interviewOutcome === 'completed'))

        const list = []
        if (active?.interviewDate && !['completed', 'no_show'].includes(active.interviewOutcome)) {
          list.push({
            id:             active.id,
            appId:          active.requestId,
            // CRMC is the assessment-interview gateway under the redesign
            // (single interview per request, not per agency). Branding
            // sourced from utils/constants so a rename or multi-hospital
            // rollout doesn't need an edit in every interview surface.
            agencyName:     CRMC_GATEWAY_NAME,
            agencyInitials: CRMC_GATEWAY_INITIALS,
            agencyColor:    CRMC_GATEWAY_COLOR,
            interviewDate:  active.interviewDate,
            interviewTime:  active.interviewTime,
            meetLink:       active.meetLink,
            conductedBy:    active.conductedBy,
          })
        }
        setInterviews(list)
        setLoading(false)
      },
      () => { toast.error(t('patient.interviews.loadError')); setLoading(false) },
    )
    return unsub
  }, [user?.uid])

  // The patient's own booked slot (rules allow reading a booked slot you hold).
  // This is what renders the appointment straight after booking, before the
  // Phase-2 Cloud Function syncs the interview onto the request.
  useEffect(() => {
    if (!user?.uid) return
    const unsub = onSnapshot(
      query(collection(db, 'interviewSlots'),
        where('patientId', '==', user.uid),
        where('status', '==', SLOT_STATUS.BOOKED)),
      snap => setBookedSlot(snap.docs.map(d => ({ id: d.id, ...d.data() }))[0] ?? null),
      (err) => console.error('[Interviews] booked-slot snapshot error:', err),
    )
    return unsub
  }, [user?.uid])

  // Booking is open when CRMC has flagged this request AND nothing is booked or
  // assigned yet. canBookInterview() also guards terminal/concluded states.
  const canBook = !!(activeRequest && canBookInterview(activeRequest) &&
    !activeRequest.interviewDate && !bookedSlot)

  // Only subscribe to the open-slot list while the picker is actually shown.
  useEffect(() => {
    if (!canBook) { setOpenSlots([]); return }
    const unsub = onSnapshot(
      query(collection(db, 'interviewSlots'), where('status', '==', SLOT_STATUS.OPEN)),
      snap => setOpenSlots(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => isFutureSlot(s))),
      (err) => console.error('[Interviews] open-slots snapshot error:', err),
    )
    return unsub
  }, [canBook])

  // Book an open slot: open → booked, stamping only the booking fields the
  // isBooking() rule permits. The rule's status=='open' precondition is the
  // compare-and-set, so a lost race surfaces as permission-denied.
  const handleBook = async (slot) => {
    if (!activeRequest || booking) return
    setBooking(true)
    try {
      await updateDoc(doc(db, 'interviewSlots', slot.id), {
        status:    SLOT_STATUS.BOOKED,
        patientId: user.uid,
        requestId: activeRequest.id,
        bookedAt:  serverTimestamp(),
      })
      toast.success(t('patient.interviews.booking.booked'))
    } catch (err) {
      console.error('[Interviews] book error:', err)
      if (err?.code === 'permission-denied') toast.error(t('patient.interviews.booking.taken'))
      else toast.error(t('patient.interviews.booking.bookError'))
    } finally {
      setBooking(false)
    }
  }

  // Reschedule = release the slot (booked → open) and let the picker reappear.
  const performReschedule = async () => {
    if (!bookedSlot || rescheduling) return
    setRescheduling(true)
    try {
      await updateDoc(doc(db, 'interviewSlots', bookedSlot.id), {
        status:    SLOT_STATUS.OPEN,
        patientId: null,
        requestId: null,
        updatedAt: serverTimestamp(),
      })
      toast.success(t('patient.interviews.booking.rescheduled'))
      setConfirmReschedule(false)
    } catch (err) {
      console.error('[Interviews] reschedule error:', err)
      toast.error(t('patient.interviews.booking.rescheduleError'))
    } finally {
      setRescheduling(false)
    }
  }

  return (
    <Layout breadcrumb={t('patient.interviews.title')}>
      {/* Hard viewport cap so long agency names or app IDs can't push
          the page wider than the phone screen. */}
      <div className="px-3 py-4 sm:p-6 mx-auto w-full max-w-[100vw] sm:max-w-3xl overflow-x-clip">

        <div className="w-full mb-5">
          <p className="eyebrow">{t('patient.interviews.eyebrow')}</p>
          <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">{t('patient.interviews.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('patient.interviews.subtitle')}</p>
        </div>

        {/* Skeleton loading */}
        {loading && (
          <div className="card p-5 w-full animate-pulse">
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

        {/* Booked appointment — rendered from the patient's own slot */}
        {!loading && bookedSlot && (
          <div className="w-full">
            <BookedAppointment
              slot={bookedSlot}
              onReschedule={() => setConfirmReschedule(true)}
              rescheduling={rescheduling}
            />
          </div>
        )}

        {/* Booking picker — when CRMC has opened booking and nothing is booked */}
        {!loading && !bookedSlot && canBook && (
          <div className="w-full">
            <BookingPicker slots={openSlots} onBook={handleBook} booking={booking} />
          </div>
        )}

        {/* Interview cards (CRMC-assigned interview on the request) */}
        {!loading && !bookedSlot && !canBook && interviews.length > 0 && (
          <div className="space-y-4 w-full">
            {interviews.map(app => {
              const isPast  = isPastDate(app.interviewDate)
              // Anchor "today" to PH local time. The previous toISOString()
              // returns UTC, so an interview scheduled for today PH was
              // mis-classified as "not today" between midnight UTC and PH-
              // midnight (8 hours every morning). en-CA gives the YYYY-MM-DD
              // format we already compare against interviewDate.
              const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
              const isToday  = app.interviewDate === todayStr
              return (
              isPast ? (
                /* ── Past interview — plain card ── */
                <div key={app.id} className="card p-5">
                  <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-50">
                    <div className={`w-10 h-10 ${app.agencyColor ?? 'bg-gray-400'} rounded-xl text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}>
                      {app.agencyInitials ?? app.agencyName?.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-sm font-semibold text-gray-800 truncate">{app.agencyName}</h2>
                      <p className="text-xs text-gray-500 truncate">{app.appId}</p>
                    </div>
                    <span className="badge badge-red flex-shrink-0">{t('patient.interviews.datePassedBadge')}</span>
                  </div>
                  <div className="flex items-center gap-2 mb-4 text-sm flex-wrap">
                    <MdCalendarToday size={16} className="text-red-400" />
                    <strong className="text-red-500">{fmtDate(app.interviewDate)}</strong>
                    {app.interviewTime && <span className="text-gray-600">{t('patient.interviews.atTime', { time: app.interviewTime })}</span>}
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <div className="flex items-start gap-2 mb-2">
                      <MdWarning size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-amber-700">{t('patient.interviews.pastWarning')}</p>
                    </div>
                    <button
                      className="w-full sm:w-auto inline-flex items-center justify-center min-h-[44px] text-sm bg-amber-500 hover:bg-amber-600 text-white px-4 rounded-lg font-medium transition-colors"
                      onClick={() => navigate('/patient/messages')}>
                      {t('patient.interviews.messageCrmc')} →
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Upcoming interview — dark event hero + a light "what to
                    expect" card. The interview is the single most time-
                    sensitive event in the journey, so it gets the hero. ── */
                <div key={app.id} className="space-y-4">
                  <div className={`card-hero ${isToday ? 'ring-2 ring-brand-300' : ''}`}>
                    <div className="p-5 sm:p-6">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wider text-brand-200">{t('patient.interviews.heroEyebrow')}</p>
                          <p className="mt-2 text-2xl sm:text-[28px] font-bold tracking-tight text-white">{fmtDate(app.interviewDate)}</p>
                          {app.interviewTime && <p className="mt-0.5 text-sm text-brand-100">{t('patient.interviews.atTime', { time: app.interviewTime })}</p>}
                          {app.conductedBy && <p className="mt-1 text-sm text-brand-200">{t('patient.interviews.conductedBy', { name: app.conductedBy })}</p>}
                        </div>
                        {isToday
                          ? <span className="badge badge-amber text-xs font-bold flex-shrink-0">{t('patient.interviews.todayBadge')}</span>
                          : (() => {
                              const d = daysUntil(app.interviewDate)
                              if (d == null || d <= 0 || d > 7) return null
                              return <span className="flex-shrink-0 rounded-full bg-white/15 text-white text-xs font-semibold px-2.5 py-1">{d === 1 ? t('patient.interviews.tomorrow') : t('patient.interviews.inDays', { count: d })}</span>
                            })()}
                      </div>

                      {app.meetLink ? (
                        <a href={app.meetLink} target="_blank" rel="noopener noreferrer"
                          className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-brand-800 hover:bg-brand-50 transition-colors">
                          <MdVideoCall size={18} /> {t('patient.interviews.joinBtn')} <MdOpenInNew size={13} />
                        </a>
                      ) : (
                        <div className="mt-5 inline-block rounded-lg bg-white/10 px-4 py-2.5 text-sm text-brand-100">{t('patient.interviews.noLink')}</div>
                      )}
                      <a href={buildGcalUrl(app)} target="_blank" rel="noopener noreferrer"
                        className="mt-3 flex w-fit items-center gap-1 text-sm text-brand-200 hover:text-white transition-colors">
                        <MdEvent size={14} /> {t('patient.interviews.addToCalendar')}
                      </a>
                    </div>
                  </div>

                  {/* What to expect */}
                  <div className="card p-5">
                    <p className="text-xs text-gray-500 mb-2">{app.agencyName} · {app.appId}</p>
                    <p className="text-sm text-gray-500 leading-relaxed">{t('patient.interviews.joinIntro')}</p>
                    <button
                      className="mt-2 inline-flex items-center min-h-[44px] text-sm text-brand-500 hover:text-brand-600 font-medium gap-1"
                      onClick={() => togglePrep(app.id)}>
                      {expandedPrep.has(app.id)
                        ? `${t('patient.interviews.hideDetails')} ↑`
                        : `${t('patient.interviews.whatToExpect')} ↓`}
                    </button>
                    {expandedPrep.has(app.id) && (
                      <div className="mt-3 bg-gray-50 rounded-xl p-4 space-y-2 text-sm text-gray-600 border border-gray-100">
                        {[
                          { Icon: MdDescription, key: 'documents' },
                          { Icon: MdChat,        key: 'questions' },
                          { Icon: MdTimer,       key: 'duration'  },
                          { Icon: MdAssignment,  key: 'decision'  },
                          { Icon: MdWifi,        key: 'internet'  },
                        ].map(({ Icon, key }) => (
                          <p key={key} className="flex items-start gap-2">
                            <Icon size={14} className="text-brand-400 flex-shrink-0 mt-0.5" />
                            <span>{t(`patient.interviews.prep.${key}`)}</span>
                          </p>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-gray-500 mt-3">{t('patient.interviews.meetHint')}</p>
                  </div>
                </div>
              )
            )})}
          </div>
        )}

        {/* Empty state — context-aware */}
        {!loading && !bookedSlot && !canBook && interviews.length === 0 && (
          <div className="card p-8 max-w-md mx-auto text-center">
            <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <MdVideoCall size={28} className="text-gray-500" />
            </div>
            {hasCompletedInterview ? (
              <>
                <h2 className="text-base font-semibold text-gray-700 mb-1">{t('patient.interviews.empty.completedTitle')}</h2>
                <p className="text-sm text-gray-500 mb-5 leading-relaxed">
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
                <p className="text-sm text-gray-500 mb-5 leading-relaxed">
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
                <p className="text-sm text-gray-500 mb-5 leading-relaxed">
                  {t('patient.interviews.empty.noAppDesc')}
                </p>
                <button className="btn-primary text-sm mx-auto"
                  onClick={() => navigate('/patient/request')}>
                  {t('patient.nav.requestAssistance')} →
                </button>
              </>
            )}
          </div>
        )}

      </div>

      <ConfirmModal
        open={confirmReschedule}
        onClose={() => !rescheduling && setConfirmReschedule(false)}
        onConfirm={performReschedule}
        title={t('patient.interviews.booking.rescheduleConfirm')}
        tone="warning"
        confirmLabel={t('patient.interviews.booking.reschedule')}
        confirmLabelBusy={t('patient.interviews.booking.rescheduling')}
      />
    </Layout>
  )
}
