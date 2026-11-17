// Funder type (2026-11-17; reports/Legislator funders and anti epal rule.md).
// Set only by the Super Admin (firestore.rules pins it for agency staff), so a
// private fund is never mistaken for government aid — the FY2026 GAA rules
// (Sec. 19-20) apply to government money, not to a private/NGO fund. A label
// only: it changes nothing about how a funder works. Keep FUNDING_TYPE_VALUES
// in sync with fundingTypeOk() in firestore.rules.
export const FUNDING_TYPES = [
  { value: 'national_program', label: 'National government program', short: 'National gov’t', cls: 'bg-blue-50 text-blue-700' },
  { value: 'regional_program', label: 'BARMM / regional program',     short: 'BARMM / regional', cls: 'bg-teal-50 text-teal-700' },
  { value: 'lgu_program',      label: 'LGU program',                  short: 'LGU',              cls: 'bg-indigo-50 text-indigo-700' },
  { value: 'private',          label: 'Private / NGO fund',           short: 'Private / NGO',    cls: 'bg-amber-50 text-amber-800' },
]
export const FUNDING_TYPE_VALUES = FUNDING_TYPES.map(t => t.value)

const find = (v) => FUNDING_TYPES.find(t => t.value === v) ?? null

export const fundingTypeLabel = (v) => find(v)?.label ?? 'Type not set'
export const fundingTypeShort = (v) => find(v)?.short ?? 'Type not set'
export const fundingTypeClass = (v) => find(v)?.cls ?? 'bg-gray-100 text-gray-600'

// "Private / NGO fund · Alagang Tingog Monthly Fund"
export function fundingSummary(agency) {
  const src = agency?.budget?.fundSource?.trim?.() || agency?.fundSource?.trim?.() || ''
  return [fundingTypeLabel(agency?.fundingType), src].filter(Boolean).join(' · ')
}
