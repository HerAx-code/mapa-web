// Hospital (tenant) loading + stamping — multi-hospital Phases 1–2.
// See docs/multi-hospital-network-plan.md.
//
// FIELD NAME: the tenant is `tenantId` (the id of a hospitals/{id} doc).
// NOT `hospitalId` — that name already means the patient's ACCESS CODE
// (users.hospitalId = 'MAPA-2026-00001', the hospitalIds collection), and the
// rules, Register, Patients and the GL all read it that way.
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import { applyHospital, DEFAULT_HOSPITAL_ID } from '../config/org'

// Agencies are network-level (decision D1/D4): they partner with many
// hospitals, so an agency user belongs to no tenant. Records an agency writes
// about a case take the tenant of that case (request / slice), never the
// agency's.
const NETWORK_ROLES = ['agency', 'agency_admin']
export const isNetworkRole = (role) => NETWORK_ROLES.includes(role)

// Which hospital a signed-in user belongs to — null for agency users.
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

// Client-side counterpart for small collections everyone may read
// (announcements): keep the user's hospital's docs plus network-wide ones
// (no tenantId — agency announcements, pre-tenancy docs).
export const inMyTenant = (d) => {
  const t = scopedTenant()
  return !t || !d?.tenantId || d.tenantId === t
}

// Users in scope for a gateway directory or broadcast: the user's own
// hospital's users PLUS agency users (network-level, no tenantId). Two
// queries, because one Firestore query can't express "tenant X or no tenant".
// `roles` (optional) narrows both. Returns the user docs (snapshots).
export async function getUsersInScope(db, roles = null) {
  const users = collection(db, 'users')
  const t = scopedTenant()
  if (!t) {
    const snap = await getDocs(roles ? query(users, where('role', 'in', roles)) : users)
    return snap.docs
  }
  const hospitalRoles = roles ? roles.filter((r) => !isNetworkRole(r)) : null
  const networkRoles  = roles ? roles.filter(isNetworkRole) : NETWORK_ROLES
  const queries = []
  if (hospitalRoles === null)  queries.push(query(users, where('tenantId', '==', t)))
  else if (hospitalRoles.length) queries.push(query(users, where('tenantId', '==', t), where('role', 'in', hospitalRoles)))
  if (networkRoles.length) queries.push(query(users, where('role', 'in', networkRoles)))
  const snaps = await Promise.all(queries.map((q) => getDocs(q)))
  const seen = new Set()
  return snaps.flatMap((s) => s.docs).filter((d) => !seen.has(d.id) && seen.add(d.id))
}
