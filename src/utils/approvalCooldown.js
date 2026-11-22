// Repeat limit per agency (Phase 1, 2026-11-16; was a fixed 30-day cooldown,
// 2026-11-15).
//
// approvalMarks/{agencyId}__{patientId} holds the agency's latest approval for
// a patient: { agencyId, patientId, requestId, sliceId, lastApprovedAt,
// byType: { [assistanceType]: { at, requestId } } }. The approval transaction
// writes it, and firestore.rules (approvalCooldownOk / outsideRepeatLimit)
// checks it against the agency's own setting:
//   agencies.repeatLimit = { days, perType }   default { 30, false }
// days 0 = no limit; perType = count each assistance type separately. The
// same request never counts. Inside the limit the approval needs a written
// reason (repeatOverride on the slice) — a recorded exception, not a block.
// A reversal keeps the mark, so the clock runs from the first approval.

export const DEFAULT_REPEAT_DAYS = 30
export const OVERRIDE_REASON_MIN = 10
const DAY_MS = 86400000

export const approvalMarkId = (agencyId, patientId) => `${agencyId}__${patientId}`

// The agency's repeat limit, with the defaults the rules use.
export function repeatLimitOf(agency) {
  const days = Number(agency?.repeatLimit?.days)
  return {
    days: Number.isFinite(days) && days >= 0 ? Math.floor(days) : DEFAULT_REPEAT_DAYS,
    perType: agency?.repeatLimit?.perType === true,
  }
}

function toMillis(ts) {
  if (!ts) return null
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (ts instanceof Date) return ts.getTime()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  const n = new Date(ts).getTime()
  return Number.isNaN(n) ? null : n
}

// Why this approval falls inside the agency's repeat limit (so it needs a
// reason), or null when it doesn't. Mirrors the rule.
//   limit: { days, perType } from repeatLimitOf(agency); type: the request's
//   assistanceType (used only when perType).
export function approvalCooldownBlock(mark, requestId, now = Date.now(), limit = {}, type = '') {
  const days = limit.days ?? DEFAULT_REPEAT_DAYS
  if (!mark || days === 0) return null
  const prev = limit.perType
    ? (mark.byType?.[type] ?? null)
    : { at: mark.lastApprovedAt, requestId: mark.requestId }
  const at = toMillis(prev?.at)
  if (at == null) return null
  if (requestId && prev.requestId === requestId) return null
  const until = at + days * DAY_MS
  if (until <= now) return null
  return {
    days,
    perType: !!limit.perType,
    type: limit.perType ? type : null,
    lastApprovedAt: new Date(at),
    until:          new Date(until),
    daysAgo:        Math.floor((now - at) / DAY_MS),
    daysRemaining:  Math.ceil((until - now) / DAY_MS),
    requestId:      prev.requestId ?? null,
  }
}
