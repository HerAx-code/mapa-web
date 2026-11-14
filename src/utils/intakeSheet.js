// Shared helpers for the Unified Intake Sheet.

export const MEANS_CATEGORIES = [
  { value: '',                 label: 'Select category...' },
  { value: 'indigent',         label: 'Indigent — below poverty threshold' },
  { value: 'marginalized',     label: 'Marginalized — within 1.5× poverty threshold' },
  { value: 'low_income',       label: 'Low Income — within 2× poverty threshold' },
  { value: 'above_threshold',  label: 'Above Threshold — generally not eligible' },
]

export const EMPLOYMENT_TYPES = [
  { value: '',              label: 'Select...' },
  { value: 'employed',      label: 'Employed' },
  { value: 'self-employed', label: 'Self-employed' },
  { value: 'unemployed',    label: 'Unemployed' },
  { value: 'retired',       label: 'Retired' },
  { value: 'other',         label: 'Other' },
]

// Relationship to the patient — a fixed list (was free text) so the sheet,
// the printout and any future analytics agree. Stored as `value`; patient
// screens show en/fil, staff screens + the printout show `label`.
export const RELATIONSHIPS = [
  { value: 'spouse',         label: 'Spouse',                        en: 'Spouse',                        fil: 'Asawa' },
  { value: 'partner',        label: 'Live-in partner',               en: 'Live-in partner',               fil: 'Kinakasama' },
  { value: 'child',          label: 'Son / Daughter',                en: 'Son / Daughter',                fil: 'Anak' },
  { value: 'parent',         label: 'Father / Mother',               en: 'Father / Mother',               fil: 'Magulang' },
  { value: 'sibling',        label: 'Brother / Sister',              en: 'Brother / Sister',              fil: 'Kapatid' },
  { value: 'grandparent',    label: 'Grandparent',                   en: 'Grandparent',                   fil: 'Lolo / Lola' },
  { value: 'grandchild',     label: 'Grandchild',                    en: 'Grandchild',                    fil: 'Apo' },
  { value: 'in_law',         label: 'In-law',                        en: 'In-law',                        fil: 'Biyenan / Manugang / Bayaw / Hipag' },
  { value: 'other_relative', label: 'Other relative',                en: 'Other relative',                fil: 'Ibang kamag-anak' },
  { value: 'non_relative',   label: 'Not related (boarder, helper)', en: 'Not related (boarder, helper)', fil: 'Hindi kaanak' },
]

// Display label for a stored relationship. Sheets saved before the dropdown
// hold free text ("Tita") — show that as typed rather than blank.
export const relationshipLabel = (value) =>
  RELATIONSHIPS.find(r => r.value === value)?.label ?? (value ?? '')

// Monthly expense lines, in display order. All six are required on the
// patient wizard (₱0 allowed).
export const EXPENSE_FIELDS = [
  { key: 'food',      label: 'Food',          en: 'Food',          fil: 'Pagkain' },
  { key: 'utilities', label: 'Utilities',     en: 'Water & power', fil: 'Tubig at kuryente' },
  { key: 'rent',      label: 'Rent',          en: 'Rent',          fil: 'Upa sa bahay' },
  { key: 'education', label: 'Education',     en: 'Education',     fil: 'Pag-aaral' },
  { key: 'medicine',  label: 'Medicine',      en: 'Medicine',      fil: 'Gamot' },
  { key: 'other',     label: 'Other',         en: 'Other',         fil: 'Iba pa' },
]

// Most household members (besides the patient) the wizard accepts.
export const MAX_HOUSEHOLD_OTHERS = 20

// How a household covers monthly expenses that exceed its income. Spending
// more than you earn is common (and usually true) for the families MAPA
// serves, so a shortfall is ASKED ABOUT, never blocked — blocking would push
// patients to fudge the numbers. Multiple choices allowed.
export const SHORTFALL_SOURCES = [
  { value: 'borrowing',   label: 'Borrowing / loans',                 en: 'Borrowing / loans',                 fil: 'Pangungutang' },
  { value: 'relatives',   label: 'Help from relatives or friends',    en: 'Help from relatives or friends',    fil: 'Tulong ng kamag-anak o kaibigan' },
  { value: 'remittance',  label: 'Remittance from abroad',            en: 'Money sent from abroad',            fil: 'Padala mula sa ibang bansa' },
  { value: 'government',  label: 'Government aid (4Ps, etc.)',        en: 'Government aid (4Ps, etc.)',        fil: 'Tulong ng gobyerno (4Ps, atbp.)' },
  { value: 'savings',     label: 'Savings or selling belongings',     en: 'Savings or selling belongings',     fil: 'Ipon o pagbebenta ng gamit' },
  { value: 'other',       label: 'Other',                             en: 'Other',                             fil: 'Iba pa' },
]
export const shortfallLabel = (v) => SHORTFALL_SOURCES.find(s => s.value === v)?.label ?? v

