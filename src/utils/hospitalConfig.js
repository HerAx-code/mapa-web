// Hospital onboarding form rules — multi-hospital Phase 6 (platform admin).
// Pure functions (no Firestore) so they are unit-tested in
// tests/utils/hospitalConfig.test.js. See docs/multi-hospital-network-plan.md.

// hospitals/{id} — the tenantId stamped on every record of that hospital.
// Lowercase slug; it never changes once records carry it.
export const HOSPITAL_ID_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

// Access-code prefix (<PREFIX>-YYYY-NNNNN). It is interpolated into the access
// code regex (src/config/org.js accessCodeRe), so letters and digits only.
export const ACCESS_PREFIX_RE = /^[A-Z][A-Z0-9]{1,9}$/

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// The editable fields, in the order the form shows them. Mirrors the keys the
// `hospitals` rule allows (firestore.rules hospitalKeysOk) and HOSPITAL_FIELDS
// in src/config/org.js.
export const HOSPITAL_FORM_FIELDS = [
  'facilityName', 'shortName', 'gatewayName', 'gatewayInitials',
  'accessCodePrefix', 'contactEmail', 'address', 'region',
]

// Philippine regions, offered as suggestions for the hospital's region (the
// network admin's console groups hospitals by it). Free text is still allowed.
export const PH_REGIONS = [
  'NCR', 'CAR', 'Region I', 'Region II', 'Region III', 'Region IV-A', 'MIMAROPA',
  'Region V', 'Region VI', 'NIR', 'Region VII', 'Region VIII', 'Region IX',
  'Region X', 'Region XI', 'Region XII', 'Caraga', 'BARMM',
]

export const emptyHospitalForm = () => ({
  id: '', facilityName: '', shortName: '', gatewayName: 'Medical Social Services',
  gatewayInitials: 'MSS', accessCodePrefix: '', contactEmail: '', address: '', region: '',
})

export const normalizeHospitalId = (s) =>
  String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export const normalizePrefix = (s) => String(s ?? '').trim().toUpperCase()

// Suggest an id from the facility name: "Cotabato Provincial Hospital" → "cotabato-provincial-hospital".
export const suggestHospitalId = (facilityName) => normalizeHospitalId(facilityName).slice(0, 40).replace(/-+$/, '')

/**
 * Validate the hospital form. `hospitals` is the current list
 * ([{ id, accessCodePrefix }]); `editingId` is the hospital being edited (null
 * when adding). Returns { field: message } — empty when valid.
 *
 * Prefix uniqueness (decision D5) is checked here against every other
 * hospital; the server-side guarantee arrives with per-hospital access codes
 * (Phase 8), so the platform admin is the single writer until then.
 */
export function validateHospital(form, hospitals = [], editingId = null) {
  const errors = {}
  const others = hospitals.filter((h) => h.id !== editingId)

  if (!editingId) {
    const id = String(form.id ?? '')
    if (!HOSPITAL_ID_RE.test(id)) errors.id = 'Use 3–40 lowercase letters, digits or dashes.'
    else if (hospitals.some((h) => h.id === id)) errors.id = 'A hospital with this ID already exists.'
  }

  if (!String(form.facilityName ?? '').trim()) errors.facilityName = 'Hospital name is required.'
  if (!String(form.gatewayName ?? '').trim()) errors.gatewayName = 'Gateway office name is required.'
  if (String(form.gatewayInitials ?? '').trim().length > 6) errors.gatewayInitials = 'At most 6 characters.'

  const prefix = normalizePrefix(form.accessCodePrefix)
  if (!ACCESS_PREFIX_RE.test(prefix)) errors.accessCodePrefix = '2–10 capital letters or digits, starting with a letter.'
  else if (others.some((h) => normalizePrefix(h.accessCodePrefix) === prefix)) {
    errors.accessCodePrefix = 'Another hospital already uses this prefix.'
  }

  const email = String(form.contactEmail ?? '').trim()
  if (email && !EMAIL_RE.test(email)) errors.contactEmail = 'Enter a valid email address.'

  return errors
}

// The doc written to hospitals/{id}: trimmed, prefix upper-cased, empty
// optional fields dropped. Timestamps are added by the caller.
export function hospitalDocFromForm(form) {
  const out = {}
  for (const key of HOSPITAL_FORM_FIELDS) {
    const v = key === 'accessCodePrefix' ? normalizePrefix(form[key]) : String(form[key] ?? '').trim()
    if (v) out[key] = v
  }
  return out
}
