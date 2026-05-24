// Brand
//
// "MAPA Portal" is redundant — the P in MAPA already stands for Portal.
// Use BRAND_NAME ("MAPA") on its own, or pair with CRMC for context.
export const BRAND_NAME = 'MAPA'
export const BRAND_SUBTITLE = 'CRMC'
export const BRAND_FULL = 'Medical Assistance Portal Access'

// Budget period helpers — budget.period is an adjective ('monthly') which
// reads awkwardly when embedded in phrases like "Budget this monthly".
// Use PERIOD_NOUN[period] for "this {month/quarter/year}" / "per {month}"
// phrasings; keep budget.period for adjective slots ("Monthly budget").
export const PERIOD_NOUN = {
  monthly:   'month',
  quarterly: 'quarter',
  yearly:    'year',
}

// Adjective form, title-cased for headers ("Monthly Budget").
export const PERIOD_ADJECTIVE = {
  monthly:   'Monthly',
  quarterly: 'Quarterly',
  yearly:    'Yearly',
}

// Roles
//
// MAPA's role model reflects the Malasakit Center arrangement: agencies
// (PCSO, DOH, DSWD, congressional offices, NGOs) bring their own funds.
// CRMC hosts the platform. So fund control lives inside the agency:
//   - AGENCY_ADMIN — senior officer at the agency (e.g., PCSO branch head).
//     Controls allocation, manages coordinators, sees own audit log.
//   - AGENCY — coordinator/social worker. Approves cases within allocation.
//   - SUPER_ADMIN — CRMC platform operator. Onboards agencies, doc review,
//     issues Patient Access Codes. Has zero fund authority.
//   - STAFF_ADMIN — CRMC operations staff. Same as super_admin minus
//     destructive actions.
//   - PATIENT — applicant.
export const ROLES = {
  SUPER_ADMIN:  'super_admin',
  STAFF_ADMIN:  'staff_admin',
  AGENCY_ADMIN: 'agency_admin',
  AGENCY:       'agency',
  PATIENT:      'patient',
}

// Helpers — use these instead of role === ROLES.AGENCY comparisons so that
// agency_admin inherits agency permissions automatically.
export const isAgencyRole = (role) => role === ROLES.AGENCY || role === ROLES.AGENCY_ADMIN
export const isCrmcAdminRole = (role) => role === ROLES.SUPER_ADMIN || role === ROLES.STAFF_ADMIN

// Canonical display labels for roles. Import from here instead of redefining
// per-file so wording stays consistent across the UI.
export const ROLE_LABEL = {
  super_admin:  'Super Administrator',
  staff_admin:  'Staff Administrator',
  agency_admin: 'Agency Administrator',
  agency:       'Agency Coordinator',
  patient:      'Patient',
}

// Short labels for tight UI spaces (chips, table cells, badges).
export const ROLE_LABEL_SHORT = {
  super_admin:  'Super Admin',
  staff_admin:  'Staff Admin',
  agency_admin: 'Agency Admin',
  agency:       'Agency Coordinator',
  patient:      'Patient',
}

// Badge color classes per role for consistent UI tinting.
export const ROLE_BADGE = {
  super_admin:  'badge-purple',
  staff_admin:  'badge-blue',
  agency_admin: 'badge-amber',
  agency:       'badge-green',
  patient:      'badge-gray',
}

// ── Status configs ─────────────────────────────────────────────────────────
// Keyed by the LOWERCASE status string actually written to Firestore.
// These are the single source of truth — use <StatusBadge /> instead of
// redefining label/badge maps per file. The previous PascalCase
// APP_STATUS / DOC_STATUS exports were keyed wrong (uppercase) and got
// shadowed by per-file definitions everywhere.

export const APP_STATUS_CONFIG = {
  pending:       { label: 'Pending',            badge: 'badge-blue'   },
  reviewing:     { label: 'Reviewing',          badge: 'badge-amber'  },
  awaiting_info: { label: 'Waiting on Patient', badge: 'badge-orange' },
  interview:     { label: 'Interview',          badge: 'badge-purple' },
  approved:      { label: 'Approved',           badge: 'badge-green'  },
  rejected:      { label: 'Rejected',           badge: 'badge-red'    },
  certificate:   { label: 'GL Issued',          badge: 'badge-green'  },
}

export const DOC_STATUS_CONFIG = {
  pending:  { label: 'Pending Review', badge: 'badge-amber' },
  verified: { label: 'Verified',       badge: 'badge-green' },
  rejected: { label: 'Rejected',       badge: 'badge-red'   },
}