// Total of the expense lines (blank lines count as 0).
export const expenseTotal = (s) =>
  EXPENSE_FIELDS.reduce((sum, f) => sum + (Number(s?.expenses?.[f.key]) || 0), 0)

// Monthly shortfall (expenses − income), or 0. Only when income is entered.
export function monthlyShortfall(s) {
  if (s?.monthlyIncome === '' || s?.monthlyIncome == null) return 0
  const income = Number(s.monthlyIncome)
  if (!Number.isFinite(income) || income < 0) return 0
  return Math.max(0, expenseTotal(s) - income)
}

// Expenses this many times income are more likely a typo (₱80,000 for
// ₱8,000) than real — the wizard asks the patient to double-check.
export const EXPENSE_DOUBLE_CHECK_RATIO = 3
export function expensesLookMistyped(s) {
  const income = Number(s?.monthlyIncome)
  return Number.isFinite(income) && income > 0 && expenseTotal(s) > EXPENSE_DOUBLE_CHECK_RATIO * income
}

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}

// Per-capita monthly poverty threshold the advisory means-test compares to.
// Default ₱2,600 (the ~₱13,000/month family-of-5 line ÷ 5, 2024 national basis;
// see docs/intake-sheet-fields.md). Set VITE_POVERTY_LINE_PER_CAPITA to the
// current official PSA figure for the region at build time. It only drives an
// ADVISORY suggestion — classification stays the social worker's judgment.
export const POVERTY_LINE_PER_CAPITA = Number(env.VITE_POVERTY_LINE_PER_CAPITA) > 0
  ? Number(env.VITE_POVERTY_LINE_PER_CAPITA)
  : 2600

// How many months of the household's whole income the bill equals — the
// "financially incapacitated" signal: a family above the poverty line can
// still be unable to pay a bill worth a year or more of income.
// Returns { months } (Infinity when income is 0) or null when inputs are blank.
export function billIncomeMonths({ bill, monthlyIncome } = {}) {
  if (bill === '' || bill == null || monthlyIncome === '' || monthlyIncome == null) return null
  const b = Number(bill)
  const inc = Number(monthlyIncome)
  if (!Number.isFinite(b) || b <= 0 || !Number.isFinite(inc) || inc < 0) return null
  return { months: inc === 0 ? Infinity : b / inc }
}

// Advisory means-test suggestion from income-per-capita vs the poverty line.
// Returns { perCapita, ratio, category } or null when inputs are insufficient.
// Bands mirror MEANS_CATEGORIES: <1× indigent · <1.5× marginalized ·
// <2× low_income · ≥2× above_threshold.
export function meansTestSuggestion({ monthlyIncome, householdSize } = {}) {
  // Blank ('' / null / undefined) means "not entered yet" — no suggestion. A
  // real 0 income still classifies (Number('') would otherwise read as 0).
  if (monthlyIncome === '' || monthlyIncome == null) return null
  if (householdSize === '' || householdSize == null) return null
  const income = Number(monthlyIncome)
  const size   = Number(householdSize)
  if (!Number.isFinite(income) || income < 0) return null
  if (!Number.isFinite(size) || size <= 0) return null
  const perCapita = income / size
  const ratio = perCapita / POVERTY_LINE_PER_CAPITA
  const category = ratio < 1 ? 'indigent'
    : ratio < 1.5 ? 'marginalized'
    : ratio < 2 ? 'low_income'
    : 'above_threshold'
  return { perCapita, ratio, category }
}

// A written reason is required when the social worker's category departs from
// the advisory suggestion, or when they classify a patient Above Threshold —
// the decision stays theirs, but every exception is explained and audited.
export function needsMeansTestReason(s) {
  const category = s?.meansTestCategory
  if (!category) return false
  if (category === 'above_threshold') return true
  const suggestion = meansTestSuggestion({ monthlyIncome: s.monthlyIncome, householdSize: s.householdSize })
  return !!suggestion && suggestion.category !== category
}

