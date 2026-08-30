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

// Philippine per-capita monthly poverty threshold (~₱2,600 — the ~₱13,000/month
// family-of-5 line ÷ 5, 2024 basis; see docs/intake-sheet-fields.md). Approximate
// and configurable — it only drives an ADVISORY suggestion the social worker
// confirms; classification stays a manual judgment by design.
export const POVERTY_LINE_PER_CAPITA = 2600

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

export const REQUIRED_FIELDS = [
  { key: 'householdSize',     label: 'Household Size' },
  { key: 'monthlyIncome',     label: 'Monthly Income' },
  { key: 'diagnosis',         label: 'Diagnosis' },
  { key: 'recommendation',    label: 'Recommendation' },
  { key: 'meansTestCategory', label: 'Means-Test Category' },
  { key: 'completedBy',       label: 'Author' },
]

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
  employer:          '',
  lengthOfEmployment:'',
  incomeSource:      '',
  expenses: { food: '', utilities: '', rent: '', education: '', medicine: '', other: '' },
  diagnosis:         '',
  attendingPhysician:'',
  hospitalCaseNumber:'',
  dateOfAdmission:   '',
  estimatedTotalCost:'',
  caseStudyNarrative:'',
  recommendation:    '',
  meansTestCategory: '',
})

// The full sheet is complete when BOTH the patient facts AND the CRMC
// assessment (means-test + recommendation) are present.
export const isIntakeComplete = (s) => {
  if (!s) return false
  return Boolean(
    s.householdSize && Number(s.householdSize) > 0 &&
    s.monthlyIncome !== '' && Number(s.monthlyIncome) >= 0 &&
    s.diagnosis?.trim() &&
    s.recommendation?.trim() &&
    s.meansTestCategory &&
    s.completedBy
  )
}

// The patient-facts portion (household + income + medical basics) — the part
// the patient fills as a requirement, before CRMC adds its assessment.
export const isPatientIntakeComplete = (s) => {
  if (!s) return false
  return Boolean(
    s.householdSize && Number(s.householdSize) > 0 &&
    s.monthlyIncome !== '' && Number(s.monthlyIncome) >= 0 &&
    s.diagnosis?.trim()
  )
}

// Returns array of { key, label, done } for each required field.
export const requiredFieldsStatus = (sheet, currentUserName) => {
  if (!sheet) sheet = {}
  return REQUIRED_FIELDS.map(f => {
    let done = false
    if (f.key === 'householdSize')     done = !!sheet.householdSize && Number(sheet.householdSize) > 0
    else if (f.key === 'monthlyIncome') done = sheet.monthlyIncome !== '' && Number(sheet.monthlyIncome) >= 0
    else if (f.key === 'completedBy')   done = !!(sheet.completedBy || currentUserName)
    else                                done = !!sheet[f.key]?.toString().trim()
    return { ...f, done }
  })
}
