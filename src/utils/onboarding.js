// Hospital onboarding (reports/Hospital onboarding requirements.md, revalidated
// 2026-11-15). Pure helpers shared by the Super Admin workspace, the hospital
// list and the Hospital Admin checklist — so every surface agrees on what a
// stage needs and when a hospital may go live.
//
// Stages follow how Philippine hospitals actually join a program: an
// expression of interest + the hospital head's letter of intent, verification
// against the DOH registry, a MOA signed by both sides (with the Data Privacy
// Act paperwork), setup + training, then go-live — the point at which patients
// may register with the hospital's access codes.

export const STAGES = [
  { key: 'interest',     label: 'Interest' },
  { key: 'verification', label: 'Verification' },
  { key: 'agreement',    label: 'Agreement' },
  { key: 'setup',        label: 'Setup & training' },
  { key: 'live',         label: 'Live' },
]
export const DECLINED = 'declined'
export const stageIndex = (key) => STAGES.findIndex(s => s.key === key)
export const stageLabel = (key) => (key === DECLINED ? 'Declined' : STAGES.find(s => s.key === key)?.label ?? key)

// Requests made before stages existed carry only the old status.
const LEGACY = { new: 'interest', contacted: 'verification', onboarded: 'setup', declined: DECLINED }
export const stageOf = (r) => r?.stage ?? LEGACY[r?.status] ?? 'interest'

// Ownership decides who signs (the report's "who signs" table).
export const OWNERSHIP_TYPES = [
  { value: 'DOH-retained', label: 'DOH hospital',          signer: 'Chief of Hospital / Medical Center Chief', authority: 'DOH personnel order or delegation' },
  { value: 'BARMM MOH',    label: 'BARMM Ministry of Health hospital', signer: 'Minister of Health or delegated Chief of Hospital', authority: 'MOH order or delegation' },
  { value: 'LGU',          label: 'Provincial / city / municipal hospital', signer: 'Governor or Mayor', authority: 'Sanggunian resolution authorizing the signer' },
  { value: 'Private',      label: 'Private / foundation hospital', signer: 'Officer named in a board resolution', authority: 'Board resolution + Secretary’s Certificate' },
  { value: 'SUC',          label: 'State university hospital', signer: 'University President or delegate', authority: 'Board of Regents authority' },
  { value: 'DND',          label: 'Military hospital (DND)', signer: 'Commanding officer or delegate', authority: 'Delegation order' },
  { value: 'Other',        label: 'Other', signer: 'Head of the institution', authority: 'Proof of authority to sign' },
]
export const ownershipOf = (value) => OWNERSHIP_TYPES.find(o => o.value === value) ?? OWNERSHIP_TYPES[OWNERSHIP_TYPES.length - 1]

// Document slots the Super Admin files (uploaded from what the hospital sends).
export const DOCUMENTS = [
  { key: 'loi', stage: 'interest',  label: 'Letter of intent from the hospital head', required: true },
  { key: 'authority', stage: 'agreement', label: 'Proof of the signatory’s authority', required: true },
  { key: 'moa', stage: 'agreement', label: 'MOA signed by both parties (no-cost, no obligation to purchase)', required: true },
  { key: 'dpa', stage: 'agreement', label: 'Data processing agreement (DPA IRR Sec. 44)', required: true },
  { key: 'dpo', stage: 'agreement', label: 'Data Protection Officer designation', required: true },
  { key: 'pia', stage: 'agreement', label: 'Privacy impact assessment signed by the DPO', required: true },
  { key: 'dsa', stage: 'agreement', label: 'Data sharing agreement(s) with funders (recommended)', required: false },
  { key: 'golive', stage: 'setup',  label: 'Go-live acceptance signed by the hospital', required: true },
]
const has = (r, key) => !!r?.documents?.[key]?.path

export const PLAN_TIERS = [
  { value: 'pilot',            label: 'Pilot' },
  { value: 'public_sponsored', label: 'Public — sponsored' },
  { value: 'private_standard', label: 'Private — standard' },
  { value: 'network',          label: 'Network (funder-paid)' },
]

const DAY = 86400000
const toDate = (v) => (v == null || v === '' ? null : v?.toDate ? v.toDate() : new Date(v))