export const REQUIRED_FIELDS = [
  { key: 'householdSize',     label: 'Household Size' },
  { key: 'monthlyIncome',     label: 'Monthly Income' },
  { key: 'diagnosis',         label: 'Diagnosis' },
  { key: 'recommendation',    label: 'Recommendation' },
  { key: 'meansTestCategory', label: 'Means-Test Category' },
  { key: 'completedBy',       label: 'Author' },
]

// Only required while needsMeansTestReason() is true.
export const MEANS_TEST_REASON_FIELD = { key: 'meansTestOverrideReason', label: 'Reason for category' }

export const EMPTY_FAMILY_MEMBER = {
  name: '',
  relationship: '',
  age: '',
  occupation: '',
  monthlyContribution: '',
}

export const blankSheet = () => ({
  familyMembers:     [{ ...EMPTY_FAMILY_MEMBER }],
  householdSize:     '',
  monthlyIncome:     '',
  employmentType:    '',
  employmentTypeOther: '',
  employer:          '',
  lengthOfEmployment:'',
  incomeSource:      '',
  expenses: { food: '', utilities: '', rent: '', education: '', medicine: '', other: '' },
  shortfallCoverage: [],      // SHORTFALL_SOURCES values; asked only when expenses > income
  shortfallCoverageOther: '', // required when shortfallCoverage includes 'other'
  diagnosis:         '',
  attendingPhysician:'',
  hospitalCaseNumber:'',
  dateOfAdmission:   '',
  estimatedTotalCost:'',
  caseStudyNarrative:'',
  recommendation:    '',
  meansTestCategory: '',
  meansTestOverrideReason: '',
})

// Revision 11: the bill amount is confirmed by staff against the uploaded
// billing statement (intakeSheet.billVerification). It counts only while it
// matches the request's current bill — editing the bill afterwards needs a
// fresh confirmation. `bill` unknown (agency views) → confirmed at all.
export const billVerified = (s, bill) => {
  const v = s?.billVerification
  if (!v || v.amount == null) return false
  return bill == null || Number(v.amount) === Number(bill)
}

// The full sheet is complete when BOTH the patient facts AND the gateway
// assessment (means-test + recommendation) are present. `bill` = the request's
// totalBill, for the bill-confirmation check.
export const isIntakeComplete = (s, bill) => {
  if (!s) return false
  return Boolean(
    s.householdSize && Number(s.householdSize) > 0 &&
    s.monthlyIncome !== '' && Number(s.monthlyIncome) >= 0 &&
    s.diagnosis?.trim() &&
    s.recommendation?.trim() &&
    s.meansTestCategory &&
    (!needsMeansTestReason(s) || s.meansTestOverrideReason?.trim()) &&
    // Revision 9: the patient's answers must be verified section by section.
    // Only for sheets flagged verificationRequired (set when staff first work
    // a not-yet-complete sheet) — already-assessed cases are grandfathered.
    (!s.verificationRequired || allSectionsVerified(s)) &&
    // Revision 11: same grandfathering — only sheets flagged
    // billVerificationRequired need the bill confirmed.
    (!s.billVerificationRequired || billVerified(s, bill)) &&
    s.completedBy
  )
}

// The patient-facts portion (household + income + medical basics) — the part
// the patient fills as a requirement, before the gateway adds its assessment.
export const isPatientIntakeComplete = (s) => {
  if (!s) return false
  return Boolean(
    s.householdSize && Number(s.householdSize) > 0 &&
    s.monthlyIncome !== '' && Number(s.monthlyIncome) >= 0 &&
    s.diagnosis?.trim()
  )
}

