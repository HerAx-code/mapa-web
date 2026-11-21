// Guarantee letters at a hospital (2026-11-16, reports/Hospital billing module
// for MAPA.md): one row per letter an agency issued for this hospital's
// patients, with where it stands — valid, expiring soon, used (and for how
// much), or expired. Read-only: the agency still records use and expiry; this
// only lets the hospital see every letter in one list and export it to match
// against its own billing records. Pure, for tests.
import { glExpiryMs, glDaysRemaining } from './constants'
import { letterState } from '../shared/caseState'

const toDate = (ts) => ts?.toDate ? ts.toDate()
  : typeof ts?.seconds === 'number' ? new Date(ts.seconds * 1000)
  : ts ? new Date(ts) : null

export const GL_STATES = {
  valid:    'Valid',
  expiring: 'Expiring soon',
  used:     'Used',
  expired:  'Expired',
}

// Where one letter stands. null for slices without a letter.
// The letter's state — the shared definition (src/shared/caseState.js
// letterState), with null for "no letter".
export function glState(slice, now = Date.now()) {
  const st = letterState(slice, now)
  return st === 'none' ? null : st
}

//   slices:   this hospital's applications (any status)
//   requests: { id: request } for the request reference and care setting
//   range:    { from?: Date, to?: Date } on the issue date
export function glLedgerRows(slices, { requests = {} } = {}, { from = null, to = null, now = Date.now() } = {}) {
  return (slices ?? [])
    .map(s => ({ s, state: glState(s, now), issued: toDate(s.approvedAt) }))
    .filter(({ state, issued }) => state && issued && (!from || issued >= from) && (!to || issued <= to))
    .sort((a, b) => b.issued - a.issued)
    .map(({ s, state, issued }) => {
      const r = requests[s.requestId] ?? {}
      const approved = Number(s.amountApproved ?? s.approvedAmount ?? 0) || 0
      const billed   = state === 'used' && s.redeemedAmount != null ? Number(s.redeemedAmount) : null
      const expiry   = glExpiryMs(s)
      return {
        id:          s.id,
        createdAt:   s.approvedAt,
        letterRef:   s.appId ?? s.id,
        requestRef:  r.requestId ?? s.requestId ?? '',
        patientName: s.patientName ?? '',
        agency:      s.agencyName ?? '',
        careSetting: r.careSetting === 'outpatient' ? 'Outpatient' : 'Inpatient',
        payableTo:   s.payableTo ?? '',
        issuedOn:    issued,
        validUntil:  expiry == null ? null : new Date(expiry - 1),
        daysLeft:    state === 'valid' || state === 'expiring' ? glDaysRemaining(s, now) : null,
        state,
        approved,
        // Letters used before amounts were recorded count as fully used.
        billed:      state === 'used' ? (billed ?? approved) : null,
        unused:      state === 'used' ? Math.max(0, approved - (billed ?? approved)) : null,
        usedOn:      state === 'used' ? toDate(s.glRedeemedAt) : null,
      }
    })
}

// Totals per agency for the list's summary: letters still open (valid or
// expiring) and their amount, letters used and the amount billed.
export function glTotalsByAgency(rows) {
  const by = {}
  for (const r of rows ?? []) {
    const t = by[r.agency || '—'] ??= { agency: r.agency || '—', openCount: 0, openAmount: 0, usedCount: 0, billedAmount: 0, expiredCount: 0 }
    if (r.state === 'valid' || r.state === 'expiring') { t.openCount += 1; t.openAmount += r.approved }
    else if (r.state === 'used') { t.usedCount += 1; t.billedAmount += r.billed ?? 0 }
    else if (r.state === 'expired') t.expiredCount += 1
  }
  return Object.values(by).sort((a, b) => b.openAmount - a.openAmount || a.agency.localeCompare(b.agency))
}
