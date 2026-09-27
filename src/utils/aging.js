// Shared aging vocabulary for the staff queues.
//
// CRMC's request SLA (measured in HOURS from submission) and the agency inbox's
// "days waiting" (measured in DAYS) are the same idea on different clocks. This
// module gives both ONE state model — ok | warn | over — with consistent color
// semantics, while keeping each queue's own thresholds (they are genuinely
// different clocks; only the semantics are shared, not the numbers).
//
// sla.js delegates to this so the admin queue's behaviour is unchanged; the
// agency Inbox uses it directly for its days-waiting cue.

// A timestamp can arrive as a Firestore Timestamp (.toDate), a raw { seconds }
// object, a Date, or an ISO string. Collapse all to epoch-ms, or null.
export function toMs(ts) {
  if (!ts) return null
  if (typeof ts.toDate === 'function') return ts.toDate().getTime()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

// Elapsed since `sinceTs`, bucketed against warn/over thresholds.
//   unit: 'h' (hours, default) | 'd' (days)
// Returns { state: 'ok'|'warn'|'over', elapsed } — elapsed is null when the
// timestamp is missing/unparseable (treated as 'ok', no false alarm).
export function aging(sinceTs, { warnAt, overAt, unit = 'h', now = Date.now() } = {}) {
  const ms = toMs(sinceTs)
  if (ms == null) return { state: 'ok', elapsed: null }
  const per = unit === 'd' ? 86_400_000 : 3_600_000
  const elapsed = (now - ms) / per
  const state = elapsed >= overAt ? 'over' : elapsed >= warnAt ? 'warn' : 'ok'
  return { state, elapsed }
}

// Text color per state — one palette both queues share (gray calm, amber
// attention, red breached).
export const AGING_TEXT = { ok: 'text-gray-400', warn: 'text-amber-600', over: 'text-red-600' }
