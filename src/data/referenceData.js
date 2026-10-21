// ── MAPA reference data: assistance types + requirement-driven checklists ───
//
// SINGLE SOURCE OF TRUTH for the assistance-type catalog and the required-
// document rules. Historically these lived (and drifted) across
// src/pages/Seed.jsx, scripts/bootstrap-reference-data.js, and
// src/utils/constants.js. This module is the canonical definition; the seeders
// and the app import from here.
//
// DESIGN (grounded in how mature systems model this — Stripe Connect
// requirements, GOV.UK task lists, IBM Cúram eligibility, decision-table
// patterns):
//   • Requirements are DERIVED from the case (type + attributes + stage) and
//     re-computed on demand, never a static per-request list.           [Stripe]
//   • Each requirement is a small DECLARATIVE record, not a bare id:
//     { docId, when, quantity?, appliesIf? }. This is a decision-table-lite —
//     right for a single-site system; a full rules engine would be over-built.
//   • Values that change (THRESHOLDS) are externalized config, editable in one
//     place.                                                        [Cúram/DMN]
//   • Two timing tiers via `when`: 'submit' (needed to file) and 'assess'
//     (needed before the gateway endorses). 'approve' is reserved for future
//     per-agency (funder-owned) requirements — not modeled yet.        [Stripe]
//
// Scope: inpatient hospital bills (owner decision 2026-10-12). PhilHealth is an
// optional prior-coverage amount, not a required document (money-model step).
//
// ⚠ The per-type requirement lists and THRESHOLDS below are research-grounded
// PLACEHOLDERS (PCSO/DSWD/DOH published requirements). Confirm against the gateway
// Malasakit's real forms — see docs/crmc-document-requirements-checklist.md —
// before enabling VITE_PER_TYPE_DOCS in production.

// Deterministic slug → id (matches scripts/bootstrap-reference-data.js so ids
// line up with any already-seeded Firestore documentTypes docs).
export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

// ── Document types ──────────────────────────────────────────────────────────
// `reusable: true` carries the verified doc across the patient's future
// requests (e.g. Valid ID); everything else is per-request.
export const DOCUMENT_TYPES = [
  { id: 'valid_id',                          name: 'Valid ID',                          description: 'Any government-issued ID',                      reusable: true  },
  { id: 'barangay_certificate_of_indigency', name: 'Barangay Certificate of Indigency', description: 'Issued by the barangay',                        reusable: false },
  { id: 'hospital_billing_statement',        name: 'Hospital Billing Statement',        description: 'Statement of Account (SOA) from the hospital',  reusable: false },
  { id: 'medical_certificate',               name: 'Medical Certificate',               description: 'Certified by a licensed physician',             reusable: false },
  { id: 'medical_abstract',                  name: 'Medical Abstract',                  description: 'Summary of medical condition and treatment',    reusable: false },
  { id: 'philhealth_id',                     name: 'PhilHealth ID',                     description: 'PhilHealth membership card (optional coverage)', reusable: true  },
  { id: 'laboratory_results',                name: 'Laboratory Results',                description: 'Latest diagnostic or lab results',              reusable: false },
  { id: 'surgical_cost_estimate',            name: 'Surgical Cost Estimate',            description: 'Estimated cost of the planned operation',       reusable: false },
  { id: 'treatment_protocol',                name: 'Treatment Protocol',                description: 'Physician treatment plan (e.g. chemotherapy cycles)', reusable: false },
  { id: 'price_quotations',                  name: 'Price Quotations',                  description: 'Supplier quotations for medicines/supplies',    reusable: false },
  { id: 'dialysis_treatment_record',         name: 'Dialysis Treatment Record',         description: 'Record of dialysis sessions / schedule',        reusable: false },
  { id: 'promissory_note',                   name: 'Promissory Note',                   description: 'Signed when the patient is already discharged', reusable: false },
  { id: 'death_certificate',                 name: 'Death Certificate',                 description: 'Registered death certificate of the deceased',  reusable: false },
  { id: 'social_case_study_report',          name: 'Social Case Study Report',          description: 'Prepared by a social worker for high-cost cases', reusable: false },
]

const DOC_BY_ID = Object.fromEntries(DOCUMENT_TYPES.map(d => [d.id, d]))

// ── Externalized thresholds (the gateway confirms — see Part C of the checklist) ────
// Editing these is the intended way to tune policy; no rules engine, no deploy
// cycle beyond a config change. `0`/null disables a threshold rule.
export const THRESHOLDS = {
  socialCaseStudyPhp: 10000, // ≥ this bill amount → a Social Case Study Report is required
}

// ── Requirement timing tiers (earliest first) ───────────────────────────────
// 'submit'  — needed to file the request (patient uploads up front)
// 'assess'  — needed before the gateway endorses (also collected up front today)
// 'approve' — reserved for future funder-owned per-agency requirements
export const WHEN_ORDER = ['submit', 'assess', 'approve']

// Attribute helper for predicates. amountNeeded is the residual the gateway endorses;
// falls back to the raw bill before assessment fills coverage.
const amountNeededOf = (req) => Number(req?.amountNeeded ?? req?.totalBill ?? 0)

// ── Core requirements (every inpatient request) ─────────────────────────────
export const CORE_REQUIREMENTS = [
  { docId: 'valid_id',                          when: 'submit' },
  { docId: 'barangay_certificate_of_indigency', when: 'submit' },
  { docId: 'hospital_billing_statement',        when: 'submit' },
  { docId: 'medical_certificate',               when: 'submit' },
]

// Back-compat / convenience export (ids of the core set).
export const CORE_DOC_IDS = CORE_REQUIREMENTS.map(r => r.docId)

