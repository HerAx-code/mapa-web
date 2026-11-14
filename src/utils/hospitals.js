// Hospital (tenant) loading + stamping — multi-hospital Phases 1–2.
// See docs/multi-hospital-network-plan.md.
//
// FIELD NAME: the tenant is `tenantId` (the id of a hospitals/{id} doc).
// NOT `hospitalId` — that name already means the patient's ACCESS CODE
// (users.hospitalId = 'MAPA-2026-00001', the hospitalIds collection), and the
// rules, Register, Patients and the GL all read it that way.
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { ORG, applyHospital, brandingFor, DEFAULT_HOSPITAL_ID } from '../config/org'

// Agencies are network-level (decision D1/D4): they partner with many
// hospitals, so an agency user belongs to no tenant. Records an agency writes
// about a case take the tenant of that case (request / slice), never the
// agency's. The platform_admin (Phase 6) runs the network and has no tenant
// either.
const AGENCY_ROLES  = ['agency', 'agency_admin']
const NETWORK_ROLES = [...AGENCY_ROLES, 'platform_admin']
export const isNetworkRole = (role) => NETWORK_ROLES.includes(role)
const isAgencyRoleName = (role) => AGENCY_ROLES.includes(role)

// Which hospital a signed-in user belongs to — null for agency users and the
// platform admin.
// Users carry no tenantId until the Phase 3 backfill, so patients and gateway
// staff fall back to the default (hospital #1).
export const tenantIdFor = (user) =>
  !user || isNetworkRole(user.role) ? null : (user.tenantId || DEFAULT_HOSPITAL_ID)

// The signed-in user's tenant, set at sign-in by AuthContext. Module state
// (like ORG) so non-React utils — logAudit, messages — can stamp it.
let currentTenant = null
export const currentTenantId = () => currentTenant

// Add `tenantId` to a new doc's data when there is one; omit it otherwise
// (agency writes with no case context), so docs never carry tenantId: null.
export const withTenant = (data, tenantId = currentTenant) =>
  tenantId ? { ...data, tenantId } : data

// Set the current tenant and apply its hospital doc's branding to ORG.
// Never throws: a missing doc, a rules denial or an offline read keeps the env
// branding, so a hospital config problem can never block sign-in. The tenant
// itself is kept even then — branding falling back must not re-stamp data.
// Agency users (tenantId null) see the default hospital's branding.
export async function loadHospital(tenantId) {
  currentTenant = tenantId ?? null
  const id = tenantId || DEFAULT_HOSPITAL_ID
  try {
    const snap = await getDoc(doc(db, 'hospitals', id))
    applyHospital(snap.exists() ? snap.data() : null)
  } catch (err) {
    console.warn(`[hospitals] could not load hospitals/${id}; using env defaults`, err)
    applyHospital(null)
  }
}

// Sign-out: no tenant, env branding.
export const clearHospital = () => {
  currentTenant = null
  brandingCache.clear()
  applyHospital(null)
}

// ── Phase 4: tenant-scoped reads ─────────────────────────────────────────
//
// DORMANT until VITE_TENANT_SCOPING=true. Turning it on before the Phase 3
// backfill has run would hide every existing record (they have no tenantId
// yet), so the switch is flipped only after the backfill verifies 0 left.
// Read at call time (not module load) so tests can toggle it.
export const tenantScopingOn = () => import.meta.env.VITE_TENANT_SCOPING === 'true'

const scopedTenant = () => (tenantScopingOn() ? currentTenant : null)

// Constraints that narrow a gateway query to the signed-in user's hospital.
// [] when scoping is off or the user has no tenant (agency users: they work
// across hospitals by design). Spread into query():
//   query(collection(db, 'requests'), ...tenantWhere(), where('status', ...))
export const tenantWhere = () => {
  const t = scopedTenant()
  return t ? [where('tenantId', '==', t)] : []
}

// A hospital's PATIENTS (marketplace, docs/patient-marketplace-plan.md): every
// patient who has filed with it — users.tenantIds — not only those whose
// current hospital it is (users.tenantId moves when a patient files elsewhere,
// and the old hospital keeps its case). Spread into query() on users.
export const patientWhere = () => {
  const t = scopedTenant()
  return t
    ? [where('tenantIds', 'array-contains', t), where('role', '==', 'patient')]
    : [where('role', '==', 'patient')]
}

// Client-side counterpart for small collections everyone may read
// (announcements): keep the user's hospital's docs plus network-wide ones
// (no tenantId — agency announcements, pre-tenancy docs).
export const inMyTenant = (d) => {
  const t = scopedTenant()
  return !t || !d?.tenantId || d.tenantId === t
}

// Agency ↔ hospital partnerships (Phase 7). An agency onboarded before
// Phase 7 has no partnerHospitalIds yet and partners with hospital #1 only —
// the same default the rules apply (firestore.rules agencyPartners).
export const partnerHospitalIdsOf = (agency) =>
  Array.isArray(agency?.partnerHospitalIds) ? agency.partnerHospitalIds : [DEFAULT_HOSPITAL_ID]
