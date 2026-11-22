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
