// Residency eligibility (assistance-model remediation Phase 2.1).
//
// The first *decision-bearing* routing signal in MAPA: some funders only serve
// residents of a given area. AMBaG, for example, is a BARMM government program
// — endorsing a non-Bangsamoro patient to it wastes the clock for a patient in
// crisis. The structured province is already collected at registration (see
// utils/address.js) and now snapshotted onto the request, so we can flag the
// mismatch at endorsement.
//
// GUARDRAIL (binds the whole remediation plan): this is ADVISORY ONLY. It never
// hard-blocks an endorsement — a social worker may know an exception the data
// doesn't, and a wrongly-stored province must not lock a patient out. The
// EndorseModal uses it to *flag and sort*, not to disable. Unknown province
// (legacy requests, free-text origins) resolves to 'unknown', never
// 'out_of_area', so nothing is excluded on missing data.

import { BARMM_PROVINCES } from './barmm'

// Scopes an agency may declare in `agency.eligibility.residencyScope`:
//   'nationwide'            — serves everyone (the default when unset)
//   'barmm'                 — serves the BARMM provinces (utils/barmm.js)
//   [ 'Province A', ... ]   — an explicit province allowlist (future use)
export const RESIDENCY_SCOPES = ['nationwide', 'barmm']

// The set of provinces a scope admits. 'nationwide' admits everyone, so it
// has no finite list and is handled before this is called.
function provincesForScope(scope) {
  if (scope === 'barmm') return BARMM_PROVINCES
  if (Array.isArray(scope)) return scope
  return [] // unknown scope string → admits no one (caller treats as advisory)
}

/**
 * Tri-state residency check for a patient (by province) against one agency.
 * @param {string} patientProvince - structured province string, may be empty
 * @param {object} agency - agency doc; reads agency.eligibility.residencyScope
 * @returns {'eligible'|'out_of_area'|'unknown'}
 */
export function residencyEligibility(patientProvince, agency) {
  const scope = agency?.eligibility?.residencyScope ?? 'nationwide'
  if (scope === 'nationwide') return 'eligible'

  const prov = String(patientProvince ?? '').trim()
  if (!prov) return 'unknown' // no data → never exclude; flag as unknown

  return provincesForScope(scope).includes(prov) ? 'eligible' : 'out_of_area'
}

/**
 * Boolean convenience: is this patient NOT disqualified by residency?
 * 'unknown' counts as eligible — we never exclude on missing data.
 */
export function isResidencyEligible(patientProvince, agency) {
  return residencyEligibility(patientProvince, agency) !== 'out_of_area'
}

// Does an agency actually gate on residency? (i.e. is its scope narrower than
// nationwide?) Used by the UI to decide whether to show a residency chip at all
// — nationwide agencies have nothing to decide, so showing a chip would be noise.
export function hasResidencyScope(agency) {
  const scope = agency?.eligibility?.residencyScope ?? 'nationwide'
  return scope !== 'nationwide'
}
