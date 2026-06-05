/**
 * demo-accounts.js
 *
 * Canonical list of seed accounts for the pilot environment. ONE source
 * of truth -- both bootstrap-users.js (first-time create) and
 * repair-demo-accounts.js (force-reset after drift) import from here so
 * the credentials shown on the login page's "DEV ONLY -- DEMO ACCOUNTS"
 * panel always match what's actually in Firebase Auth + Firestore.
 *
 * The 11 accounts cover every role in the system:
 *   - 2 CRMC admins (super_admin + staff_admin)
 *   - 4 agency_admins (one per agency)
 *   - 4 agency coordinators (one per agency)
 *   - 1 demo patient
 *
 * Adding a new demo account: add it here. Both scripts pick it up
 * automatically on next run.
 */

export const USERS = [
  // CRMC admins
  {
    email: 'admin@crmc.gov.ph', password: 'admin123',
    profile: { name: 'Super Admin', role: 'super_admin', rank: 'high', agencyId: null, contact: null, cooldown: 0, deletion: false },
  },
  {
    email: 'staff@crmc.gov.ph', password: 'staff123',
    profile: { name: 'Staff Admin', role: 'staff_admin', rank: 'low', agencyId: null, contact: null, cooldown: 0, deletion: false },
  },

  // Agency admins (one per agency)
  {
    email: 'admin@malasakit.gov.ph', password: 'agency123',
    profile: { name: 'Dr. Roberto Velasco',   role: 'agency_admin', agencyId: 'malasakit', rank: null, contact: null, cooldown: 0, deletion: false, active: true },
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

  // Agency coordinators (frontline)
  {
    email: 'coordinator@malasakit.gov.ph', password: 'agency123',
    profile: { name: 'Maria Santos',    role: 'agency', agencyId: 'malasakit', rank: null, contact: null, cooldown: 0, deletion: false, active: true },
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

  // Demo patient (kept in the bootstrap for symmetry with the legacy
  // /seed flow -- patients CAN self-register through /register, but
  // having a demo patient pre-seeded makes the login-page Demo Accounts
  // panel work on a fresh DB without a manual register run)
  {
    email: 'patient@gmail.com', password: 'patient123',
    profile: { name: 'Baher Blah', role: 'patient', agencyId: null, rank: null, contact: '09324324344', hospitalId: 'CRMC-2026-00014', patientId: 'PAT-013', cooldown: 0, deletion: false },
  },
]