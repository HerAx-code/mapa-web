import Layout from '../../components/Layout'
import ConfirmModal from '../../components/ConfirmModal'
import { useState, useEffect, useMemo } from 'react'
import {
  collection, query, where, orderBy, onSnapshot,
  doc, writeBatch, deleteDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { logAudit } from '../../utils/auditLog'
import {
  SLOT_MODE, SLOT_STATUS, DEFAULT_WINDOWS, generateSlots, groupSlotsByDay,
} from '../../utils/appointments'
import { phTodayKey } from '../../utils/dates'
import {
  MdApartment, MdVideocam, MdAdd, MdClose, MdEventAvailable,
} from 'react-icons/md'
import toast from 'react-hot-toast'

// CRMC availability publisher (Phase 3 of the interview-appointment system).
// Publishes bookable `interviewSlots` from the weekly template, day-grouped,
// each slot tagged in-person (default) or online (the Google Meet fallback).
// Admin writes only — create/delete/update are all isAdmin() in the rules, so
// no rules change is needed. See docs/appointment-system-plan.md.

const RANGE_OPTIONS = [
  { days: 7,  label: 'Next week' },
  { days: 14, label: 'Next 2 weeks' },
  { days: 30, label: 'Next 30 days' },
]

const MODE_META = {
  [SLOT_MODE.IN_PERSON]: { label: 'In person', short: 'In person', Icon: MdApartment,
    chip: 'bg-brand-50 text-brand-700 border-brand-200', dot: 'bg-brand-500' },
  [SLOT_MODE.ONLINE]:    { label: 'Online (Meet)', short: 'Online', Icon: MdVideocam,
    chip: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
}

// A stable key for a slot's time position, used to dedupe against what's
// already published so re-generating the same window doesn't create doubles.
const slotKey = (s) => `${s.date}_${s.startMin}`

const fmtDayLabel = (dateKey) =>
  new Date(`${dateKey}T12:00:00+08:00`).toLocaleDateString('en-US', {
    timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric',
  })

export default function AdminInterviews() {
  const { user } = useAuth()
  const [slots, setSlots]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [rangeDays, setRangeDays] = useState(14)
  const [genMode, setGenMode]   = useState(SLOT_MODE.IN_PERSON)
  const [preview, setPreview]   = useState(null)   // generated, not yet published
  const [publishing, setPublishing] = useState(false)
  const [busyDay, setBusyDay]   = useState(null)   // dateKey being mode-flipped
  const [confirmFlipAll, setConfirmFlipAll] = useState(null) // target mode or null
  const [flippingAll, setFlippingAll] = useState(false)

  // Live published slots from start-of-today (PH) forward — bounded so the
  // page never reads the whole history. Admin read allows all.
  useEffect(() => {
    const startOfToday = new Date(`${phTodayKey()}T00:00:00+08:00`)
    const q = query(
      collection(db, 'interviewSlots'),
      where('start', '>=', Timestamp.fromDate(startOfToday)),
      orderBy('start', 'asc'),
    )
    const unsub = onSnapshot(q, snap => {
      setSlots(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, (err) => {
      setLoading(false)
      console.error('[AdminInterviews] slots snapshot error:', err)
      toast.error('Failed to load interview slots.')
    })
    return unsub
  }, [])

  const openCount   = slots.filter(s => s.status === SLOT_STATUS.OPEN).length
  const bookedCount = slots.filter(s => s.status === SLOT_STATUS.BOOKED).length
  const dayGroups   = useMemo(() => groupSlotsByDay(slots), [slots])

  // ── Generate & publish ─────────────────────────────────────────────────
  const handleGenerate = () => {
    const existing = new Set(slots.map(slotKey))
    const fresh = generateSlots({
      fromKey: phTodayKey(),
      days: rangeDays,
      windows: DEFAULT_WINDOWS,
      mode: genMode,
    })
      // Drop anything already in the past today and anything already published
      // at the same date+time (regardless of mode) so we never double-book a time.
      .filter(s => s.start.getTime() > Date.now() && !existing.has(slotKey(s)))
    if (fresh.length === 0) {
      toast('Nothing new to add — those weekday slots are already published for this range.', { icon: 'ℹ️' })
      return
    }
    setPreview(fresh)
  }

  const handlePublish = async () => {
    if (!preview?.length) return
    setPublishing(true)
    try {
      // 154 max for a 2-week window — comfortably under the 500 batch limit.
      const batch = writeBatch(db)
      for (const s of preview) {
        const ref = doc(collection(db, 'interviewSlots'))
        batch.set(ref, {
          start:       Timestamp.fromDate(s.start),
          date:        s.date,
          time:        s.time,
          startMin:    s.startMin,
          durationMin: s.durationMin,
          mode:        s.mode,
          status:      SLOT_STATUS.OPEN,
          patientId:   null,
          requestId:   null,
          meetLink:    '',
          queueNo:     null,
          createdBy:   user.uid,
          createdAt:   serverTimestamp(),
          updatedAt:   serverTimestamp(),
        })
      }
      await batch.commit()
      logAudit(user, {
        action:     'interview_slots_published',
        targetType: 'interviewSlots',
        targetId:   'batch',
        targetName: `${preview.length} slots`,
        details:    `Published ${preview.length} ${MODE_META[genMode].label} interview slot(s) over the next ${rangeDays} days`,
      })
      toast.success(`Published ${preview.length} slot${preview.length === 1 ? '' : 's'}.`)
      setPreview(null)
    } catch (err) {
      console.error('[AdminInterviews] publish error:', err)
      toast.error('Failed to publish slots.')
    } finally {
      setPublishing(false)
    }
  }

  // ── Per-day mode flip (open slots only) ─────────────────────────────────
  const flipDayMode = async (group) => {
    const openOnDay = group.slots.filter(s => s.status === SLOT_STATUS.OPEN)
    if (openOnDay.length === 0) {
      toast('No open slots to switch on this day (booked slots keep their mode).', { icon: 'ℹ️' })
      return
    }
    // Flip toward the minority/!current: if any are in-person, make them all
    // online, else make them all in-person. Reads the first open slot's mode.
    const target = openOnDay[0].mode === SLOT_MODE.IN_PERSON ? SLOT_MODE.ONLINE : SLOT_MODE.IN_PERSON
    setBusyDay(group.date)
    try {
      const batch = writeBatch(db)
      for (const s of openOnDay) {
        batch.update(doc(db, 'interviewSlots', s.id), { mode: target, updatedAt: serverTimestamp() })
      }
      await batch.commit()
      logAudit(user, {
        action:     'interview_slots_mode_changed',
        targetType: 'interviewSlots',
        targetId:   group.date,
        targetName: fmtDayLabel(group.date),
        details:    `Switched ${openOnDay.length} open slot(s) on ${group.date} to ${MODE_META[target].label}`,
      })
      toast.success(`${fmtDayLabel(group.date)} → ${MODE_META[target].label}.`)
    } catch (err) {
      console.error('[AdminInterviews] day mode flip error:', err)
      toast.error('Failed to switch the day mode.')
    } finally {
      setBusyDay(null)
    }
  }

  // ── Program-wide emergency flip (all open, future) ──────────────────────
  const performFlipAll = async () => {
    const target = confirmFlipAll
    const openSlots = slots.filter(s => s.status === SLOT_STATUS.OPEN && s.mode !== target)
    setFlippingAll(true)
    try {
      // Chunk to respect the 500-write batch limit.
      for (let i = 0; i < openSlots.length; i += 450) {
        const batch = writeBatch(db)
        for (const s of openSlots.slice(i, i + 450)) {
          batch.update(doc(db, 'interviewSlots', s.id), { mode: target, updatedAt: serverTimestamp() })
        }
        await batch.commit()
      }
      logAudit(user, {
        action:     'interview_slots_mode_changed',
        targetType: 'interviewSlots',
        targetId:   'all-open',
        targetName: 'All upcoming open slots',
        details:    `Program-wide switch: ${openSlots.length} open slot(s) → ${MODE_META[target].label}`,
      })
      toast.success(`All upcoming open slots → ${MODE_META[target].label} (${openSlots.length}).`)
      setConfirmFlipAll(null)
    } catch (err) {
      console.error('[AdminInterviews] program-wide flip error:', err)
      toast.error('Failed to switch all slots.')
    } finally {
      setFlippingAll(false)
    }
  }

  // ── Delete an open slot ─────────────────────────────────────────────────
  const deleteSlot = async (slot) => {
    try {
      await deleteDoc(doc(db, 'interviewSlots', slot.id))
      logAudit(user, {
        action:     'interview_slot_deleted',
        targetType: 'interviewSlots',
        targetId:   slot.id,
        targetName: `${slot.date} ${slot.time}`,
        details:    `Removed an open ${MODE_META[slot.mode]?.label ?? slot.mode} slot`,
      })
    } catch (err) {
      console.error('[AdminInterviews] delete error:', err)
      toast.error('Failed to remove the slot.')
    }
  }

  return (
    <Layout breadcrumb="Interview Availability">
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">

        {/* Header */}
        <div className="mb-5">
          <p className="eyebrow">Scheduling</p>
          <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Interview Availability</h1>
          <p className="text-sm text-gray-500 mt-1">
            Publish bookable assessment-interview slots. In person by default — the schedule keeps the office from crowding; switch a day (or the whole program) to online Google Meet for an emergency.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-5 items-start">

          {/* ── Controls ── */}
          <aside className="lg:sticky lg:top-[68px] space-y-4">
            <div className="card grid grid-cols-3 divide-x divide-gray-100 overflow-hidden text-center">
              {[
                { label: 'Open',   value: openCount,   color: 'text-brand-600' },
                { label: 'Booked', value: bookedCount, color: 'text-purple-600' },
                { label: 'Days',   value: dayGroups.length, color: 'text-gray-800' },
              ].map((m, i) => (
                <div key={i} className="px-2 py-2.5">
                  <p className={`text-lg font-semibold tabular-nums ${m.color}`}>{loading ? '—' : m.value}</p>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 mt-0.5">{m.label}</p>
                </div>
              ))}
            </div>

            {/* Generate */}
            <div className="card p-4 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Publish availability</p>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Range</label>
                <select className="input text-sm" value={rangeDays} onChange={e => { setRangeDays(Number(e.target.value)); setPreview(null) }}>
                  {RANGE_OPTIONS.map(r => <option key={r.days} value={r.days}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Mode</label>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1">
                  {[SLOT_MODE.IN_PERSON, SLOT_MODE.ONLINE].map(m => {
                    const { short, Icon } = MODE_META[m]
                    return (
                      <button key={m} type="button"
                        onClick={() => { setGenMode(m); setPreview(null) }}
                        className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                          genMode === m ? 'bg-white text-brand-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                        }`}>
                        <Icon size={14} /> {short}
                      </button>
                    )
                  })}
                </div>
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Weekdays · 9:00–11:30 AM &amp; 1:00–4:00 PM · 30-min slots. Times already published are skipped.
              </p>
              {!preview ? (
                <button type="button" className="btn-primary text-sm w-full flex items-center justify-center gap-1.5" onClick={handleGenerate}>
                  <MdAdd size={16} /> Generate &amp; review
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 text-xs text-brand-800">
                    <strong>{preview.length}</strong> new {MODE_META[genMode].label} slot{preview.length === 1 ? '' : 's'} across {new Set(preview.map(s => s.date)).size} day(s). Review below, then publish.
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="btn-secondary text-sm flex-1" onClick={() => setPreview(null)} disabled={publishing}>Cancel</button>
                    <button type="button" className="btn-primary text-sm flex-1" onClick={handlePublish} disabled={publishing}>
                      {publishing ? 'Publishing…' : `Publish ${preview.length}`}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Emergency lever */}
            <div className="card p-4 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Emergency switch</p>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Move every upcoming <strong>open</strong> slot to one mode at once — e.g. flip the whole program online during a lockdown. Booked slots are left for CRMC to handle case by case.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmFlipAll(SLOT_MODE.ONLINE)}
                  className="text-xs font-medium flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 transition-colors">
                  <MdVideocam size={14} /> All online
                </button>
                <button type="button" onClick={() => setConfirmFlipAll(SLOT_MODE.IN_PERSON)}
                  className="text-xs font-medium flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-brand-200 text-brand-700 hover:bg-brand-50 transition-colors">
                  <MdApartment size={14} /> All in person
                </button>
              </div>
            </div>
          </aside>

          {/* ── Published slots ── */}
          <div className="min-w-0">
            <div className="card overflow-hidden">
              {loading && <div className="p-8 text-center text-sm text-gray-400">Loading availability…</div>}

              {!loading && dayGroups.length === 0 && (
                <div className="p-10 text-center">
                  <MdEventAvailable size={34} className="text-gray-200 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No upcoming slots published.</p>
                  <p className="text-xs text-gray-400 mt-1">Use <strong>Generate &amp; review</strong> to publish the next weeks of availability.</p>
                </div>
              )}

              {!loading && dayGroups.map(group => {
                const openOnDay   = group.slots.filter(s => s.status === SLOT_STATUS.OPEN)
                const bookedOnDay = group.slots.length - openOnDay.length
                // A day's mode label reflects its open slots (booked keep their own).
                const dayMode = openOnDay[0]?.mode ?? group.slots[0]?.mode ?? SLOT_MODE.IN_PERSON
                const meta = MODE_META[dayMode]
                return (
                  <section key={group.date} className="border-b border-gray-50 last:border-0">
                    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-100 bg-gray-50/95 px-4 py-2 backdrop-blur flex-wrap">
                      <h3 className="text-[12px] font-semibold text-gray-700">{group.label}</h3>
                      <span className="text-[11px] text-gray-400 tabular-nums">{openOnDay.length} open{bookedOnDay ? ` · ${bookedOnDay} booked` : ''}</span>
                      <span className={`ml-auto inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border ${meta.chip}`}>
                        <meta.Icon size={11} /> {meta.short}
                      </span>
                      {openOnDay.length > 0 && (
                        <button type="button" onClick={() => flipDayMode(group)} disabled={busyDay === group.date}
                          className="text-[11px] font-medium text-gray-500 hover:text-brand-600 underline underline-offset-2 disabled:opacity-50">
                          {busyDay === group.date ? 'Switching…' : `Switch to ${dayMode === SLOT_MODE.IN_PERSON ? 'online' : 'in person'}`}
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 px-4 py-3">
                      {group.slots.map(s => {
                        const sm = MODE_META[s.mode] ?? MODE_META[SLOT_MODE.IN_PERSON]
                        if (s.status === SLOT_STATUS.BOOKED) {
                          return (
                            <span key={s.id} className="inline-flex flex-col items-start gap-0.5 rounded-lg bg-purple-50 text-purple-700 border border-purple-100 px-2.5 py-1.5">
                              <span className="text-xs font-semibold tabular-nums">{s.time}</span>
                              <span className="text-[10px] inline-flex items-center gap-1"><sm.Icon size={10} /> Booked</span>
                            </span>
                          )
                        }
                        return (
                          <span key={s.id} className={`group relative inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-mono tabular-nums ${sm.chip}`}>
                            <sm.Icon size={11} /> {s.time}
                            <button type="button" onClick={() => deleteSlot(s)} aria-label={`Remove ${s.time} slot`}
                              className="ml-0.5 -mr-1 w-4 h-4 grid place-items-center rounded-full text-gray-400 hover:text-red-500 hover:bg-white/70 transition-colors">
                              <MdClose size={11} />
                            </button>
                          </span>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 mt-3 leading-relaxed">
              <strong>Note —</strong> Patients see a slot only after CRMC opens their request for booking. Booked slots keep the mode they were booked under; use the per-day or emergency switch on open slots.
            </p>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={!!confirmFlipAll}
        onClose={() => !flippingAll && setConfirmFlipAll(null)}
        onConfirm={performFlipAll}
        title={confirmFlipAll ? `Switch all upcoming open slots to ${MODE_META[confirmFlipAll].label}?` : ''}
        body={confirmFlipAll
          ? `Every open slot from today onward becomes ${MODE_META[confirmFlipAll].label}. Booked slots are not touched — handle those case by case. This is the program-wide emergency lever.`
          : ''}
        tone={confirmFlipAll === SLOT_MODE.ONLINE ? 'info' : 'warning'}
        confirmLabel={confirmFlipAll ? `Switch to ${MODE_META[confirmFlipAll].short}` : 'Confirm'}
        confirmLabelBusy="Switching…"
      />
    </Layout>
  )
}
