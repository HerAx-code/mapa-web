/**
 * buildIntakeSheetHTML — the printable Unified Intake Sheet. Guards that the
 * sheet renders across both shapes it serves (agency application vs CRMC
 * request) without leaking "undefined" into the printed document.
 */
import { describe, it, expect } from 'vitest'
import { buildIntakeSheetHTML } from '../../src/utils/intakeSheetHTML.js'

const sheet = {
  householdSize: 4,
  monthlyIncome: 6000,
  expenses: { food: 2000, rent: 1000 },
  meansTestCategory: 'indigent',
  completedBy: 'Jane Cruz',
}

describe('buildIntakeSheetHTML', () => {
  it('renders a CRMC request (requestId / assistanceType, no agency) without "undefined"', () => {
    const app = {
      requestId: 'REQ-2026-04273677O',
      assistanceType: 'Hospital Bills / Hospitalization',
      patientName: 'Aaron De Roma',
      patientContact: '0909…',
      patientAddress: 'Awang',
      submittedAt: null,
    }
    const html = buildIntakeSheetHTML({ app, sheet, agency: null, currentUser: { name: 'SW' } })
    expect(html).not.toContain('undefined')
    expect(html).toContain('REQ-2026-04273677O')              // reference no.
    expect(html).toContain('Hospital Bills / Hospitalization') // program falls back to type
    expect(html).toContain('CRMC Malasakit Center')            // signatory falls back to CRMC
  })

  it('renders an agency application (appId / agencyName) without "undefined"', () => {
    const app = {
      appId: 'APP-2026-0001',
      agencyName: 'DSWD AICS',
      patientName: 'Aaron De Roma',
      submittedAt: null,
    }
    const html = buildIntakeSheetHTML({ app, sheet, agency: { name: 'DSWD AICS' }, currentUser: { name: 'SW' } })
    expect(html).not.toContain('undefined')
    expect(html).toContain('APP-2026-0001')
    expect(html).toContain('DSWD AICS')
  })
})
