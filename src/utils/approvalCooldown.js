// 30-day approval cooldown, per agency (process consistency, 2026-11-15).
//
// approvalMarks/{agencyId}__{patientId} holds the agency's latest approval for
// a patient: { agencyId, patientId, requestId, sliceId, lastApprovedAt }. The
// approval transaction writes it, and firestore.rules (approvalCooldownOk)
// refuses an approval unless the previous mark is missing, belongs to the same
// request (co-funding / re-approval after a reversal) or is 30+ days old.
// A reversal leaves the mark alone, so the clock runs from the first approval.
// Each agency keeps its own clock: programs set their own frequency rules.

export const APPROVAL_COOLDOWN_DAYS = 30
const DAY_MS = 86400000

export const approvalMarkId = (agencyId, patientId) => `${agencyId}__${patientId}`

function toMillis(ts) {
  if (!ts) return null
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (ts instanceof Date) return ts.getTime()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  const n = new Date(ts).getTime()
  return Number.isNaN(n) ? null : n
}

// Why this agency can't approve the slice yet, or null when it can. Mirrors
// the rule, so the screen can say so before the write is refused.
export function approvalCooldownBlock(mark, requestId, now = Date.now()) {
  const at = toMillis(mark?.lastApprovedAt)
  if (at == null) return null
  if (requestId && mark.requestId === requestId) return null
  const until = at + APPROVAL_COOLDOWN_DAYS * DAY_MS
  if (until <= now) return null
  return {
    lastApprovedAt: new Date(at),
    until:          new Date(until),
    daysAgo:        Math.floor((now - at) / DAY_MS),
    daysRemaining:  Math.ceil((until - now) / DAY_MS),
    requestId:      mark.requestId ?? null,
  }
}
