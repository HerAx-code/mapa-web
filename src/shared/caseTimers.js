// Case timers (Phase 4, decisions P4-B / P4-C — docs/phase4-case-endings-plan.md).
// The hospital's limits, in hospitalSettings/{tenantId}, with defaults and the
// bounds the Hospital Settings page and the rules accept. Pure: the web and the
// caseTimers function (through the shared bundle) read the same numbers.
export const CASE_TIMERS = {
  // A slice the patient never accepts ("Proceed") closes after this.
  sliceProceedDays:   { default: 3, min: 1, max: 14 },
  // An endorsed case with nothing waiting at any agency closes after this.
  nothingPendingDays: { default: 7, min: 2, max: 30 },
}

// The limit in days the hospital set, or the default when unset or out of bounds.
export function caseTimerDays(settings, key) {
  const t = CASE_TIMERS[key]
  const v = Number(settings?.[key])
  return Number.isInteger(v) && v >= t.min && v <= t.max ? v : t.default
}
