/**
 * demo-accounts.js
 *
 * Canonical list of seed accounts for the pilot environment. ONE source
 * of truth -- both bootstrap-users.js (first-time create) and
 * repair-demo-accounts.js (force-reset after drift) import from here so
 * the credentials shown on the login page's "DEV ONLY -- DEMO ACCOUNTS"
 * panel always match what's actually in Firebase Auth + Firestore.
 *
 * The accounts cover every role in the system, on the two-hospital demo
 * network in scripts/demo-hospitals.js (seeded dev/emulator DB only — never
 * production; bootstrap-users.js refuses to run against mapa-crmc):
 *   - 1 network operator (platform_admin, multi-hospital Phase 6)
 *   - 2 gateway admins per demo hospital (super_admin + staff_admin)
 *   - 6 agency_admins (one per agency)
 *   - 6 agency coordinators (one per agency)
 *   - 1 demo patient
 *
 * Demo network (2026-11-25). Six symmetric funding agencies, each with a
 * working admin + coordinator, split three per hospital (partnering is set by
 * scripts/seed-demo-agencies.mjs, emulator only):
 *   - demo-hospital-a (DGH): DOH / PhilHealth / AMBaG
 *   - demo-hospital-b (DPH): PCSO / DSWD / Malasakit
 * All six are plain enabled funders for the demo. This is DEMO-ONLY and does
 * NOT reflect the canonical agency model in src/data/agencies.seed.js, where
 * PhilHealth is first-charge coverage (not endorsable) and Malasakit is not a
 * funder. The demo overlay enables both and adds the Malasakit agency doc so
 * the network is uniform and easy to drive.
 *
 * Adding a new demo account: add it here. Both scripts pick it up
 * automatically on next run. The login page's demo panel
 * (src/components/DemoAccountsPanel.jsx, shown on Log in when
 * VITE_SHOW_DEMO_ACCOUNTS or VITE_ENABLE_SEED is 'true') reads THIS list, so
 * it can't drift from what's seeded. `loginPanel: false` hides an account
 * from that panel (it is still seeded).
 */

export const USERS = [
  // network operator (multi-hospital Phase 6): hospitals, agencies, reference data
  {
    email: 'platform@mapa.gov.ph', password: 'platform123',
    profile: { name: 'Super Admin', role: 'platform_admin', rank: null, agencyId: null, contact: null, cooldown: 0, deletion: false },
  },
  // gateway admins
  {
    email: 'admin@mapa.gov.ph', password: 'admin123',
    profile: { name: 'Hospital Admin', role: 'super_admin', rank: 'high', agencyId: null, contact: null, cooldown: 0, deletion: false, tenantId: 'demo-hospital-a' },
  },
  {
    email: 'staff@mapa.gov.ph', password: 'staff123',
    profile: { name: 'Staff Admin', role: 'staff_admin', rank: 'low', agencyId: null, contact: null, cooldown: 0, deletion: false, tenantId: 'demo-hospital-a' },
  },
  {
    email: 'admin-b@mapa.gov.ph', password: 'admin123',
    profile: { name: 'Hospital Admin (DPH)', role: 'super_admin', rank: 'high', agencyId: null, contact: null, cooldown: 0, deletion: false, tenantId: 'demo-hospital-b' },
  },
  {
    email: 'staff-b@mapa.gov.ph', password: 'staff123',
    profile: { name: 'Staff Admin (DPH)', role: 'staff_admin', rank: 'low', agencyId: null, contact: null, cooldown: 0, deletion: false, tenantId: 'demo-hospital-b' },
  },

  // Agency admins (one per funding agency; all active funders for the demo)
  {
    email: 'admin@malasakit.gov.ph', password: 'agency123',
    profile: { name: 'Dr. Roberto Velasco',   role: 'agency_admin', agencyId: 'malasakit', rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'admin@doh.gov.ph', password: 'agency123',
    profile: { name: 'Dr. Elena Marasigan',   role: 'agency_admin', agencyId: 'doh',       rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'admin@philhealth.gov.ph', password: 'agency123',
    profile: { name: 'Dr. Ramon Aquino',      role: 'agency_admin', agencyId: 'philhealth',rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'admin@ambag.gov.ph', password: 'agency123',
    profile: { name: 'Bai Sittie Mamondiong', role: 'agency_admin', agencyId: 'ambag',     rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'admin@pcso.gov.ph', password: 'agency123',
    profile: { name: 'Dr. Carmen Reyes',      role: 'agency_admin', agencyId: 'pcso',      rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'admin@dswd.gov.ph', password: 'agency123',
    profile: { name: 'Datu Hakim Sangcopan',  role: 'agency_admin', agencyId: 'dswd',      rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },

  // Agency coordinators (frontline; all active funders for the demo)
  {
    email: 'coordinator@malasakit.gov.ph', password: 'agency123',
    profile: { name: 'Maria Santos',    role: 'agency', agencyId: 'malasakit', rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'coordinator@doh.gov.ph', password: 'agency123',
    profile: { name: 'Joel Bautista',   role: 'agency', agencyId: 'doh',       rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'coordinator@philhealth.gov.ph', password: 'agency123',
    profile: { name: 'Grace Villanueva',role: 'agency', agencyId: 'philhealth',rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'coordinator@ambag.gov.ph', password: 'agency123',
    profile: { name: 'Ahmad Dimaporo',  role: 'agency', agencyId: 'ambag',     rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'coordinator@pcso.gov.ph', password: 'agency123',
    profile: { name: 'Leonora Guia',    role: 'agency', agencyId: 'pcso',      rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'coordinator@dswd.gov.ph', password: 'agency123',
    profile: { name: 'Fatima Macalawi', role: 'agency', agencyId: 'dswd',      rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },

  // Demo patient: a network account with no hospital yet (open sign-up,
  // 2026-11-15). The first demo code at each hospital is issued to this
  // patient (scripts/demo-hospitals.js), so a tester files a request by
  // choosing a hospital and entering DEMOA-2026-00001 / DEMOB-2026-00001 with
  // last name "Dela Paz" and birthdate 1990-05-01.
  {
    email: 'patient@gmail.com', password: 'patient123',
    profile: { name: 'Juan Dela Paz', lastName: 'Dela Paz', birthdate: '1990-05-01', role: 'patient', agencyId: null, rank: null, contact: '09171234567', hospitalId: null, patientId: 'PAT-000001', cooldown: 0, deletion: false },
  },
]