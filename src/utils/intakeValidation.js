// Step-by-step validation for the patient Household Information wizard
// (src/pages/patient/IntakeWizard.jsx). Pure — no React, no Firestore — so the
// exact rules are unit-tested (tests/utils/intakeValidation.test.js).
//
// Each validator returns the FIRST problem on its step as
//   { field, en, fil }
// or null when the step is fine. `field` names the input to highlight:
// a sheet key ('monthlyIncome'), an expense ('expenses.food'), or a family
// member field ('member.2.age').

import {
  EXPENSE_FIELDS, MAX_HOUSEHOLD_OTHERS, RELATIONSHIPS, EXPENSE_DOUBLE_CHECK_RATIO,
  monthlyShortfall, expensesLookMistyped,
} from './intakeSheet'

const blank = (v) => v === '' || v == null || (typeof v === 'string' && !v.trim())
const num = (v) => Number(v)
const isWhole = (v) => Number.isInteger(num(v))
const peso = (n) => `₱${Math.round(n).toLocaleString()}`
const err = (field, en, fil) => ({ field, en, fil })

const memberHasData = (m) =>
  !!(m && (m.name?.trim() || m.relationship || !blank(m.age) || m.occupation?.trim() || !blank(m.monthlyContribution)))
export { memberHasData }

// Household members besides the patient. householdSize (stored) = others + 1.
export const othersFromHouseholdSize = (size) =>
  blank(size) || !Number.isFinite(num(size)) ? '' : Math.max(num(size) - 1, 0)

function validateFamily(s) {
  const size = s.householdSize
  const others = num(size) - 1
  if (blank(size) || !isWhole(size) || others < 0 || others > MAX_HOUSEHOLD_OTHERS) {
    return err('householdSize',
      `Enter how many people live with you — a whole number from 0 to ${MAX_HOUSEHOLD_OTHERS}.`,
      `Ilagay kung ilan ang kasama ninyo sa bahay — buong numero mula 0 hanggang ${MAX_HOUSEHOLD_OTHERS}.`)
  }
  const members = s.familyMembers ?? []
  if (members.length !== others) {
    return err('householdSize',
      `You said ${others} ${others === 1 ? 'person lives' : 'people live'} with you but listed ${members.length}. Please make them match.`,
      `Sinabi ninyong ${others} ang kasama ninyo pero ${members.length} ang nakalista. Pakitugma.`)
  }
  for (let i = 0; i < members.length; i++) {
    const m = members[i] ?? {}
    const n = i + 1
    if (!m.name?.trim()) {
      return err(`member.${i}.name`, `Enter the name of household member ${n}.`, `Ilagay ang pangalan ng kasapi ${n}.`)
    }
    if (!RELATIONSHIPS.some(r => r.value === m.relationship)) {
      return err(`member.${i}.relationship`, `Choose how household member ${n} is related to you.`, `Piliin ang kaugnayan ng kasapi ${n} sa inyo.`)
    }
    if (blank(m.age) || !isWhole(m.age) || num(m.age) < 0 || num(m.age) > 120) {
      return err(`member.${i}.age`, `Enter the age of household member ${n} (0 to 120).`, `Ilagay ang edad ng kasapi ${n} (0 hanggang 120).`)
    }
    if (!blank(m.monthlyContribution) && !(num(m.monthlyContribution) >= 0)) {
      return err(`member.${i}.monthlyContribution`, `The monthly contribution of member ${n} must be ₱0 or more.`, `Ang buwanang ambag ng kasapi ${n} ay dapat ₱0 o higit pa.`)
    }
  }
  return null
}

