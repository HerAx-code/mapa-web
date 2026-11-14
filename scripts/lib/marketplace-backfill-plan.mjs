// What the patient-marketplace backfill writes
// (scripts/backfill-marketplace.mjs, docs/patient-marketplace-plan.md).
// Pure — no Firestore — so the decisions are unit-tested
// (tests/utils/marketplaceBackfillPlan.test.js).
//
// 1. users/{patient}.tenantIds: every hospital the patient belongs to — their
//    tenantId plus the hospital of every request they filed. The marketplace
//    rules let a hospital read a patient through this field.
// 2. hospitalIds/{code}.requestId: a code that already backs a request is bound
//    to it (one code = one request), so it can't back a second one.
// 3. hospitalsPublic/{id}: re-projected with the marketplace fields (office,
//    address, region, contact email) the rules now require to mirror the hospital.

// requests: [{ id, patientId, tenantId }] → Map(patientId → Set(tenantId)).
export function hospitalsByPatient(requests, defaultTenant) {
  const m = new Map()
  for (const r of requests) {
    if (!r?.patientId) continue
    if (!m.has(r.patientId)) m.set(r.patientId, new Set())
    m.get(r.patientId).add(r.tenantId || defaultTenant)
  }
  return m
}

// The tenantIds a patient doc should carry, or null when it already does.
// Never drops a hospital already listed (additive only).
export function patientTenantIds(user, fromRequests = new Set()) {
  if (user?.role !== 'patient') return null
  const have = Array.isArray(user.tenantIds) ? user.tenantIds : null
  const want = new Set([...(have ?? []), ...(user.tenantId ? [user.tenantId] : []), ...fromRequests])
  if (want.size === 0) return null                       // network patient, never filed
  if (have && want.size === have.length) return null     // nothing missing
  return [...want].sort()
}

// requests: [{ id, patientId, patientHospitalId, submittedAt (ms) }] →
// Map(code → requestId) of the request each code backs. A legacy code that
// backed several requests binds the LATEST (any binding blocks reuse; the
// latest is the one a gateway would look up).
export function requestByCode(requests) {
  const best = new Map()
  for (const r of requests) {
    const code = r?.patientHospitalId
    if (!code || !r.id) continue
    const cur = best.get(code)
    if (!cur || (r.submittedAt ?? 0) > (cur.submittedAt ?? 0)) best.set(code, r)
  }
  return best
}

// Whether hospitalIds/{code} should be bound to `request`: it isn't bound yet,
// and it is the filer's own code (never bind someone else's code).
export function codeVerdict(code, request) {
  if (!code || !request) return 'skip'
  if (code.requestId) return 'already'
  if (code.patId && code.patId !== request.patientId) return 'mismatch'
  return 'bind'
}

// The public projection (mirrors src/utils/hospitalsPublic.js).
export function projectPublicHospital(h = {}) {
  return {
    facilityName:     h.facilityName ?? '',
    shortName:        h.shortName ?? '',
    accessCodePrefix: h.accessCodePrefix ?? '',
    enabled:          h.enabled !== false,
    gatewayName:      h.gatewayName ?? '',
    address:          h.address ?? '',
    region:           h.region ?? '',
    contactEmail:     h.contactEmail ?? '',
  }
}

// Whether hospitalsPublic/{id} differs from the hospital's projection.
export function publicNeedsSync(hospital, current) {
  if (!current) return true
  const want = projectPublicHospital(hospital)
  return Object.keys(want).some((k) => current[k] !== want[k]) ||
    Object.keys(current).some((k) => k !== 'updatedAt' && !(k in want))
}