// ── Conditional requirements (apply to ANY type when the predicate holds) ────
// `appliesIf` is a pure (request) => boolean. Keep this list tiny.
export const CONDITIONAL_REQUIREMENTS = [
  { docId: 'social_case_study_report', when: 'assess',
    appliesIf: (req) => THRESHOLDS.socialCaseStudyPhp > 0 && amountNeededOf(req) >= THRESHOLDS.socialCaseStudyPhp },
  // `alreadyDischarged` is a request attribute not captured yet — off until the
  // field exists; left here to show the attribute-driven pattern (Part C Q2).
  { docId: 'promissory_note', when: 'assess',
    appliesIf: (req) => req?.alreadyDischarged === true },
]

// ── Assistance types ──────────────────────────────────────────────────────
// `name` must stay identical to the strings stored on requests +
// agency.assistanceTypes (matching is by name). `requirements` are the EXTRA
// (non-core) requirements for that type. `coreOverride` replaces the core set
// for the rare type that doesn't fit it (Burial: no hospital bill).
export const ASSISTANCE_TYPES = [
  { id: 'hospital_bills',   name: 'Hospital Bills / Hospitalization', description: 'Financial assistance for hospital confinement and related expenses', order: 0, requirements: [] },
  { id: 'surgery',          name: 'Surgery / Medical Procedures',     description: 'Financial support for surgical operations',                         order: 1, requirements: [{ docId: 'surgical_cost_estimate', when: 'assess' }] },
  { id: 'chemotherapy',     name: 'Chemotherapy',                     description: 'Support for cancer treatment and chemotherapy sessions',             order: 2, requirements: [{ docId: 'treatment_protocol', when: 'assess' }, { docId: 'price_quotations', when: 'assess', quantity: 3 }] },
  { id: 'dialysis',         name: 'Dialysis',                         description: 'Assistance for kidney dialysis treatments',                         order: 3, requirements: [{ docId: 'dialysis_treatment_record', when: 'assess' }] },
  { id: 'laboratory_tests', name: 'Laboratory Tests',                 description: 'Coverage for diagnostic tests and laboratory procedures',            order: 4, requirements: [{ docId: 'laboratory_results', when: 'assess' }] },
  { id: 'medicines',        name: 'Medicines',                        description: 'Support for prescription medications',                              order: 5, requirements: [{ docId: 'price_quotations', when: 'assess', quantity: 3 }] },
  { id: 'emergency',        name: 'Emergency Medical Assistance',     description: 'Immediate support for emergency medical situations',                 order: 6, requirements: [] },
  { id: 'burial',           name: 'Burial Assistance',                description: 'Financial support for funeral and burial expenses',                  order: 7, requirements: [{ docId: 'death_certificate', when: 'submit' }], coreOverride: ['valid_id', 'barangay_certificate_of_indigency'] },
]

const TYPE_BY_NAME = Object.fromEntries(ASSISTANCE_TYPES.map(t => [t.name.toLowerCase().trim(), t]))

// ── Resolvers ───────────────────────────────────────────────────────────────

/** Document type record by stable id (or undefined). */
export const documentTypeById = (id) => DOC_BY_ID[id]

/** Assistance type record by display name, case/space-insensitive (or undefined). */
export const assistanceTypeByName = (name) => TYPE_BY_NAME[String(name ?? '').toLowerCase().trim()]

/**
 * Resolve the active requirements for a request, derived from its assistance
 * type + attributes, up to a timing tier. Returns requirement records enriched
 * with their doc: [{ docId, when, quantity?, doc }], de-duplicated by docId
 * (first occurrence wins), in core → type → conditional order.
 *
 * @param request  { assistanceType, amountNeeded?, totalBill?, alreadyDischarged?, ... }
 * @param options  { upTo } — highest tier to include (default 'assess': the
 *                  full patient checklist up to endorsement).
 */
export function resolveRequirements(request = {}, { upTo = 'assess' } = {}) {
  const type = assistanceTypeByName(request.assistanceType)
  const coreReqs = type?.coreOverride
    ? type.coreOverride.map(docId => ({ docId, when: 'submit' }))
    : CORE_REQUIREMENTS
  const maxIdx = WHEN_ORDER.indexOf(upTo)
  const seen = new Set()
  return [...coreReqs, ...(type?.requirements ?? []), ...CONDITIONAL_REQUIREMENTS]
    .filter(r => WHEN_ORDER.indexOf(r.when ?? 'assess') <= maxIdx)
    .filter(r => !r.appliesIf || r.appliesIf(request))
    .filter(r => {
      if (seen.has(r.docId) || !DOC_BY_ID[r.docId]) return false
      seen.add(r.docId)
      return true
    })
    .map(r => ({ docId: r.docId, when: r.when ?? 'assess', quantity: r.quantity, doc: DOC_BY_ID[r.docId] }))
}

/**
 * The patient's required-document checklist for an assistance type, as
 * [{ id, name, reusable, order, quantity? }] — the shape DocChecklist consumes.
 * Pass the in-progress request (amount, etc.) so attribute conditions resolve;
 * with no request, attribute-gated requirements are simply absent (safe).
 * Falls back to the core checklist for an unknown/blank type.
 */
export function requiredDocsFor(assistanceTypeName, request = {}) {
  return resolveRequirements({ ...request, assistanceType: assistanceTypeName }, { upTo: 'assess' })
    .map((r, i) => ({ id: r.doc.id, name: r.doc.name, description: r.doc.description, reusable: !!r.doc.reusable, order: i, quantity: r.quantity }))
}