function validateIncome(s) {
  if (blank(s.monthlyIncome) || !(num(s.monthlyIncome) >= 0)) {
    return err('monthlyIncome', 'Enter your household\'s monthly income (₱0 or more).', 'Ilagay ang buwanang kita ng sambahayan (₱0 o higit pa).')
  }
  if (!s.employmentType) {
    return err('employmentType', 'Choose your work situation.', 'Piliin ang inyong kalagayan sa trabaho.')
  }
  if (s.employmentType === 'other' && !s.employmentTypeOther?.trim()) {
    return err('employmentTypeOther', 'Describe your work situation.', 'Ilarawan ang inyong trabaho.')
  }
  const income = num(s.monthlyIncome)
  if (['employed', 'self-employed'].includes(s.employmentType) && income === 0) {
    return err('monthlyIncome',
      'You said you have work, but your income is ₱0. Please enter what you earn, or change your work situation.',
      'Sinabi ninyong may trabaho kayo pero ₱0 ang kita. Ilagay ang kinikita, o palitan ang kalagayan sa trabaho.')
  }
  const contributions = (s.familyMembers ?? []).reduce((sum, m) => sum + (num(m?.monthlyContribution) || 0), 0)
  if (contributions > income) {
    return err('monthlyIncome',
      `Your household members contribute ${peso(contributions)} a month, more than the household income of ${peso(income)}. Household income should include everyone's contributions.`,
      `Ang ambag ng mga kasapi ay ${peso(contributions)} kada buwan, mas malaki sa kita ng sambahayan na ${peso(income)}. Dapat kasama sa kita ng sambahayan ang ambag ng lahat.`)
  }
  return null
}

function validateExpenses(s) {
  for (const f of EXPENSE_FIELDS) {
    const v = s.expenses?.[f.key]
    if (blank(v) || !(num(v) >= 0)) {
      return err(`expenses.${f.key}`,
        `Enter your monthly spending on ${f.en.toLowerCase()} (enter 0 if none).`,
        `Ilagay ang buwanang gastos sa ${f.fil.toLowerCase()} (ilagay ang 0 kung wala).`)
    }
  }
  // Likely typo: ask the patient to look again and confirm. `_amountsConfirmed`
  // is form-only state (never saved), so it's asked again in a new session.
  if (expensesLookMistyped(s) && !s._amountsConfirmed) {
    return err('amountsConfirmed',
      `Your expenses are more than ${EXPENSE_DOUBLE_CHECK_RATIO} times your household income. Please double-check the amounts, then tick "The amounts are correct".`,
      `Ang gastos ay higit sa ${EXPENSE_DOUBLE_CHECK_RATIO} beses ng kita ng sambahayan. Pakisuring muli ang mga halaga, at i-tsek ang "Tama ang mga halaga".`)
  }
  // Spending more than you earn is allowed — but asked about.
  if (monthlyShortfall(s) > 0) {
    const cov = s.shortfallCoverage ?? []
    if (!cov.length) {
      return err('shortfallCoverage',
        'Your expenses are more than your income. Choose how you cover the difference.',
        'Mas malaki ang gastos kaysa kita. Piliin kung paano ninyo natutugunan ang kulang.')
    }
    if (cov.includes('other') && !s.shortfallCoverageOther?.trim()) {
      return err('shortfallCoverageOther', 'Describe how else you cover the difference.', 'Ilarawan kung paano pa ninyo natutugunan ang kulang.')
    }
  }
  return null
}

function validateMedical(s, today) {
  if (!s.diagnosis?.trim()) {
    return err('diagnosis', 'Enter the illness or condition.', 'Pakilagay ang sakit o kondisyon.')
  }
  if (s.dateOfAdmission && s.dateOfAdmission > today) {
    return err('dateOfAdmission', 'The admission date can\'t be in the future.', 'Hindi maaaring nasa hinaharap ang petsa ng pag-admit.')
  }
  if (!blank(s.estimatedTotalCost) && !(num(s.estimatedTotalCost) >= 0)) {
    return err('estimatedTotalCost', 'The estimated cost must be ₱0 or more.', 'Ang tinatayang gastos ay dapat ₱0 o higit pa.')
  }
  return null
}

const VALIDATORS = { family: validateFamily, income: validateIncome, expenses: validateExpenses, medical: validateMedical }

// Local YYYY-MM-DD (matches <input type="date"> values).
export const todayIso = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function validateIntakeStep(stepKey, sheet, { today = todayIso() } = {}) {
  const v = VALIDATORS[stepKey]
  return v ? v(sheet ?? {}, today) : null
}

// Every step in order (for Submit — the Edit links let patients jump around).
// Returns { stepKey, ...error } for the first failing step, or null.
export function validateIntakeAll(sheet, stepKeys, opts) {
  for (const key of stepKeys) {
    const e = validateIntakeStep(key, sheet, opts)
    if (e) return { stepKey: key, ...e }
  }
  return null
}