// Returns array of { key, label, done } for each required field.
export const requiredFieldsStatus = (sheet, currentUserName, bill) => {
  if (!sheet) sheet = {}
  const fields = [
    ...(sheet.billVerificationRequired ? [{ key: 'verify.bill', label: 'Bill amount verified' }] : []),
    ...REQUIRED_FIELDS,
    ...(needsMeansTestReason(sheet) ? [MEANS_TEST_REASON_FIELD] : []),
    ...(sheet.verificationRequired ? FACT_SECTIONS.map(sec => ({ key: `verify.${sec.key}`, label: `${sec.label} verified` })) : []),
  ]
  return fields.map(f => {
    let done = false
    if (f.key === 'verify.bill')        done = billVerified(sheet, bill)
    else if (f.key.startsWith('verify.')) done = sectionVerification(sheet, f.key.slice(7)).status === 'verified'
    else if (f.key === 'householdSize') done = !!sheet.householdSize && Number(sheet.householdSize) > 0
    else if (f.key === 'monthlyIncome') done = sheet.monthlyIncome !== '' && Number(sheet.monthlyIncome) >= 0
    else if (f.key === 'completedBy')   done = !!(sheet.completedBy || currentUserName)
    else                                done = !!sheet[f.key]?.toString().trim()
    return { ...f, done }
  })
}

// ── Patient facts: lock + change tracking (intake improvements A2/A3) ───────
//
// The keys a PATIENT may write on their own request's intakeSheet. Mirrors the
// allowlist in firestore.rules (requests update, patient intake branch), which
// adds only `patientFilledAt`. Everything else on the sheet — the assessment,
// factsLocked*, reviewedFacts — is gateway-staff only.
export const PATIENT_FACT_KEYS = [
  'familyMembers', 'householdSize', 'monthlyIncome', 'employmentType',
  'employmentTypeOther', 'employer', 'lengthOfEmployment', 'incomeSource',
  'expenses', 'shortfallCoverage', 'shortfallCoverageOther',
  'diagnosis', 'attendingPhysician', 'dateOfAdmission', 'estimatedTotalCost',
]

export const factsOf = (s) => Object.fromEntries(PATIENT_FACT_KEYS.map(k => [k, s?.[k] ?? null]))

// Canonical form for comparing a fact across its shapes: form state holds
// strings ('8000', ''), Firestore holds numbers/null, and blank member rows or
// blank expense lines exist only in form state. All of those compare equal.
function normFact(v) {
  if (v == null) return ''
  if (Array.isArray(v)) return v.map(normFact).filter(x => !(x && typeof x === 'object' && Object.keys(x).length === 0) && x !== '')
  if (typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) { const n = normFact(v[k]); if (n !== '') out[k] = n }
    return out
  }
  return String(v).trim()
}
export const sameFact = (a, b) => JSON.stringify(normFact(a)) === JSON.stringify(normFact(b))

const MONEY_FACTS = new Set(['monthlyIncome', 'estimatedTotalCost'])
const FACT_LABELS = {
  familyMembers: 'Household members', householdSize: 'Household size', monthlyIncome: 'Monthly income',
  employmentType: 'Work situation', employmentTypeOther: 'Work situation (other)', employer: 'Employer',
  lengthOfEmployment: 'Length of employment', incomeSource: 'Income source', diagnosis: 'Diagnosis',
  attendingPhysician: 'Attending physician', dateOfAdmission: 'Date of admission', estimatedTotalCost: 'Estimated total cost',
  shortfallCoverage: 'How the shortfall is covered', shortfallCoverageOther: 'Shortfall covered by (other)',
}
const blankOut = (v) => v == null || (typeof v === 'string' && !v.trim())
const pesoText = (v) => (blankOut(v) ? '—' : `₱${Number(v).toLocaleString()}`)
const memberText = (m) => {
  const bits = [relationshipLabel(m.relationship), blankOut(m.age) ? null : `${m.age}`].filter(Boolean)
  return `${m.name?.trim() || 'Unnamed'}${bits.length ? ` (${bits.join(', ')})` : ''}`
}
const membersText = (list) => {
  const rows = (list ?? []).filter(m => !sameFact(m, {}))
  return rows.length ? rows.map(memberText).join('; ') : 'none'
}

