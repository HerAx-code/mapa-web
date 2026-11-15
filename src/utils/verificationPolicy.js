// Input verification Phase 2: when a request needs a verification call (or a
// desk interview) before it can be endorsed. Each hospital sets its own policy
// in hospitalSettings/{tenantId} (staff-only, so patients can't see the
// threshold and file just under it). The social worker records the call on
// the intake sheet (intakeSheet.verificationCall). Not a rejection — a person
// still decides; it only makes sure someone actually spoke with the patient.

export const DEFAULT_POLICY = {
  interviewAboveAmount: null,  // ₱; null = no amount rule
  interviewOnDuplicate: true,  // another account looks like the same patient
}

export const policyOf = (settings) => ({ ...DEFAULT_POLICY, ...(settings ?? {}) })

export const CALL_METHODS = [
  { value: 'phone',     label: 'Phone call' },
  { value: 'video',     label: 'Video call' },
  { value: 'in_person', label: 'In person at the office' },
]

// Why this request needs a call; [] when it doesn't.
export function interviewReasons({ request, settings, identityFlag } = {}) {
  const p = policyOf(settings)
  const reasons = []
  const amount = Number(request?.amountNeeded ?? request?.totalBill)
  if (p.interviewAboveAmount != null && Number(p.interviewAboveAmount) > 0 &&
      Number.isFinite(amount) && amount >= Number(p.interviewAboveAmount)) {
    reasons.push({ key: 'amount', label: `Amount is ₱${Number(p.interviewAboveAmount).toLocaleString()} or more` })
  }
  if (p.interviewOnDuplicate && (identityFlag?.matches ?? []).some(m => m.kind !== 'phone')) {
    reasons.push({ key: 'duplicate', label: 'Another account looks like the same patient' })
  }
  if (request?.intakeSheet?.billVerification?.reusedFromRequestId) {
    reasons.push({ key: 'bill_reused', label: 'The bill number was used on another request' })
  }
  return reasons
}

export const callRecorded = (request) => !!request?.intakeSheet?.verificationCall?.at
