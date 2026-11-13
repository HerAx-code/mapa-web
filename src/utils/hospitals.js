// Hospital (tenant) loading + stamping — multi-hospital Phases 1–2.
// See docs/multi-hospital-network-plan.md.
//
// FIELD NAME: the tenant is `tenantId` (the id of a hospitals/{id} doc).
// NOT `hospitalId` — that name already means the patient's ACCESS CODE
// (users.hospitalId = 'MAPA-2026-00001', the hospitalIds collection), and the
// rules, Register, Patients and the GL all read it that way.
import { doc, getDoc } from 'firebase/firestore'
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
