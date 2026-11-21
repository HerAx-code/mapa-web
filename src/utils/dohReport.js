// Phase 3B (2026-11-16): the DOH monthly assistance report. DOH AO 2026-0031
// (VI.I) asks hospitals to report, per patient assisted: age, sex,
// city/municipality, diagnosis, the amount, and the fund source. One row per
// approved agency slice (a patient helped by two agencies is two rows: one per
// fund source). No patient names — the request id traces a row back.

import { assistanceGivenOf } from '../shared/caseState'

const toDate = (ts) => ts?.toDate ? ts.toDate()
  : typeof ts?.seconds === 'number' ? new Date(ts.seconds * 1000)
  : ts ? new Date(ts) : null

// Whole years between a YYYY-MM-DD birthdate and `on` (a Date), or '' if unknown.
export function ageOn(birthdate, on) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthdate ?? ''))
  if (!m || !on) return ''
  let age = on.getFullYear() - Number(m[1])
  const beforeBirthday = on.getMonth() + 1 < Number(m[2]) || (on.getMonth() + 1 === Number(m[2]) && on.getDate() < Number(m[3]))
  if (beforeBirthday) age -= 1
  return age >= 0 && age < 130 ? age : ''
}

// Build report rows from approved slices and lookups (pure, for tests).
//   slices: applications with status approved/certificate
//   lookups: { requests: {id: req}, users: {uid: user}, agencies: {id: agency} }
//   range: { from?: Date, to?: Date } on approvedAt
export function dohReportRows(slices, { requests = {}, users = {}, agencies = {} } = {}, { from = null, to = null } = {}) {
  return (slices ?? [])
    // "Assistance given" (decision P2-F, the shared definition): approved
    // letters, except ones left to expire unused (M17).
    .map(s => ({ s, given: assistanceGivenOf(s), at: toDate(s.approvedAt) }))
    .filter(({ given }) => given !== null)
    .filter(({ at }) => at && (!from || at >= from) && (!to || at <= to))
    .sort((a, b) => a.at - b.at)
    .map(({ s, given, at }) => {
      const r = requests[s.requestId] ?? {}
      const u = users[s.patientId] ?? {}
      const a = agencies[s.agencyId] ?? {}
      return {
        id:             s.id,
        createdAt:      s.approvedAt,
        requestRef:     r.requestId ?? s.requestId ?? '',
        approvedOn:     at,
        age:            ageOn(u.birthdate, at),
        sex:            u.sex === 'female' ? 'F' : u.sex === 'male' ? 'M' : '',
        city:           u.city ?? '',
        province:       u.province ?? '',
        diagnosis:      r.intakeSheet?.diagnosis ?? '',
        careSetting:    r.careSetting === 'outpatient' ? 'Outpatient' : 'Inpatient',
        assistanceType: r.assistanceType ?? s.assistanceType ?? '',
        fundSource:     [...new Set([a.name ?? s.agencyName ?? '', a.budget?.fundSource ?? a.fundSource ?? ''].filter(Boolean))].join(' — '),
        amountApproved: given.approved,
        amountBilled:   given.billed ?? '',
      }
    })
}
