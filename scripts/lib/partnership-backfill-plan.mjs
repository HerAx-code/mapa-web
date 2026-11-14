// What the multi-hospital Phase 7 backfill writes
// (scripts/backfill-partnerships.mjs, docs/multi-hospital-network-plan.md).
// Pure — no Firestore — so the decisions are unit-tested
// (tests/utils/partnershipBackfillPlan.test.js).
//
// 1. agencies/{id}.partnerHospitalIds: every agency onboarded before Phase 7
//    gets [hospital #1] — exactly what the rules already assume for an agency
//    with no list, so stamping it changes no access.
// 2. users/{patient}.agencyIds: the agencies holding a slice for that patient.
//    The Phase 7 rules let an agency read a patient only through this field;
//    the endorse flow writes it from now on, this fills it for existing cases.

export function agencyVerdict(agency) {
  return Array.isArray(agency?.partnerHospitalIds) ? 'already' : 'stamp'
}

// slices: [{ patientId, agencyId }] → Map(patientId → Set(agencyId)).
// Every slice counts, whatever its status: the agency already holds that
// case's slice, so it keeps seeing the patient's profile.
export function agenciesByPatient(slices) {
  const m = new Map()
  for (const s of slices) {
    if (!s?.patientId || !s?.agencyId) continue
    if (!m.has(s.patientId)) m.set(s.patientId, new Set())
    m.get(s.patientId).add(s.agencyId)
  }
  return m
}

// The agency ids a patient's doc is missing (sorted, for stable output).
export function missingAgencyIds(existing, wanted) {
  const have = new Set(Array.isArray(existing) ? existing : [])
  return [...(wanted ?? [])].filter((id) => !have.has(id)).sort()
}