export const agencyPartnersWith = (agency, tenantId) =>
  partnerHospitalIdsOf(agency).includes(tenantId || DEFAULT_HOSPITAL_ID)

const GATEWAY_STAFF_ROLES = ['super_admin', 'staff_admin']

// An agency user's directory (Phase 7): gateway staff + agency users of every
// hospital, and only the patients endorsed to their agency (the rules let an
// agency read a patient only when its id is in that patient's agencyIds).
async function agencyDirectory(db, roles, agencyId) {
  const users = collection(db, 'users')
  const wanted = roles ?? [...GATEWAY_STAFF_ROLES, ...AGENCY_ROLES, 'patient']
  const staffRoles = wanted.filter((r) => GATEWAY_STAFF_ROLES.includes(r) || isAgencyRoleName(r))
  const queries = []
  if (staffRoles.length) queries.push(query(users, where('role', 'in', staffRoles)))
  if (wanted.includes('patient') && agencyId) queries.push(query(users, where('agencyIds', 'array-contains', agencyId)))
  const snaps = await Promise.all(queries.map((q) => getDocs(q)))
  const seen = new Set()
  return snaps.flatMap((s) => s.docs).filter((d) => !seen.has(d.id) && seen.add(d.id))
}

// Users in scope for a directory or broadcast. Gateway staff: the user's own
// hospital's users PLUS agency users (network-level, no tenantId) — two
// queries, because one Firestore query can't express "tenant X or no tenant".
// Agency users (pass `viewer`): see agencyDirectory. `roles` (optional)
// narrows the result. Returns the user docs (snapshots).
export async function getUsersInScope(db, roles = null, viewer = null) {
  if (viewer && isAgencyRoleName(viewer.role)) return agencyDirectory(db, roles, viewer.agencyId)
  const users = collection(db, 'users')
  const t = scopedTenant()
  if (!t) {
    const snap = await getDocs(roles ? query(users, where('role', 'in', roles)) : users)
    return snap.docs
  }
  // Directories reach the staff's own hospital plus agency users — never
  // platform admins (they aren't messaging or broadcast recipients).
  const hospitalRoles = roles ? roles.filter((r) => !isNetworkRole(r)) : null
  const networkRoles  = roles ? roles.filter(isAgencyRoleName) : AGENCY_ROLES
  const queries = []
  if (hospitalRoles === null)  queries.push(query(users, where('tenantId', '==', t)))
  else if (hospitalRoles.length) queries.push(query(users, where('tenantId', '==', t), where('role', 'in', hospitalRoles)))
  // Marketplace: patients who filed here but are now at another hospital.
  if (hospitalRoles === null || hospitalRoles.includes('patient')) queries.push(query(users, ...patientWhere()))
  if (networkRoles.length) queries.push(query(users, where('role', 'in', networkRoles)))
  const snaps = await Promise.all(queries.map((q) => getDocs(q)))
  const seen = new Set()
  return snaps.flatMap((s) => s.docs).filter((d) => !seen.has(d.id) && seen.add(d.id))
}

// ── Case-hospital branding (Phase 8) ─────────────────────────────────────────
// Documents (Guarantee Letter, intake sheet) print in the identity of the
// hospital that OWNS the case, not the viewer's. Gateway staff and patients are
// in that hospital already (ORG); an agency user — network-level — needs the
// case's hospital loaded. Cached per hospital for the session; a failed read
// isn't cached, so it retries next time.
const brandingCache = new Map()

export function fetchHospitalBranding(tenantId) {
  const id = tenantId || DEFAULT_HOSPITAL_ID
  if (currentTenant && id === currentTenant) return Promise.resolve({ ...ORG })
  if (!brandingCache.has(id)) {
    brandingCache.set(id, getDoc(doc(db, 'hospitals', id))
      .then((snap) => brandingFor(snap.exists() ? snap.data() : null))
      .catch((err) => {
        console.warn('[hospitals] branding load failed for', id, err)
        brandingCache.delete(id)
        return brandingFor(null)
      }))
  }
  return brandingCache.get(id)
}

export const clearBrandingCache = () => brandingCache.clear()

// An agency's promotion (announcement source 'agency') reaches a hospital's
// patients only when that agency partners with the hospital — the only
// agencies its gateway can endorse them to. Network users (agency staff,
// platform admin: no tenant) see every promotion; an agency we can't find
// (not loaded yet, or deleted) hides its promotion rather than leak it.
export const promoReachesMe = (ann, agencyMap) => {
  if (ann?.source !== 'agency' || !ann.agencyId || !currentTenant) return true
  const agency = agencyMap?.[ann.agencyId]
  return agency ? agencyPartnersWith(agency, currentTenant) : false
}
