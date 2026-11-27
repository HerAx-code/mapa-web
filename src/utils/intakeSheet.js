// Shared helpers for the Unified Intake Sheet.

// Patient classification per DOH AO 2021-0044 (2026-11-16; reports/DOH
// patient classification and CoE.md): household monthly income per person vs
// the PSA poverty line of the hospital's region. Below 140% Indigent (C3);
// 140–180% Financially incapacitated (C2); above 180% up to 220% (C1); above
// 220% Financially capable. Exactly 140% is C2 (the AO's body text and Annex A;
// its p.5 table differs). Labels read "Name — band".
export const MEANS_CATEGORIES = [
  { value: '',                 label: 'Select category...' },
  { value: 'indigent_c3',      label: 'Indigent (C3) — below 140% of the poverty line' },
  { value: 'incapacitated_c2', label: 'Financially incapacitated (C2) — 140% to 180%' },
  { value: 'incapacitated_c1', label: 'Financially incapacitated (C1) — above 180% up to 220%' },
  { value: 'capable',          label: 'Financially capable — above 220%' },
]

// The scale used before 2026-11-16. Stored records keep their value (a
// decision made on that scale); they are shown as "old scale" and never reused.
export const LEGACY_MEANS_CATEGORIES = {
  indigent:        'Indigent',
  marginalized:    'Marginalized',
  low_income:      'Low income',
  above_threshold: 'Above threshold',
}
export const isLegacyCategory = (v) => !!v && v in LEGACY_MEANS_CATEGORIES

// Short display name for a stored category, new or old scale.
export const meansCategoryLabel = (v) => {
  if (!v) return ''
  if (isLegacyCategory(v)) return `${LEGACY_MEANS_CATEGORIES[v]} (old scale)`
  return (MEANS_CATEGORIES.find(c => c.value === v)?.label ?? v).split('—')[0].trim()
}

// AO 2021-0044 modifiers that support a class below Capable (VI.A.4–5).
export const SUPPORTING_CIRCUMSTANCES = [
  { value: 'elderly',           label: 'Senior citizen' },
  { value: 'pwd',               label: 'Person with disability' },
  { value: 'solo_parent',       label: 'Solo parent' },
  { value: 'indigenous',        label: 'Indigenous people' },
  { value: 'crisis',            label: 'Crisis situation' },
  { value: 'no_support',        label: 'No support system' },
  { value: 'orphan',            label: 'Orphan' },
  { value: 'informal_settler',  label: 'Informal settler' },
  { value: 'displaced',         label: 'Displaced person' },
  { value: 'complex_condition', label: 'Complex medical condition' },
  { value: 'other',             label: 'Other' },
]

// How long a classification stays valid (AO 2021-0044: 6 months to a year,
// by length of treatment). The social worker picks one.
export const CLASSIFICATION_VALIDITY_MONTHS = [6, 12]

export const EMPLOYMENT_TYPES = [
  { value: '',              label: 'Select...' },
  { value: 'employed',      label: 'Employed' },
  { value: 'self-employed', label: 'Self-employed' },
  { value: 'unemployed',    label: 'Unemployed' },
  { value: 'retired',       label: 'Retired' },
  { value: 'other',         label: 'Other' },
]

// Relationship to the patient — the list lives in src/data/relationships.js
// (shared with registration); re-exported here for the intake sheet code.
import { RELATIONSHIPS } from '../data/relationships'
export { RELATIONSHIPS }

// Display label for a stored relationship. Sheets saved before the dropdown
// hold free text ("Tita") — show that as typed rather than blank.
export const relationshipLabel = (value) =>
  RELATIONSHIPS.find(r => r.value === value)?.label ?? (value ?? '')

