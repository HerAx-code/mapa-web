// Server copy of src/utils/codeIssue.js (patient-bound access codes).
// KEEP IN SYNC — tests/utils/codeIssue.test.js checks parity.
const lastNameKey = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z]/g, '')

const codeProof = (lastName, birthdate) => `${lastNameKey(lastName)}|${birthdate}`

const BLANK_CODE_CUTOFF = '2026-12-15'
const blankCodeExpired = (now = new Date()) => now >= new Date(`${BLANK_CODE_CUTOFF}T00:00:00+08:00`)

module.exports = { lastNameKey, codeProof, BLANK_CODE_CUTOFF, blankCodeExpired }
