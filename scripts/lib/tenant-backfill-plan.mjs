// Which existing docs get a tenantId in the multi-hospital Phase 3 backfill
// (scripts/backfill-tenant-id.mjs, docs/multi-hospital-network-plan.md).
// Pure — no Firestore — so the decisions are unit-tested
// (tests/utils/tenantBackfillPlan.test.js).
//
// Mirrors what the app stamps on NEW docs since Phase 2 (src/utils/hospitals.js
// withTenant): patient + gateway records belong to a hospital; agency-only
// records do not (agencies are network-level).

export const AGENCY_ROLES = ['agency', 'agency_admin']
const isAgencyRole = (role) => AGENCY_ROLES.includes(role)

// collection -> { fields: the minimum fields to read (besides tenantId),
//                 belongs(data, ctx): true if the doc belongs to a hospital }
// ctx.roleOf(uid) -> the user's role, or undefined for an unknown/deleted user.
export const COLLECTIONS = {
  users: {
    fields: ['role'],
    // Patients and gateway staff; agency users are network-level.
    belongs: (d) => ['patient', 'super_admin', 'staff_admin'].includes(d.role),
  },
  hospitalIds:         { fields: [], belongs: () => true },   // access codes
  requests:            { fields: [], belongs: () => true },
  applications:        { fields: [], belongs: () => true },   // slices
  documents:           { fields: [], belongs: () => true },
  documentContents:    { fields: [], belongs: () => true },
  certificates:        { fields: [], belongs: () => true },
  referralSuggestions: { fields: [], belongs: () => true },   // about a case
  conversations: {
    fields: ['participants'],
    // Any thread with a patient or gateway participant. A participant we can't
    // find (deleted account) counts as a hospital user: deleted users are
    // patients far more often than agency staff, and over-including a thread in
    // hospital #1 hides nothing it doesn't already show today.
    belongs: (d, ctx) => {
      const ps = Array.isArray(d.participants) ? d.participants : []
      return ps.some((uid) => !isAgencyRole(ctx.roleOf(uid)))
    },
  },
  reports: {
    fields: ['reporterRole', 'agencyId'],
    // Issue tickets from patients/gateway; agency budget requests stay agency-only.
    belongs: (d) => !isAgencyRole(d.reporterRole) && !d.agencyId,
  },
  announcements: {
    fields: ['source'],
    belongs: (d) => d.source !== 'agency',
  },
  auditLog: {
    fields: ['actorRole'],
    // Gateway, patient and system actors; agency actors are network-level.
    belongs: (d) => !isAgencyRole(d.actorRole),
  },
}

// 'already' (has a tenantId), 'stamp' (gets one), or 'skip' (agency-only).
export function decide(collection, data, ctx) {
  if (typeof data?.tenantId === 'string' && data.tenantId) return 'already'
  return COLLECTIONS[collection].belongs(data ?? {}, ctx) ? 'stamp' : 'skip'
}
