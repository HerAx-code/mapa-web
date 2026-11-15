// Patient-bound access codes (2026-11-15). A hospital issues each code to a
// named patient at the desk; the details live in the staff-only
// hospitalIds/{code}/privateInfo/issued doc. Claiming the code needs the
// patient's last name + birthdate to match: the Cloud Function checks it
// (rate-limited) and the Firestore rules check the same `proof` string, so it
// can't be skipped from the browser. KEEP IN SYNC with
// functions/src/codeIssue.js (tests/utils/codeIssue.test.js checks parity).

// Last name compared on letters only: case, accents, spaces and hyphens
// ignored ("Dela Cruz" = "DELA-CRUZ" = "delacruz"; "Peñaflor" = "Penaflor").
export const lastNameKey = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z]/g, '')

// birthdate as YYYY-MM-DD (an <input type="date"> value).
export const isBirthdate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? '')) && !Number.isNaN(Date.parse(s))

export const codeProof = (lastName, birthdate) => `${lastNameKey(lastName)}|${birthdate}`

// The account name staff record, built exactly the way Register builds it, so
// the rules can require users.name == issued.name.
export const fullNameOf = ({ firstName, middleName, lastName, suffix }) =>
  [firstName, middleName, lastName, suffix].map(s => String(s ?? '').trim()).filter(Boolean).join(' ')

// Codes printed before patient-bound issuing (no `bound` flag) keep working
// until this date, then stop. Same date in firestore.rules and
// functions/src/codeIssue.js.
export const BLANK_CODE_CUTOFF = '2026-12-15'
export const blankCodeExpired = (now = new Date()) => now >= new Date(`${BLANK_CODE_CUTOFF}T00:00:00+08:00`)

export const ID_TYPES = [
  'PhilSys National ID', 'UMID / SSS / GSIS', "Driver's License", 'Passport', 'PRC ID',
  "Voter's ID / Certificate", 'Postal ID', 'Senior Citizen ID', 'PWD ID', 'Barangay ID', 'Other',
]
