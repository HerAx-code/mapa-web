// Input verification Phase 2: when a request needs a verification call (or a
// desk interview) before it can be endorsed. Each hospital sets its own policy
// in hospitalSettings/{tenantId} (staff-only, so patients can't see the
// threshold and file just under it). The social worker records the call on
// the intake sheet (intakeSheet.verificationCall). Not a rejection — a person
// still decides; it only makes sure someone actually spoke with the patient.

export const DEFAULT_POLICY = {
  interviewAboveAmount: null,  // ₱; null = no amount rule
  interviewOnDuplicate: true,  // another account looks like the same patient
  secondPersonAboveAmount: null, // ₱; null = off (Phase 3)
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

// ── Phase 3 ──────────────────────────────────────────────────────────────────
// The patient's declaration at submission (patient.request.declaration* in the
// locales). Bump the version whenever that text changes, so each request
// records which wording was signed.
export const DECLARATION_VERSION = '2026-11-16'  // 2026-11-16: wording covers outpatient charges (Phase 2A)

// Second-person approval: above the hospital's amount, the staff member who
// confirmed the bill, recorded the call or completed the assessment cannot
// also endorse. Off unless the hospital sets an amount — a hospital with one
// social worker would otherwise be stuck.
export function secondPersonHold({ request, settings, user } = {}) {
  const limit = Number(policyOf(settings).secondPersonAboveAmount)
  const amount = Number(request?.amountNeeded ?? request?.totalBill)
  if (!(limit > 0) || !Number.isFinite(amount) || amount < limit || !user) return null
  const s = request?.intakeSheet ?? {}
  // By uid (gap M15): who confirmed the bill, recorded the call or completed
  // the assessment. Sheets completed before completedByUid existed fall back
  // to the stamped name.
  const uid = user.uid
  const didIt = (!!uid && s.billVerification?.byUid === uid) ||
    (!!uid && s.verificationCall?.byUid === uid) ||
    (s.completedByUid ? s.completedByUid === uid : (!!s.completedBy && s.completedBy === user.name))
  return didIt
    ? { key: 'second_person', label: 'Another staff member must endorse', detail: `You prepared this case, and it is ₱${limit.toLocaleString()} or more` }
    : null
}