// What each stage needs before it can be completed. [{ key, label, done }]
export function stageChecklist(stage, r = {}, ctx = {}) {
  const v = r.verification ?? {}
  const a = r.agreement ?? {}
  const t = r.training ?? {}
  switch (stage) {
    case 'interest':
      return [
        { key: 'loi', label: 'Letter of intent from the hospital head filed', done: has(r, 'loi') },
      ]
    case 'verification':
      return [
        { key: 'nhfr', label: 'NHFR facility code checked against the DOH registry', done: !!v.nhfrCode?.trim() && !!v.nhfrChecked },
        { key: 'lto', label: 'DOH License to Operate number and expiry recorded', done: !!v.ltoNumber?.trim() && !!v.ltoExpiry },
        { key: 'philhealth', label: 'PhilHealth accreditation recorded (or noted as none)', done: !!v.philhealthNo?.trim() || !!v.philhealthNone },
        { key: 'ownership', label: 'Ownership type confirmed', done: !!v.ownershipType },
        { key: 'callback', label: 'Call-back on the hospital’s official number (from the registry, not the form)', done: !!v.callbackAt },
      ]
    case 'agreement':
      return [
        { key: 'authority', label: 'Signatory’s authority on file', done: has(r, 'authority') },
        { key: 'moa', label: 'MOA signed by both parties, with its term', done: has(r, 'moa') && !!a.moaSignedAt && !!a.moaTermEnd },
        { key: 'noProcure', label: 'MOA states the pilot creates no obligation to purchase', done: !!a.noProcureClause },
        { key: 'dpa', label: 'Data processing agreement signed', done: has(r, 'dpa') },
        { key: 'dpo', label: 'Data Protection Officer designated (name + email)', done: has(r, 'dpo') && !!a.dpoName?.trim() && !!a.dpoEmail?.trim() },
        { key: 'pia', label: 'Privacy impact assessment signed by the DPO', done: has(r, 'pia') },
        { key: 'plan', label: 'Plan recorded', done: !!a.planTier },
      ]
    case 'setup':
      return [
        { key: 'hospital', label: 'Hospital created in MAPA (sign-ups closed until go-live)', done: !!r.hospitalId },
        { key: 'admins', label: 'Hospital Admin and a backup admin', done: (ctx.adminCount ?? 0) >= 2 },
        { key: 'partners', label: 'At least one partner funder linked', done: (ctx.partnerCount ?? 0) >= 1 },
        { key: 'training', label: 'Staff trained in the Training Hospital', done: Number(t.trainedCount) > 0 },
        { key: 'uat', label: 'Acceptance test cases passed', done: !!t.uatPassedAt },
        { key: 'golive', label: 'Go-live acceptance signed by the hospital', done: has(r, 'golive') },
      ]
    default:
      return []
  }
}
export const stageComplete = (stage, r, ctx) => stageChecklist(stage, r, ctx).every(i => i.done)

// The go-live gate: every earlier stage complete. Data sharing agreements are
// recommended, never blocking (NPC Advisory 2025-01: not mandatory).
export function goLiveGate(r, ctx) {
  return ['interest', 'verification', 'agreement', 'setup'].flatMap(s => stageChecklist(s, r, ctx).map(i => ({ ...i, stage: s })))
}
export const canGoLive = (r, ctx) => goLiveGate(r, ctx).every(i => i.done)

// After go-live: dates the platform must chase. [{ key, label, due, state }]
// state: 'ok' | 'soon' (≤30 days) | 'overdue'
export function complianceReminders(r = {}, now = new Date()) {
  const out = []
  const push = (key, label, due, done = false) => {
    const d = toDate(due)
    if (!d || isNaN(d)) return
    const days = (d - now) / DAY
    out.push({ key, label, due: d, state: done ? 'ok' : days < 0 ? 'overdue' : days <= 30 ? 'soon' : 'ok', done })
  }
  const liveAt = toDate(r.liveAt)
  // NPC Circular 2022-04: register the system within 20 days of go-live.
  if (liveAt) push('npc', 'NPC registration of the system (20 days after go-live)', new Date(liveAt.getTime() + 20 * DAY), !!r.agreement?.npcRegisteredAt)
  push('lto', 'DOH License to Operate expires', r.verification?.ltoExpiry)
  push('philhealth', 'PhilHealth accreditation expires', r.verification?.philhealthExpiry)
  push('moa', 'MOA term ends', r.agreement?.moaTermEnd)
  push('pilot', 'Pilot period ends', r.agreement?.pilotUntil)
  return out
}
export const needsAttention = (r, now) => complianceReminders(r, now).some(x => !x.done && x.state !== 'ok')
