// Relationship to the patient — a fixed list (was free text) so the intake
// sheet, the printout, registration's "managed by a family member" and any
// future analytics agree. Stored as `value`; patient screens show en/fil,
// staff screens + the printout show `label`. Kept in its own tiny module so
// Register (main bundle) can use it without pulling in src/utils/intakeSheet.js;
// intakeSheet.js re-exports it.
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
