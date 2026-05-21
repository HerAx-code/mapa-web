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
