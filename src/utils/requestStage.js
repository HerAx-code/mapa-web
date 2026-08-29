// CRMC request-processing stage model (Phase 0 of the request-pipeline
// redesign). Encapsulates the verify → assess → interview → endorse workflow
// that was inline in admin/Requests.jsx, so the queue chips, the stage rail,
// and the endorse gate all read one source of truth instead of re-deriving it.
//
// Pure: given a request and its resolved documents (reqDocs — attachedDocuments
// merged with live status), returns the stage states, the current stage, the
// endorse gate, and the exact remaining blockers. Behavior mirrors the original
// inline logic exactly:
//   allVerified  = docs.length > 0 && every doc verified
//   intakeComplete = isIntakeComplete(request.intakeSheet)
//   canEndorse   = allVerified && !!interviewOutcome && intakeComplete

import { isIntakeComplete } from './intakeSheet'

export const TERMINAL_REQUEST_STATUSES = ['fully_funded', 'closed', 'rejected']

// Ordered CRMC processing stages. 'endorse' is the goal; the first three are
// its prerequisites.
export const CRMC_STAGE_KEYS = ['verify', 'assess', 'interview', 'endorse']

export function deriveRequestStage(request = {}, docs = []) {
  const terminal      = TERMINAL_REQUEST_STATUSES.includes(request?.status)
  const totalDocs     = docs.length
  const verifiedDocs  = docs.filter(d => d?.status === 'verified').length
  const docsVerified  = totalDocs > 0 && verifiedDocs === totalDocs
  const intakeComplete = isIntakeComplete(request?.intakeSheet)
  const interviewDone = !!request?.interviewOutcome
  const canEndorse    = docsVerified && intakeComplete && interviewDone

  const done = { verify: docsVerified, assess: intakeComplete, interview: interviewDone, endorse: false }
  const detail = {
    verify:    totalDocs ? `${verifiedDocs}/${totalDocs} verified` : 'No documents',
    assess:    intakeComplete ? 'Intake complete' : 'Intake incomplete',
    interview: interviewDone ? 'Outcome recorded' : 'No outcome yet',
    endorse:   canEndorse ? 'Ready to endorse' : 'Prerequisites pending',
  }
  const label = { verify: 'Verify documents', assess: 'Assess', interview: 'Interview', endorse: 'Endorse' }

  // Current stage = first incomplete prerequisite, else 'endorse'. Terminal
  // requests have no active stage.
  const firstIncomplete = ['verify', 'assess', 'interview'].find(k => !done[k])
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
  const blockers = ['verify', 'assess', 'interview']
    .filter(k => !done[k])
    .map(k => ({ key: k, label: label[k], detail: detail[k] }))

  return {
    terminal, current, canEndorse, stages, blockers,
    docsVerified, intakeComplete, interviewDone, verifiedDocs, totalDocs,
  }
}
