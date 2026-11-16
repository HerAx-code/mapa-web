// Outpatient requests (Phase 2A, 2026-11-16; docs/outpatient-support-plan.md).
//
// A request is either for an admitted patient (inpatient bill — the Hospital
// Billing Statement) or for an outpatient treated at one of the hospital's own
// units (a charge slip from the unit + the doctor's order). Outside pharmacies
// and labs are not covered yet.
//
// Production uses the flat documentTypes list (VITE_PER_TYPE_DOCS off). Each
// documentTypes record may narrow when it applies:
//   required: true           — the legacy "every request" flag
//   careSetting: 'inpatient' — that requirement applies to admitted patients only
//   requiredWhen: { careSetting, assistanceTypes? }
//                            — required only in that setting (and for those
//                              assistance types). Kept separate from `required`
//                              so the pre-Phase-2 site (which reads required ==
//                              true) never asks inpatients for them.

export const CARE_SETTINGS = ['inpatient', 'outpatient']
export const OUTPATIENT_UNITS = ['dialysis', 'chemotherapy', 'pharmacy', 'laboratory', 'clinic']
// PhilHealth hemodialysis benefit: sessions per year (PhilHealth Circular
// 2023-0009 as raised in 2024; see reports/Outpatient medical assistance rules.md).
export const PHILHEALTH_DIALYSIS_SESSIONS = 156
export const DIALYSIS_TYPE = 'Dialysis'

const norm = (s) => String(s ?? '').toLowerCase().trim()

const settingMatches = (wanted, careSetting) => !wanted || wanted === (careSetting || 'inpatient')
const typeMatches = (types, assistanceType) =>
  !Array.isArray(types) || types.length === 0 || types.some(t => norm(t) === norm(assistanceType))

// Is this document type required for a request in this setting / of this type?
export function docTypeRequired(t, { careSetting = 'inpatient', assistanceType = '' } = {}) {
  if (!t) return false
  if (t.required === true && settingMatches(t.careSetting, careSetting)) return true
  const w = t.requiredWhen
  return !!w && settingMatches(w.careSetting, careSetting) && typeMatches(w.assistanceTypes, assistanceType)
}

export const isOutpatient = (request) => request?.careSetting === 'outpatient'
export const isDialysis = (request) => norm(request?.assistanceType) === norm(DIALYSIS_TYPE)

// Outpatient requests are one priced charge slip: agencies together may fund
// it only up to its amount (no over-endorsing buffer; owner answer 14). The
// rules enforce the same cap on requests.amountCommitted.
export function outpatientCapExceeded(request, committedAfter) {
  return isOutpatient(request) && Number(committedAfter) > (Number(request?.amountNeeded) || 0)
}

// Staff-facing (English) label for a request's care setting, e.g.
// "Outpatient · Dialysis unit · 40 of 156 PhilHealth sessions used".
const UNIT_LABEL = {
  dialysis: 'Dialysis unit', chemotherapy: 'Chemotherapy / cancer unit', pharmacy: 'Hospital pharmacy',
  laboratory: 'Laboratory or imaging', clinic: 'Outpatient clinic or procedure',
}
export function careSettingLabel(r) {
  if (!isOutpatient(r)) return 'Admitted (inpatient bill)'
  const parts = ['Outpatient', UNIT_LABEL[r?.careUnit] ?? null]
  if (r?.philhealthSessionsUsed != null) parts.push(`${r.philhealthSessionsUsed} of ${PHILHEALTH_DIALYSIS_SESSIONS} PhilHealth sessions used`)
  return parts.filter(Boolean).join(' · ')
}
