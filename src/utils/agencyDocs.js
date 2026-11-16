// Phase 2C (2026-11-16): each agency's own document list (agencies.requirements,
// document type names) checked against what a request has. Used as a WARNING
// at endorsement (the lists are broader than the patient checklist, so a hard
// block would stop almost every endorsement) and in the patient's coverage plan.
//
// An outpatient has no Hospital Billing Statement: the unit's charge slip
// stands in for it (Phase 2A).

const norm = (s) => String(s ?? '').toLowerCase().trim()
const BILLING = 'hospital billing statement'
const CHARGE_SLIP = 'charge slip from the hospital unit'

// The agency's listed documents this request is still missing.
//   requirements: agency.requirements (names); haveNames: names on the request
//   (any status — the hospital verifies them); request: for the care setting.
export function missingAgencyDocs(requirements, haveNames, request) {
  const have = new Set([...(haveNames ?? [])].map(norm))
  const outpatient = request?.careSetting === 'outpatient'
  return (requirements ?? []).filter((name) => {
    const n = norm(name)
    if (!n || have.has(n)) return false
    if (outpatient && n === BILLING && have.has(CHARGE_SLIP)) return false
    return true
  })
}