// Monthly expense lines, in display order. All six are required on the
// patient wizard (₱0 allowed).
//
// 2026-11-27 (Tier 1 relabel; reports/Intake sheet expense labels.md): one
// label for staff and patients (`label` === `en`, so the two views never name a
// line differently), plus a one-line example hint in each language. The stored
// keys are unchanged, so existing sheets read the same. Filipino labels
// Pagkain / Pag-aaral / Iba pa follow the Malasakit Unified Intake Sheet
// (JAO 2020-0001 Annex B); the other Filipino wording is unsourced and is to be
// confirmed with the gateway's social workers before release.
export const EXPENSE_FIELDS = [
  { key: 'food', label: 'Food', en: 'Food', fil: 'Pagkain',
    hintEn: 'For example, rice, ulam, milk, baby formula',
    hintFil: 'Halimbawa: bigas, ulam, gatas, gatas ng bata' },
  { key: 'utilities', label: 'Electricity and water', en: 'Electricity and water', fil: 'Kuryente at tubig',
    hintEn: 'Include LPG, charcoal or firewood for cooking',
    hintFil: 'Kasama ang LPG, uling o kahoy na panluto' },
  { key: 'rent', label: 'Rent or house payment', en: 'Rent or house payment', fil: 'Upa o hulog sa bahay',
    hintEn: 'Rent or monthly house payment; 0 if you own it or stay for free',
    hintFil: 'Upa o buwanang hulog; 0 kung sariling bahay o nakikitira' },
  { key: 'education', label: 'School costs', en: 'School costs', fil: 'Pag-aaral',
    hintEn: 'For example, baon, school fare, projects, fees',
    hintFil: 'Halimbawa: baon, pamasahe ng bata, proyekto, bayad sa eskwela' },
  // Not the bill under assessment: counting it here would inflate the shortfall.
  { key: 'medicine', label: 'Medicine and check-ups', en: 'Medicine and check-ups', fil: 'Gamot at pagpapagamot',
    hintEn: 'Regular medicine and check-ups, not this hospital bill',
    hintFil: 'Maintenance na gamot at check-up, hindi ang bill na ito' },
  { key: 'other', label: 'Other regular costs', en: 'Other regular costs', fil: 'Iba pa',
    hintEn: 'For example, fare, phone load, soap, loan payments',
    hintFil: 'Halimbawa: pamasahe, load, sabon, bayad-utang' },
]

// The Expenses section's one instruction (patient wizard).
export const EXPENSE_INSTRUCTION = {
  en: 'Your family\'s costs in a usual month. An estimate is OK. Put 0 if you have none.',
  fil: 'Gastos ng pamilya sa karaniwang buwan. Puwedeng tantiya lang. Ilagay ang 0 kung wala.',
}

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

// The poverty line a classification uses: the one stored on the sheet when it
// was classified (so agencies, prints and later views see the same basis),
// else the hospital's current setting (hospitalSettings.povertyLinePerCapita,
// entered by its Hospital Admin from the PSA figure for its region). null when
// neither is set — no suggestion is offered then; nothing is hard-coded.
export function povertyBasis(sheet, settings) {
  const b = sheet?.classificationBasis
  if (b && Number(b.povertyLine) > 0) {
    return { povertyLine: Number(b.povertyLine), year: b.year ?? null, region: b.region ?? '', citationShort: b.citationShort ?? '', status: b.status ?? '' }
  }
  const line = Number(settings?.povertyLinePerCapita)
  if (line > 0) {
    return { povertyLine: line, year: settings.povertyLineYear ?? null, region: settings.region ?? '',
      citationShort: settings.povertyLineCitationShort ?? '', status: settings.povertyLineStatus ?? '' }
  }
  return null
}

// Per-person monthly income cut-offs for a poverty line.
export const classCutoffs = (povertyLine) => ({
  c3Below: povertyLine * 1.4,
  c2UpTo:  povertyLine * 1.8,
  c1UpTo:  povertyLine * 2.2,
})

// MAIFIP (DOH AO 2026-0031): a household not classed indigent is "financially
// incapacitated" when out-of-pocket costs exceed 10% of household income
// (read here as a year's income). Advisory. null when inputs are blank.
export function maifipCatastrophic({ bill, monthlyIncome } = {}) {
  if (bill === '' || bill == null || monthlyIncome === '' || monthlyIncome == null) return null
  const b = Number(bill), inc = Number(monthlyIncome)
  if (!Number.isFinite(b) || b <= 0 || !Number.isFinite(inc) || inc < 0) return null
  return b > 0.1 * 12 * inc
}

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

