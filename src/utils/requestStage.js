// the gateway request-processing stage model (Phase 0 of the request-pipeline
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
import { callRecorded } from './verificationPolicy'
import { validateIntakeAll, memberHasData } from './intakeValidation'

// Answers staff typed for a patient who never filled the sheet
// (intakeSheet.encodedOnBehalf) must pass the same checks as the patient's
// own form: household members = household size, all six expenses, etc.
// (2026-11-15 intake review). Empty member rows are ignored, as the patient
// form drops them on save; the "amounts look mistyped" double-check is the
// patient's prompt, not a staff blocker. Returns the first problem or null.
export function encodedIntakeProblem(sheet) {
  if (!sheet?.encodedOnBehalf) return null
  return validateIntakeAll(
    { ...sheet, familyMembers: (sheet.familyMembers ?? []).filter(memberHasData), _amountsConfirmed: true },
    ['family', 'income', 'expenses', 'medical'],
  )
}

export const TERMINAL_REQUEST_STATUSES = ['fully_funded', 'closed', 'rejected']

// Ordered the gateway processing stages. 'endorse' is the goal; the first three are
// its prerequisites.
export const GATEWAY_STAGE_KEYS = ['verify', 'assess', 'endorse']

// `callReasons` (input verification Phase 2, src/utils/verificationPolicy.js):
// why this request needs a recorded verification call before endorsing. The
// caller works them out (they need the hospital policy + duplicate flag);
// [] = no call needed, which keeps every older caller's behaviour.
// `holds` (Phase 3): other blockers the caller already worked out, e.g. the
// second-person rule ({ key, label, detail }); each one blocks endorsing.
export function deriveRequestStage(request = {}, docs = [], { callReasons = [], holds = [] } = {}) {
  const terminal      = TERMINAL_REQUEST_STATUSES.includes(request?.status)
  const totalDocs     = docs.length
  const verifiedDocs  = docs.filter(d => d?.status === 'verified').length
  const docsVerified  = totalDocs > 0 && verifiedDocs === totalDocs
  const encodedProblem = encodedIntakeProblem(request?.intakeSheet)
  const intakeComplete = isIntakeComplete(request?.intakeSheet, request?.totalBill) && !encodedProblem
  const callNeeded    = callReasons.length > 0 && !callRecorded(request)
  const canEndorse    = docsVerified && intakeComplete && !callNeeded && holds.length === 0

  const done = { verify: docsVerified, assess: intakeComplete, endorse: false }
  const detail = {
    verify:  totalDocs ? `${verifiedDocs}/${totalDocs} verified` : 'No documents',
    assess:  intakeComplete ? 'Intake complete' : encodedProblem ? `Encoded answers: ${encodedProblem.en}` : 'Intake incomplete',
    endorse: canEndorse ? 'Ready to endorse' : callNeeded && docsVerified && intakeComplete ? 'Verification call needed' : 'Prerequisites pending',
  }
  const label = { verify: 'Verify documents', assess: 'Assess', endorse: 'Endorse' }

  // Current stage = first incomplete prerequisite, else 'endorse'. Terminal
  // requests have no active stage.
  const firstIncomplete = ['verify', 'assess'].find(k => !done[k])
  const current = terminal ? null : (firstIncomplete ?? 'endorse')

  const stages = GATEWAY_STAGE_KEYS.map(key => ({
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
  // The call is recorded on the intake sheet, so it jumps to 'assess'.
  if (callNeeded) blockers.push({ key: 'assess', label: 'Verification call', detail: callReasons.map(r => r.label).join(' · '), call: true })
  for (const h of holds) blockers.push({ ...h, hold: true })

  return {
    terminal, current, canEndorse, stages, blockers, callNeeded,
    docsVerified, intakeComplete, verifiedDocs, totalDocs,
  }
}