// What changed between two fact snapshots, as readable rows:
//   [{ key, label, from, to }]
// Expenses are compared line by line; household members as a whole list.
export function factChanges(before, after) {
  if (!before) return []
  const out = []
  for (const key of PATIENT_FACT_KEYS) {
    const a = before[key], b = after?.[key]
    if (sameFact(a, b)) continue
    if (key === 'expenses') {
      for (const f of EXPENSE_FIELDS) {
        if (!sameFact(a?.[f.key], b?.[f.key])) {
          out.push({ key: `expenses.${f.key}`, label: `Expenses: ${f.label}`, from: pesoText(a?.[f.key]), to: pesoText(b?.[f.key]) })
        }
      }
    } else if (key === 'familyMembers') {
      out.push({ key, label: FACT_LABELS[key], from: membersText(a), to: membersText(b) })
    } else if (key === 'shortfallCoverage') {
      const txt = (list) => ((list ?? []).length ? list.map(shortfallLabel).join(', ') : '—')
      out.push({ key, label: FACT_LABELS[key], from: txt(a), to: txt(b) })
    } else if (key === 'employmentType') {
      const lbl = (v) => EMPLOYMENT_TYPES.find(t => t.value === v && v)?.label ?? (blankOut(v) ? '—' : v)
      out.push({ key, label: FACT_LABELS[key], from: lbl(a), to: lbl(b) })
    } else {
      const fmt = MONEY_FACTS.has(key) ? pesoText : (v) => (blankOut(v) ? '—' : String(v).trim())
      out.push({ key, label: FACT_LABELS[key], from: fmt(a), to: fmt(b) })
    }
  }
  return out
}

// Three-way merge of patient facts into the social worker's open form, so a
// patient's update is never silently overwritten by the next staff autosave:
// a fact the worker has NOT edited since `baseline` (the last remote state the
// form saw) takes the new `remote` value; a fact the worker HAS edited keeps
// the worker's value. Non-fact keys (the assessment) are always the worker's.
export function mergeRemoteFacts(local, baseline, remote) {
  const next = { ...local }
  const blank = blankSheet()
  for (const k of PATIENT_FACT_KEYS) {
    if (sameFact(local?.[k], baseline?.[k])) next[k] = remote?.[k] ?? blank[k] ?? ''
  }
  return next
}

// ── Section verification (revision 9) ───────────────────────────────────────
//
// The assessor does not edit the patient's answers — they VERIFY them, one
// section at a time, or flag a section for the patient to correct. Stored
// (staff-only) as intakeSheet.factsVerification[section] =
//   { status: 'verified' | 'needs_correction', note, by, byUid, at, facts }
// where `facts` is a copy of that section's answers at the moment of the
// decision. If the patient later changes the section, the decision no longer
// matches and the section reads as 'changed' — it must be checked again. That
// reset is derived, not written, so the patient can't fake a verification.
export const FACT_SECTIONS = [
  { key: 'family',   label: 'Household',     en: 'Your household',   fil: 'Ang inyong sambahayan',
    keys: ['familyMembers', 'householdSize'] },
  { key: 'income',   label: 'Income & work', en: 'Income & work',    fil: 'Kita at trabaho',
    keys: ['monthlyIncome', 'employmentType', 'employmentTypeOther', 'employer', 'lengthOfEmployment', 'incomeSource'] },
  { key: 'expenses', label: 'Expenses',      en: 'Monthly expenses', fil: 'Buwanang gastusin',
    keys: ['expenses', 'shortfallCoverage', 'shortfallCoverageOther'] },
  { key: 'medical',  label: 'Medical',       en: 'Medical details',  fil: 'Detalye ng sakit',
    keys: ['diagnosis', 'attendingPhysician', 'dateOfAdmission', 'estimatedTotalCost'] },
]

export function sectionFacts(s, sectionKey) {
  const sec = FACT_SECTIONS.find(x => x.key === sectionKey)
  return Object.fromEntries((sec?.keys ?? []).map(k => [k, s?.[k] ?? null]))
}

// Effective state of one section:
//   'pending'          never checked
//   'verified'         checked, answers unchanged since
//   'needs_correction' flagged, patient hasn't changed it yet
//   'changed'          the patient changed it after the decision — re-check
export function sectionVerification(s, sectionKey) {
  const v = s?.factsVerification?.[sectionKey]
  if (!v?.status) return { status: 'pending' }
  if (!sameFact(v.facts, sectionFacts(s, sectionKey))) return { ...v, status: 'changed', previousStatus: v.status }
  return v
}

export function allSectionsVerified(s) {
  return FACT_SECTIONS.every(sec => sectionVerification(s, sec.key).status === 'verified')
}

// Sections currently flagged for the patient to fix, with the assessor's note.
export const sectionsNeedingCorrection = (s) =>
  FACT_SECTIONS.filter(sec => sectionVerification(s, sec.key).status === 'needs_correction')
    .map(sec => ({ ...sec, note: s.factsVerification[sec.key].note ?? '' }))
