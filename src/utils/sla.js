// Service-level-agreement (SLA) signal for the admin request queue. CRMC aims
// to reach a decision within a target window of submission; the queue surfaces
// how close each request is, and how many have breached it, so time-critical
// cases (a patient can't be cleared for discharge until a decision is recorded)
// are impossible to miss.
//
// Derived, not stored: the SLA is submittedAt + SLA_HOURS, so no new field is
// needed. The threshold is a single constant here — change it in one place.

import { TERMINAL_REQUEST_STATUSES } from './requestStage'

export const SLA_HOURS = 48

// submittedAt can arrive as a Firestore Timestamp (.toDate), a raw { seconds }
// object (how the queue already reads it — r.submittedAt?.seconds), a Date, or
// an ISO string. Collapse all four to epoch-ms, or null.
const toMs = (ts) => {
  if (!ts) return null
  if (typeof ts.toDate === 'function') return ts.toDate().getTime()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

// 'ok' | 'due_soon' (<=12h left) | 'overdue' (past due). Resolved requests
// carry no SLA pressure.
export function slaState(request, now = Date.now()) {
  if (TERMINAL_REQUEST_STATUSES.includes(request?.status)) return 'ok'
  const submittedMs = toMs(request?.submittedAt)
  if (submittedMs == null) return 'ok'
  const hoursLeft = (submittedMs + SLA_HOURS * 3_600_000 - now) / 3_600_000
  if (hoursLeft < 0) return 'overdue'
  if (hoursLeft <= 12) return 'due_soon'
  return 'ok'
}

// Short label for the WAITING column's SLA sub-line.
export function slaLabel(state) {
  if (state === 'overdue') return 'past SLA'
  if (state === 'due_soon') return 'due today'
  return 'within SLA'
}

export const isOverdue = (request, now = Date.now()) => slaState(request, now) === 'overdue'

// How many requests in a list have breached the SLA (drives the alert strip).
export function overdueCount(requests = [], now = Date.now()) {
  return requests.reduce((n, r) => n + (isOverdue(r, now) ? 1 : 0), 0)
}
