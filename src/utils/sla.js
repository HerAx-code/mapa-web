// Service-level-agreement (SLA) signal for the admin request queue. CRMC aims
// to reach a decision within a target window of submission; the queue surfaces
// how close each request is, and how many have breached it, so time-critical
// cases (a patient can't be cleared for discharge until a decision is recorded)
// are impossible to miss.
//
// Derived, not stored: the SLA is submittedAt + SLA_HOURS, so no new field is
// needed. The threshold is a single constant here — change it in one place.

import { TERMINAL_REQUEST_STATUSES } from './requestStage'
import { aging } from './aging'

export const SLA_HOURS = 48
// due_soon opens 12h before the deadline → warn at (48 − 12) = 36h elapsed.
const SLA_WARN_HOURS = SLA_HOURS - 12

// 'ok' | 'due_soon' (<=12h left) | 'overdue' (past due). Resolved requests
// carry no SLA pressure. Delegates to the shared aging() primitive so the CRMC
// queue and the agency inbox share one state model (different thresholds).
export function slaState(request, now = Date.now()) {
  if (TERMINAL_REQUEST_STATUSES.includes(request?.status)) return 'ok'
  const { state } = aging(request?.submittedAt, {
    warnAt: SLA_WARN_HOURS, overAt: SLA_HOURS, unit: 'h', now,
  })
  return state === 'over' ? 'overdue' : state === 'warn' ? 'due_soon' : 'ok'
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