export const REPORT_STATUS_CONFIG = {
  open:        { label: 'Open',        badge: 'badge-amber' },
  in_progress: { label: 'In Progress', badge: 'badge-blue'  },
  resolved:    { label: 'Resolved',    badge: 'badge-green' },
}

// Slot status thresholds
export const SLOT_STATUS = (remaining, total) => {
  if (remaining === 0) return { label: 'Full',    color: 'text-red-600',   bar: 'bg-red-400',   badge: 'badge-red'   }
  if (remaining / total <= 0.25) return { label: 'Limited', color: 'text-amber-600', bar: 'bg-amber-400', badge: 'badge-amber' }
  return { label: `${remaining} slots`, color: 'text-green-600', bar: 'bg-brand-500', badge: 'badge-green' }
}

// Mock agencies
export const AGENCIES = [
  {
    id: 'malasakit',
    name: 'Malasakit Center',
    initials: 'MC',
    color: 'bg-brand-500',
    description: 'Consolidates DOH, DSWD, PhilHealth, and PCSO services for zero balance billing of indigent patients.',
    location: 'CRMC Ground Floor, Cotabato City',
    phone: '064-421-2500',
    slots: { total: 25, remaining: 21 },
    requirements: ['Barangay Certificate of Indigency', 'Hospital Billing Statement', 'Valid ID', 'Medical Abstract'],
    assistanceTypes: ['Hospital Bills / Hospitalization', 'Medicines', 'Laboratory Tests'],
    processingTime: 'Same Day',
  },
  {
    id: 'ambag',
    name: 'AMBaG Program',
    initials: 'AM',
    color: 'bg-purple-600',
    description: 'Zero balance billing for marginalized patients at CRMC and partner hospitals under the BARMM government.',
    location: 'BARMM Admin Building, Cotabato City',
    phone: '064-421-3000',
    slots: { total: 25, remaining: 5 },
    requirements: ['Barangay Certificate of Indigency', 'PhilHealth ID', 'Valid ID'],
    assistanceTypes: ['Hospital Bills / Hospitalization', 'Medicines'],
    processingTime: '3–5 Days',
  },
  {
    id: 'pcso',
    name: 'PCSO MAP',
    initials: 'PC',
    color: 'bg-red-600',
    description: 'Issues guarantee letters covering chemotherapy, radiation therapy, and essential medicines.',
    location: 'Social Services Department, CRMC',
    phone: '064-421-2600',
    slots: { total: 20, remaining: 0 },
    requirements: ['Medical Certificate', 'Laboratory Results', 'PhilHealth ID', 'Valid ID'],
    assistanceTypes: ['Chemotherapy', 'Medicines', 'Laboratory Tests'],
    processingTime: '5–7 Days',
  },
  {
    id: 'dswd',
    name: 'DSWD AICS',
    initials: 'DS',
    color: 'bg-blue-600',
    description: 'Cash assistance and medicine vouchers for individuals in crisis situations through community social workers.',
    location: 'Social Welfare Office, CRMC',
    phone: '064-421-2700',
    slots: { total: 25, remaining: 18 },
    requirements: ['Barangay Certificate of Indigency', 'Valid ID', 'Crisis Documentation'],
    assistanceTypes: ['Hospital Bills / Hospitalization', 'Medicines', 'Emergency Medical Assistance'],
    processingTime: 'Same Day',
  },
]

// Mock notifications for patient
export const PATIENT_NOTIFICATIONS = [
  { id: 1, type: 'certificate_ready',  title: 'Certificate ready',        body: 'Your medical assistance certificate from Malasakit Center is ready.', time: '2 hours ago',  read: false },
  { id: 2, type: 'interview_approved', title: 'Interview approved',        body: 'Your interview for Malasakit Center was approved. Certificate will be prepared shortly.', time: '6 hours ago', read: false },
  { id: 3, type: 'doc_verified',       title: 'Document verified',         body: 'Your Barangay Certificate of Indigency has been verified.', time: '1 day ago', read: false },
  { id: 4, type: 'interview_sched',   title: 'Interview scheduled',       body: 'Your online interview is scheduled for May 13, 2026 at 2:00 PM.', time: '2 days ago', read: false },
  { id: 5, type: 'app_advanced',      title: 'Application advanced',      body: 'Your application for Malasakit Center has been moved to interview stage.', time: '2 days ago', read: false },
  { id: 6, type: 'app_submitted',     title: 'Application submitted',     body: 'You successfully applied to the Malasakit Center program.', time: '6 days ago', read: true },
]