// Per-person income for blank-safe inputs, or null.
function perCapitaOf(monthlyIncome, householdSize) {
  // Blank ('' / null / undefined) means "not entered yet". A real 0 income
  // still counts (Number('') would otherwise read as 0).
  if (monthlyIncome === '' || monthlyIncome == null) return null
  if (householdSize === '' || householdSize == null) return null
  const income = Number(monthlyIncome)
  const size   = Number(householdSize)
  if (!Number.isFinite(income) || income < 0) return null
  if (!Number.isFinite(size) || size <= 0) return null
  return income / size
}

// Advisory classification (AO 2021-0044 bands) from income per person vs the
// poverty line. A 4Ps member (Pantawid ID seen) is suggested Indigent (C3),
// as Malasakit issues their Certificate of Eligibility on the ID (JAO
// 2020-0001). Returns { perCapita, ratio, category, via4Ps } or null when
// there is nothing to suggest from (no poverty line, or blank income/size).
export function meansTestSuggestion({ monthlyIncome, householdSize, povertyLine, is4Ps = false } = {}) {
  const perCapita = perCapitaOf(monthlyIncome, householdSize)
  const line = Number(povertyLine)
  const ratio = perCapita != null && line > 0 ? perCapita / line : null
  if (is4Ps) return { perCapita, ratio, category: 'indigent_c3', via4Ps: true }
  if (ratio == null) return null
  const category = ratio < 1.4 ? 'indigent_c3'
    : ratio <= 1.8 ? 'incapacitated_c2'
    : ratio <= 2.2 ? 'incapacitated_c1'
    : 'capable'
  return { perCapita, ratio, category, via4Ps: false }
}

// The suggestion for a sheet, using its own stored basis (or `settings`).
export const sheetSuggestion = (s, settings) => meansTestSuggestion({
  monthlyIncome: s?.monthlyIncome, householdSize: s?.householdSize,
  povertyLine: povertyBasis(s, settings)?.povertyLine, is4Ps: !!s?.is4Ps,
})

// A written reason is required when the social worker's category departs from
// the advisory suggestion, or when they classify a patient Financially capable
// — the decision stays theirs, but every exception is explained and audited.
// Old-scale categories never ask for one (they were decided on that scale).
export function needsMeansTestReason(s, settings) {
  const category = s?.meansTestCategory
  if (!category || isLegacyCategory(category)) return false
  if (category === 'capable') return true
  const suggestion = sheetSuggestion(s, settings)
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
  // AO 2021-0044 classification details (2026-11-16).
  is4Ps:             false,     // 4Ps member, Pantawid ID seen
  circumstances:     [],        // SUPPORTING_CIRCUMSTANCES values
  circumstancesOther:'',
  classificationValidMonths: 6, // CLASSIFICATION_VALIDITY_MONTHS
  classificationBasis: null,    // { povertyLine, year, region } stamped when classified
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

// Phase 3 PR 3.2 (gap N17): a monthly income counts only when it was actually
// entered. A blank one is stored as null, and null used to read as ₱0 —
// completing the sheet and suggesting the poorest class. ₱0 must be typed as 0.
export const incomeGiven = (v) => v !== '' && v != null && Number.isFinite(Number(v)) && Number(v) >= 0

// The full sheet is complete when BOTH the patient facts AND the gateway
// assessment (means-test + recommendation) are present. `bill` = the request's
// totalBill, for the bill-confirmation check.
export const isIntakeComplete = (s, bill) => {
  if (!s) return false
  return Boolean(
    s.householdSize && Number(s.householdSize) > 0 &&
    incomeGiven(s.monthlyIncome) &&
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
    incomeGiven(s.monthlyIncome) &&
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
    else if (f.key === 'monthlyIncome') done = incomeGiven(sheet.monthlyIncome)
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
