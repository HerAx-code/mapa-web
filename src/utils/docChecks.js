// Input verification Phase 2 (reports/Patient input verification.md): what the
// social worker checks on a document before verifying it. The markers come
// from the DSWD AICS Citizen's Charter (2024): a medical certificate/abstract
// carries the physician's name, license number and signature and is issued
// within 3 months; the bill carries the billing clerk's name and signature.
// Every tick is stored with the verification (documents.checks), so "verified"
// says what was checked, by whom.
//
// Matched by document type name (reqDocs carry documentTypeName). A document
// with no checklist verifies in one tap, as before.

const norm = (s) => String(s ?? '').toLowerCase()

const MEDICAL = [
  { key: 'physician', label: "Doctor's full name, PRC license number and signature are on it" },
  { key: 'recent',    label: 'Issued within the last 3 months' },
  { key: 'patient',   label: "Patient's name and the condition match this request" },
]
const BILL = [
  { key: 'billing',   label: "Billing clerk's name and signature are on it, or it was checked in the billing system" },
  { key: 'patient',   label: "Patient's name and the admission match this request" },
]
const INDIGENCY = [
  { key: 'barangay',  label: "Issued by the patient's own barangay (matches the address on the account)" },
  { key: 'signed',    label: 'Signed by a barangay official and dated' },
]
// Phase 2A outpatient documents (reports/Outpatient medical assistance rules.md):
// every program requires a signed doctor's order; the price comes from the
// hospital unit's own charge slip; dialysis needs PhilHealth's session count.
const DOCTORS_ORDER = [
  { key: 'physician', label: "Doctor's full name, PRC license number and signature are on it" },
  { key: 'recent',    label: 'Issued within the last 3 months' },
  { key: 'matches',   label: 'What it orders (medicine, sessions, test or procedure) matches the charge slip' },
]
const CHARGE_SLIP = [
  { key: 'unit',      label: "Issued by this hospital's unit (not an outside pharmacy or lab), with the patient's name" },
  { key: 'itemised',  label: 'Itemised and dated, and the total matches the amount in the request' },
  // Phase 2B: a doctor's order can be reused for 3 months, so each new slip
  // is checked against it here (the slip is never reused).
  { key: 'perOrder',  label: "Covers only what the doctor's order prescribes" },
]
const DIALYSIS_CERT = [
  { key: 'sessions',  label: 'Sessions used this year match the number in the request' },
  { key: 'signed',    label: 'Signed by the dialysis unit and dated' },
]
const CASE_STUDY = [
  { key: 'rsw',       label: 'Prepared and signed by a registered social worker, with license number' },
]

export function docChecksFor(docItem) {
  const n = norm(docItem?.documentTypeName ?? docItem?.name)
  if (n.includes('medical certificate') || n.includes('medical abstract')) return MEDICAL
  if (n.includes('billing statement') || n.includes('statement of account')) return BILL
  if (n.includes('indigency')) return INDIGENCY
  if (n.includes('social case study')) return CASE_STUDY
  if (n.includes("doctor's order") || n.includes('doctors order')) return DOCTORS_ORDER
  if (n.includes('charge slip')) return CHARGE_SLIP
  if (n.includes('dialysis sessions certificate')) return DIALYSIS_CERT
  return []
}

export const checksComplete = (items, ticks) => items.every(i => ticks?.[i.key] === true)

// Phase 2B: documents reused from the date printed on them (doctor's order,
// barangay indigency certificate) need that date recorded at verification
// (documents.issuedOn) — see src/utils/documentReuse.js.
export function needsIssuedDate(docItem) {
  const n = norm(docItem?.documentTypeName ?? docItem?.name)
  return n.includes("doctor's order") || n.includes('doctors order') || n.includes('indigency')
}
