/**
 * demo-accounts.js
 *
 * Canonical list of seed accounts for the pilot environment. ONE source
 * of truth -- both bootstrap-users.js (first-time create) and
 * repair-demo-accounts.js (force-reset after drift) import from here so
 * the credentials shown on the login page's "DEV ONLY -- DEMO ACCOUNTS"
 * panel always match what's actually in Firebase Auth + Firestore.
 *
 * The 15 accounts cover every role in the system:
 *   - 2 CRMC admins (super_admin + staff_admin)
 *   - 6 agency_admins (one per agency)
 *   - 6 agency coordinators (one per agency)
 *   - 1 demo patient
 *
 * RA 11463 reconciliation (2026-07-24). The Malasakit Center is a
 * COORDINATION HUB, not a funding agency (see
 * docs/malasakit-center-research-2026-07-23.md), so its two agency
 * logins are seeded `active: false` -- kept for the historical
 * Guarantee Letter that admin@malasakit (Dr. Roberto Velasco) approved,
 * but unable to sign in (AuthContext blocks active === false). DOH-MAIP,
 * a real RA 11463 funder that had no accounts, gets a fresh admin +
 * coordinator. This mirrors the agencies collection: doh created,
 * malasakit kept-but-disabled. The five ACTIVE funders are now
 * DOH / PhilHealth / AMBaG / PCSO / DSWD.
 *
 * Adding a new demo account: add it here. Both scripts pick it up
 * automatically on next run. The login page's demo panel
 * (src/pages/auth/Login.jsx) is a SEPARATE hardcoded list -- update it
 * too if the set of loggable accounts changes.
 */

import fs from 'node:fs'

// C1: the demo password is NOT hard-coded — the seed scripts refuse to run
// unless DEMO_ACCOUNT_PASSWORD (min 12 chars) is set, and refuse to touch the
// production project (mapa-crmc) without an explicit --allow-production flag.
export function requireDemoPassword() {
  const pw = process.env.DEMO_ACCOUNT_PASSWORD
  if (!pw || pw.length < 12) {
    console.error('[demo-accounts] Refusing to run: set DEMO_ACCOUNT_PASSWORD to a value of at least 12 characters.')
    process.exit(1)
  }
  return pw
}

export function detectProjectId() {
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT
  if (process.env.GCLOUD_PROJECT)       return process.env.GCLOUD_PROJECT
  try {
    return JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')).project_id ?? null
  } catch { return null }
}

export function assertNotProduction(projectId, argv = process.argv) {
  if (projectId === 'mapa-crmc' && !argv.includes('--allow-production')) {
    console.error('[demo-accounts] Refusing to run against the production project "mapa-crmc" without --allow-production.')
    process.exit(1)
  }
}

export const USERS = [
  // CRMC admins
  {
    email: 'admin@crmc.gov.ph', password: process.env.DEMO_ACCOUNT_PASSWORD,
    profile: { name: 'Super Admin', role: 'super_admin', rank: 'high', agencyId: null, contact: null, cooldown: 0, deletion: false },
  },
  {
    email: 'staff@crmc.gov.ph', password: process.env.DEMO_ACCOUNT_PASSWORD,
    profile: { name: 'Staff Admin', role: 'staff_admin', rank: 'low', agencyId: null, contact: null, cooldown: 0, deletion: false },
  },

  // Agency admins (one per funding agency; malasakit deactivated -- see header)
  {
    // Coordination hub, not a funder. active:false -> cannot sign in.
    // Retained because this account approved the historical GL on the
    // one completed application (Dr. Roberto Velasco).
    email: 'admin@malasakit.gov.ph', password: process.env.DEMO_ACCOUNT_PASSWORD,
    profile: { name: 'Dr. Roberto Velasco',   role: 'agency_admin', agencyId: 'malasakit', rank: null, contact: null, cooldown: 0, deletion: false, active: false },
  },
  {
    email: 'admin@doh.gov.ph', password: process.env.DEMO_ACCOUNT_PASSWORD,
    profile: { name: 'Dr. Elena Marasigan',   role: 'agency_admin', agencyId: 'doh',       rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'admin@philhealth.gov.ph', password: process.env.DEMO_ACCOUNT_PASSWORD,
    profile: { name: 'Dr. Ramon Aquino',      role: 'agency_admin', agencyId: 'philhealth',rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'admin@ambag.gov.ph', password: process.env.DEMO_ACCOUNT_PASSWORD,
    profile: { name: 'Bai Sittie Mamondiong', role: 'agency_admin', agencyId: 'ambag',     rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'admin@pcso.gov.ph', password: process.env.DEMO_ACCOUNT_PASSWORD,
    profile: { name: 'Dr. Carmen Reyes',      role: 'agency_admin', agencyId: 'pcso',      rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'admin@dswd.gov.ph', password: process.env.DEMO_ACCOUNT_PASSWORD,
    profile: { name: 'Datu Hakim Sangcopan',  role: 'agency_admin', agencyId: 'dswd',      rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },

  // Agency coordinators (frontline; malasakit deactivated -- see header)
  {
    email: 'coordinator@malasakit.gov.ph', password: process.env.DEMO_ACCOUNT_PASSWORD,
    profile: { name: 'Maria Santos',    role: 'agency', agencyId: 'malasakit', rank: null, contact: null, cooldown: 0, deletion: false, active: false },
  },
  {
    email: 'coordinator@doh.gov.ph', password: process.env.DEMO_ACCOUNT_PASSWORD,
    profile: { name: 'Joel Bautista',   role: 'agency', agencyId: 'doh',       rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'coordinator@philhealth.gov.ph', password: process.env.DEMO_ACCOUNT_PASSWORD,
    profile: { name: 'Grace Villanueva',role: 'agency', agencyId: 'philhealth',rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'coordinator@ambag.gov.ph', password: process.env.DEMO_ACCOUNT_PASSWORD,
    profile: { name: 'Ahmad Dimaporo',  role: 'agency', agencyId: 'ambag',     rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'coordinator@pcso.gov.ph', password: process.env.DEMO_ACCOUNT_PASSWORD,
    profile: { name: 'Leonora Guia',    role: 'agency', agencyId: 'pcso',      rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'coordinator@dswd.gov.ph', password: process.env.DEMO_ACCOUNT_PASSWORD,
    profile: { name: 'Fatima Macalawi', role: 'agency', agencyId: 'dswd',      rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },

  // Demo patient (kept in the bootstrap for symmetry with the legacy
  // /seed flow -- patients CAN self-register through /register, but
  // having a demo patient pre-seeded makes the login-page Demo Accounts
  // panel work on a fresh DB without a manual register run)
  {
    email: 'patient@gmail.com', password: process.env.DEMO_ACCOUNT_PASSWORD,
    profile: { name: 'Baher Blah', role: 'patient', agencyId: null, rank: null, contact: '09324324344', hospitalId: 'CRMC-2026-00014', patientId: 'PAT-013', cooldown: 0, deletion: false },
  },
]