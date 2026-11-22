// Entry point of the Cloud Functions bundle (scripts/build-shared.mjs →
// functions/src/generated/shared.cjs). Export here only PURE modules from
// src/shared/ — the functions require the bundle, never src/ directly.
export * from './caseState.js'

// The endorse gate (Phase 2 PR 2.2): the same checks the hospital's Requests
// page shows, re-run by the endorseRequest function. These src/utils modules
// are pure (no Firebase, ORG or import.meta) — keep them that way, or move
// what the server needs into src/shared/.
export { deriveRequestStage, TERMINAL_REQUEST_STATUSES } from '../utils/requestStage.js'
export { interviewReasons, secondPersonHold, callRecorded } from '../utils/verificationPolicy.js'
export { missingAgencyDocs } from '../utils/agencyDocs.js'

// Agency decisions (Phase 2 PR 2.3): the repeat limit per agency, re-checked
// by the decideSlice function.
export { approvalCooldownBlock, repeatLimitOf, OVERRIDE_REASON_MIN } from '../utils/approvalCooldown.js'

// Assessment amendments (Phase 3 PR 3.2): the completeness check the
// amendAssessment function re-runs, and which fields are the patient's.
export { isIntakeComplete, PATIENT_FACT_KEYS } from '../utils/intakeSheet.js'

// Case endings (Phase 4): the hospital's timer limits.
export { CASE_TIMERS, caseTimerDays } from './caseTimers.js'
