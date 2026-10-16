// ── Canonical agency seed (single source of truth) ─────────────────────────
//
// The funding-agency reference list, shared by the browser seed page
// (src/pages/Seed.jsx) and the Admin-SDK seeder (scripts/bootstrap-reference-data.js)
// so the two can't drift. Was previously duplicated across both plus a dead
// copy in src/utils/constants.js (remediation plan Phase 1.1).
//
// `budget` is NOT defined here — each seeder initializes it at write time
// ({ allocated:0, committed:0, disbursed:0, period:'monthly' }) so first-seed
// doesn't render NaN; the agency_admin allocation flow owns it thereafter.
// `logoUrl` is null for the demo seed; an agency_admin can paste an HTTPS logo
// via /admin/agencies (AgencyAvatar falls back to the color+initials block).
//
// RA 11463 (2026-07-23): Malasakit and PhilHealth are seeded DISABLED. A
// Malasakit Center is a coordination hub, not a funder (that hub role is the
// MAPA gateway itself); PhilHealth is a first-charge DEDUCTION recorded at
// assessment, never a Guarantee-Letter slice — so neither is an endorsable
// "Available Program". See docs/malasakit-center-research-2026-07-23.md.
//
// `eligibility.residencyScope` (remediation Phase 2.1): the residency a funder
// serves — 'nationwide' (default) or 'barmm'. ADVISORY ONLY: the EndorseModal
// flags + sorts on it, never blocks (see src/utils/eligibility.js). AMBaG is a
// BARMM-government program, so it is scoped 'barmm' — ⚠ confirm with CRMC in
// Phase 0 Q2 (see docs/assistance-model-remediation-plan.md) before relying on it.
export const AGENCIES = [
  {
    id: 'malasakit', name: 'Malasakit Center', initials: 'MC', color: 'bg-brand-500', logoUrl: null,
    description: 'Coordination hub, not a funding source. Under RA 11463 and JAO 2020-0001 the Malasakit Center is a co-located one-stop shop where DOH, DSWD, PCSO and PhilHealth receive and process requests; it holds no appropriation for direct patient assistance. In MAPA this function is performed by the gateway role itself, so the Center is retained here for historical records only and is not available for new endorsements.',
    province: 'Cotabato City', city: 'Cotabato City', officeName: 'Hospital Ground Floor', location: 'Hospital Ground Floor, Cotabato City',
    phone: '064-421-2500', slots: { total: 25, remaining: 25 },
    requirements: ['Barangay Certificate of Indigency', 'Hospital Billing Statement', 'Valid ID', 'Medical Abstract'],
    assistanceTypes: ['Hospital Bills / Hospitalization', 'Medicines', 'Laboratory Tests'],
    eligibility: { residencyScope: 'nationwide' },
    processingTime: 'Same Day', enabled: false,
  },
  {
    id: 'doh', name: 'DOH MAIP', initials: 'DH', color: 'bg-emerald-600', logoUrl: null,
    description: 'Medical Assistance for Indigent and Financially-Incapacitated Patients (MAIP), charged to the Department of Health under RA 11463.',
    province: 'Cotabato City', city: 'Cotabato City', officeName: 'DOH Desk, Hospital Ground Floor', location: 'DOH Desk, Hospital Ground Floor, Cotabato City',
    phone: '064-421-2800', slots: { total: 25, remaining: 25 },
    requirements: ['Barangay Certificate of Indigency', 'Hospital Billing Statement', 'Valid ID'],
    assistanceTypes: ['Hospital Bills / Hospitalization', 'Medicines', 'Laboratory Tests', 'Dialysis', 'Surgery / Medical Procedures', 'Chemotherapy'],
    eligibility: { residencyScope: 'nationwide' },
    processingTime: 'Same Day', enabled: true,
  },
  {
    id: 'philhealth', name: 'PhilHealth', initials: 'PH', color: 'bg-teal-600', logoUrl: null,
    description: 'National Health Insurance Fund (NHIF). Under RA 11463 Order of Charging, PhilHealth coverage is applied FIRST to reduce the bill before other agencies fund the balance.',
    province: 'Cotabato City', city: 'Cotabato City', officeName: 'PhilHealth Desk, Hospital Ground Floor', location: 'PhilHealth Desk, Hospital Ground Floor, Cotabato City',
    phone: '064-421-2900', slots: { total: 25, remaining: 25 },
    requirements: ['PhilHealth ID', 'Valid ID'],
    assistanceTypes: ['Hospital Bills / Hospitalization'],
    eligibility: { residencyScope: 'nationwide' },
    processingTime: 'Same Day', enabled: false,
  },
  {
    id: 'ambag', name: 'AMBaG Program', initials: 'AM', color: 'bg-purple-600', logoUrl: null,
    description: 'Zero balance billing for marginalized patients at partner hospitals under the BARMM government.',
    province: 'Cotabato City', city: 'Cotabato City', officeName: 'BARMM Admin Building', location: 'BARMM Admin Building, Cotabato City',
    phone: '064-421-3000', slots: { total: 25, remaining: 25 },
    requirements: ['Barangay Certificate of Indigency', 'PhilHealth ID', 'Valid ID'],
    assistanceTypes: ['Hospital Bills / Hospitalization', 'Medicines', 'Dialysis', 'Chemotherapy', 'Laboratory Tests', 'Surgery / Medical Procedures'],
    // ⚠ Phase 0 Q2 unconfirmed: AMBaG is a BARMM-government program, scoped to
    // Bangsamoro residents here. Confirm the exact rule with CRMC before relying.
    eligibility: { residencyScope: 'barmm' },
    processingTime: '3–5 Days', enabled: true,
  },
  {
    id: 'pcso', name: 'PCSO MAP', initials: 'PC', color: 'bg-red-600', logoUrl: null,
    description: 'Issues guarantee letters covering hospital confinement, dialysis, chemotherapy/radiation, surgery and implants, essential medicines, and laboratory/diagnostic procedures.',
    province: 'Cotabato City', city: 'Cotabato City', officeName: 'Social Services Department', location: 'Social Services Department',
    phone: '064-421-2600', slots: { total: 20, remaining: 20 },
    requirements: ['Medical Certificate', 'Laboratory Results', 'PhilHealth ID', 'Valid ID'],
    assistanceTypes: ['Hospital Bills / Hospitalization', 'Medicines', 'Chemotherapy', 'Dialysis', 'Laboratory Tests', 'Surgery / Medical Procedures'],
    eligibility: { residencyScope: 'nationwide' },
    processingTime: '5–7 Days', enabled: true,
  },
  {
    id: 'dswd', name: 'DSWD AICS', initials: 'DS', color: 'bg-blue-600', logoUrl: null,
    description: 'Assistance to Individuals in Crisis Situations (AICS): guarantee letters to hospitals and funeral homes covering hospital bills, medicines, laboratory/diagnostics, emergency medical needs, and burial assistance.',
    province: 'Cotabato City', city: 'Cotabato City', officeName: 'Social Welfare Office', location: 'Social Welfare Office',
    phone: '064-421-2700', slots: { total: 25, remaining: 25 },
    requirements: ['Barangay Certificate of Indigency', 'Valid ID', 'Crisis Documentation'],
    assistanceTypes: ['Hospital Bills / Hospitalization', 'Medicines', 'Laboratory Tests', 'Emergency Medical Assistance', 'Burial Assistance'],
    eligibility: { residencyScope: 'nationwide' },
    processingTime: 'Same Day', enabled: true,
  },
]

// Budget block every agency starts with (seeders apply this at write time).
export const INITIAL_BUDGET = { allocated: 0, committed: 0, disbursed: 0, period: 'monthly' }
