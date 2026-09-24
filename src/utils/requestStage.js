// CRMC request-processing stage model (Phase 0 of the request-pipeline
// redesign). Encapsulates the verify → assess → endorse workflow that was
// inline in admin/Requests.jsx, so the queue chips, the stage rail, and the
// endorse gate all read one source of truth instead of re-deriving it.
//
// Pure: given a request and its resolved documents (reqDocs — attachedDocuments
// merged with live status), returns the stage states, the current stage, the
// endorse gate, and the exact remaining blockers:
//   allVerified    = docs.length > 0 && every doc verified
//   intakeComplete = isIntakeComplete(request.intakeSheet)
//   canEndorse     = allVerified && intakeComplete
//
// The scheduled assessment interview was removed (see
// docs/remove-interview-scheduling-plan.md): the assessment is now async/remote
// and the completed Unified Intake Sheet IS the human-assessment gate. The
// social worker still cannot endorse without it, so the human-in-the-loop
// requirement holds — without the appointment/booking friction.

import { isIntakeComplete } from './intakeSheet'

export const TERMINAL_REQUEST_STATUSES = ['fully_funded', 'closed', 'rejected']

// Ordered CRMC processing stages. 'endorse' is the goal; the first three are
// its prerequisites.
export const CRMC_STAGE_KEYS = ['verify', 'assess', 'endorse']

export function deriveRequestStage(request = {}, docs = []) {
  const terminal      = TERMINAL_REQUEST_STATUSES.includes(request?.status)
  const totalDocs     = docs.length
  const verifiedDocs  = docs.filter(d => d?.status === 'verified').length
  const docsVerified  = totalDocs > 0 && verifiedDocs === totalDocs
  const intakeComplete = isIntakeComplete(request?.intakeSheet)
  const canEndorse    = docsVerified && intakeComplete

  const done = { verify: docsVerified, assess: intakeComplete, endorse: false }
  const detail = {
    verify:  totalDocs ? `${verifiedDocs}/${totalDocs} verified` : 'No documents',
    assess:  intakeComplete ? 'Intake complete' : 'Intake incomplete',
    endorse: canEndorse ? 'Ready to endorse' : 'Prerequisites pending',
  }
  const label = { verify: 'Verify documents', assess: 'Assess', endorse: 'Endorse' }

  // Current stage = first incomplete prerequisite, else 'endorse'. Terminal
  // requests have no active stage.
  const firstIncomplete = ['verify', 'assess'].find(k => !done[k])
  const current = terminal ? null : (firstIncomplete ?? 'endorse')

  const stages = CRMC_STAGE_KEYS.map(key => ({
    key,
    label:  label[key],
    detail: detail[key],
    done:   done[key],
    // status drives the rail: done · current · blocked (endorse before its
    // prereqs) · upcoming.
    status: terminal ? (done[key] ? 'done' : 'upcoming')
      : done[key] ? 'done'
      : key === current ? 'current'
      : key === 'endorse' ? 'blocked'
      : 'upcoming',
  }))

  // The exact prerequisites still missing before endorsement — each with a
  // stage to jump to. Replaces the single vague "verify all / complete intake /
  // record outcome" warning.
  const blockers = ['verify', 'assess']
    .filter(k => !done[k])
    .map(k => ({ key: k, label: label[k], detail: detail[k] }))

  return {
    terminal, current, canEndorse, stages, blockers,
    docsVerified, intakeComplete, verifiedDocs, totalDocs,
  }
}
