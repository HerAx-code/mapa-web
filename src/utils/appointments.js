// Appointment / interview-slot domain logic — pure and framework-free, so it is
// unit-testable and shared by the CRMC availability publisher (admin side) and
// the patient booking picker. No Firestore imports: callers pass plain data.
//
// Model (see docs/appointment-system-plan.md):
//   CRMC publishes bookable interview slots (the `interviewSlots` collection);
//   a patient whose request CRMC has opened for booking self-books one open
//   slot; a Cloud Function trigger then syncs the booked slot back onto the
//   request (interviewDate / interviewTime / meetLink / interviewAt). The
//   money-adjacent request write stays on the trusted server rather than
//   widening the patient's client write surface, and the `status == 'open'`
//   precondition on the slot update is itself the double-booking guard.
//
// All date maths is anchored to PH local time (Asia/Manila, UTC+8, no DST) so
// slot dates/weekdays are stable regardless of the host machine's timezone —
// the same discipline used in patient/Interviews.jsx (buildGcalUrl).

export const SLOT_STATUS = { OPEN: 'open', BOOKED: 'booked' }

// Interview mode. In-person is the default — the assessment interview happens at
// the CRMC office and the appointment system exists to stagger arrivals and
// control congestion. Online (Google Meet) is the fallback CRMC switches to when
// in-person isn't feasible (a health emergency, a typhoon, an off-site social
// worker, or a patient who can't travel). The mode rides on the slot so a single
// booking flow serves both — only the "where" differs. See CLAUDE.md
// (Communication Channels) and docs/appointment-system-plan.md.
export const SLOT_MODE = { IN_PERSON: 'in_person', ONLINE: 'online' }

// A booked interview can no longer be re-booked once concluded, and a request
// in a terminal state is done. `interviewBookingOpen` is the explicit,
// per-request gate CRMC sets ("this patient is ready to interview") — self-
// booking is deliberately CRMC-authorised, not automatic on submission.
const TERMINAL_REQUEST_STATUSES = ['fully_funded', 'closed', 'rejected']
const CONCLUDED_OUTCOMES = ['completed', 'no_show']

export function canBookInterview(request) {
  if (!request) return false
  if (request.interviewBookingOpen !== true) return false
  if (TERMINAL_REQUEST_STATUSES.includes(request.status)) return false
  if (CONCLUDED_OUTCOMES.includes(request.interviewOutcome)) return false
  return true
}

// A sensible default availability template for the admin publisher: weekdays,
// 9:00–11:30 AM and 1:00–4:00 PM, in 30-minute slots. Windows are
// {weekday 0=Sun..6=Sat, startMin, endMin} in minutes-from-midnight PH.
export const DEFAULT_WINDOWS = [1, 2, 3, 4, 5].flatMap(weekday => [
  { weekday, startMin: 9 * 60, endMin: 11 * 60 + 30 },
  { weekday, startMin: 13 * 60, endMin: 16 * 60 },
])

// minutes-from-midnight → "2:00 PM" (matches the existing interviewTime string
// format). Computed by hand so it does not depend on the host locale/timezone.
export function formatSlotTime(totalMin) {
  const h24 = Math.floor(totalMin / 60)
  const m = totalMin % 60
  const ampm = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

// A JS Date → PH-local "YYYY-MM-DD" key (the denormalized `date` on a slot, and
// the string patient/Interviews.jsx compares interviewDate against).
export function toDateKey(date) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
}

// Anchor every key operation at noon PH so we never straddle a midnight
// boundary when converting between a key and a Date (PH has no DST, so noon is
// always safely mid-day).
const keyAtNoon = (key) => new Date(`${key}T12:00:00+08:00`)

// "YYYY-MM-DD" + n days → "YYYY-MM-DD" (PH-local).
export function addDaysKey(key, n) {
  const d = keyAtNoon(key)
  d.setUTCDate(d.getUTCDate() + n)
  return toDateKey(d)
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

// PH-local weekday (0=Sun..6=Sat) for a date key.
export function phWeekdayOfKey(key) {
  const name = keyAtNoon(key).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', weekday: 'short' })
  return WEEKDAY_INDEX[name]
}

// Build one slot descriptor. `start` is a real Date at PH-local wall time,
// suitable for writing to Firestore as a Timestamp. `mode` defaults to
// in-person (the norm); the publisher passes SLOT_MODE.ONLINE when generating
// online (Meet) slots for a day/period switched to the online fallback.
function makeSlot(key, startMin, durationMin, mode = SLOT_MODE.IN_PERSON) {
  const hh = String(Math.floor(startMin / 60)).padStart(2, '0')
  const mm = String(startMin % 60).padStart(2, '0')
  return {
    date: key,
    time: formatSlotTime(startMin),
    startMin,
    durationMin,
    start: new Date(`${key}T${hh}:${mm}:00+08:00`),
    status: SLOT_STATUS.OPEN,
    mode,
  }
}

// Expand a weekly availability template into concrete slot descriptors for the
// `days` days starting at `fromKey` (a "YYYY-MM-DD"). CRMC reviews these before
// they are written to Firestore. A window only yields whole slots that fit
// entirely inside it (t + durationMin <= endMin). `mode` stamps every generated
// slot (default in-person); to publish a mixed week, call once per mode-segment
// (e.g. an in-person batch and a separate online batch) — per-slot mode is the
// primitive, so program-wide / per-day / per-appointment modes are all just
// how the caller groups its generate calls.
export function generateSlots({ fromKey, days, windows, durationMin = 30, mode = SLOT_MODE.IN_PERSON }) {
  const out = []
  for (let i = 0; i < days; i++) {
    const key = addDaysKey(fromKey, i)
    const wd = phWeekdayOfKey(key)
    for (const w of windows.filter(x => x.weekday === wd)) {
      for (let t = w.startMin; t + durationMin <= w.endMin; t += durationMin) {
        out.push(makeSlot(key, t, durationMin, mode))
      }
    }
  }
  return out
}

// Defensive: a slot's `start` may arrive as a Firestore Timestamp, a Date, or
// an ISO string (seed/import data). Mirrors utils/dates tsToDate.
const slotStartDate = (slot) => {
  const s = slot?.start
  if (!s) return null
  return s.toDate ? s.toDate() : new Date(s)
}

// A slot is bookable if it is open and its start is still in the future.
export function isFutureSlot(slot, now = new Date()) {
  if (slot?.status !== SLOT_STATUS.OPEN) return false
  const start = slotStartDate(slot)
  return !!start && start.getTime() > now.getTime()
}

// Group slots into day buckets for the picker, chronological, each day's slots
// sorted by start-of-day minute. Returns [{ date, label, slots: [...] }].
export function groupSlotsByDay(slots) {
  const byDay = new Map()
  for (const s of slots) {
    if (!byDay.has(s.date)) byDay.set(s.date, [])
    byDay.get(s.date).push(s)
  }
  return [...byDay.keys()].sort().map(date => ({
    date,
    label: keyAtNoon(date).toLocaleDateString('en-US', {
      timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric',
    }),
    slots: byDay.get(date).slice().sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0)),
  }))
}
