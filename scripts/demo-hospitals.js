/**
 * demo-hospitals.js — the multi-hospital demo network for a seeded dev /
 * emulator database (never production). NO passwords live here: the browser
 * seed page (src/pages/Seed.jsx) imports this file, and that page's chunk is
 * built into every bundle.
 *
 * Shared by scripts/bootstrap-users.js (hospitals, prefixes, patient-bound
 * codes) and the /seed page (agency partnerships), so they can't drift.
 *
 * Current logic (2026-11-15):
 *   - a hospital is a tenant with its own access-code prefix;
 *   - codes are issued to a NAMED patient (privateInfo/issued); claiming one
 *     needs that patient's last name + birthdate;
 *   - patients may sign up without a code; each request needs a code from the
 *     hospital they choose (one code = one request).
 */

export const DEMO_HOSPITALS = [
  {
    id: 'demo-hospital-a', facilityName: 'Demo General Hospital', shortName: 'DGH',
    accessCodePrefix: 'DEMOA', gatewayName: 'Medical Social Service', gatewayInitials: 'MSS',
    address: 'Demo City', region: 'BARMM', contactEmail: 'mss@demo-a.example', enabled: true,
  },
  {
    id: 'demo-hospital-b', facilityName: 'Demo Provincial Hospital', shortName: 'DPH',
    accessCodePrefix: 'DEMOB', gatewayName: 'Medical Social Work Office', gatewayInitials: 'MSWO',
    address: 'Demo Province', region: 'BARMM', contactEmail: 'mswo@demo-b.example', enabled: true,
  },
]

export const DEMO_HOSPITAL_IDS = DEMO_HOSPITALS.map(h => h.id)

// Sample patient-bound codes, issued to fictional patients. The first code at
// each hospital is issued to the demo patient account (patient@gmail.com in
// scripts/demo-accounts.js), so a tester can file a request with it using
// last name "Dela Paz" and birthdate 1990-05-01.
const YEAR = 2026
const patients = [
  { firstName: 'Juan',  lastName: 'Dela Paz',  birthdate: '1990-05-01' },
  { firstName: 'Ana',   lastName: 'Dela Cruz', birthdate: '1985-02-14' },
  { firstName: 'Jose',  lastName: 'Mangudadatu', birthdate: '1972-09-30' },
]
export const DEMO_CODES = DEMO_HOSPITALS.flatMap(h => patients.map((p, i) => ({
  id: `${h.accessCodePrefix}-${YEAR}-${String(i + 1).padStart(5, '0')}`,
  tenantId: h.id,
  patient: p,
})))
