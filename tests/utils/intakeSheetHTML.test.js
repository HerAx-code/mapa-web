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
    expect(html).toContain('Medical Social Services')          // signatory falls back to the gateway (ORG.gatewayName default)
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

// Multi-hospital Phase 8 — the sheet prints in the CASE hospital's identity
// (an agency viewer passes brandingFor(case hospital)), escaped like the rest.
describe('buildIntakeSheetHTML — case hospital branding', () => {
  const app = { requestId: 'REQ-1', assistanceType: 'Hospital Bills', patientName: 'Ana', submittedAt: null }
  const org = {
    name: 'MAPA', fullName: 'Medical Assistance Portal Access',
    facilityName: 'Bangsamoro <General> Hospital', gatewayName: 'Malasakit Desk',
    gatewayInitials: 'BGH', address: 'Cotabato City',
  }
  const html = buildIntakeSheetHTML({ app, sheet, agency: null, currentUser: { name: 'SW' }, org })

  it("uses the given hospital's name, seal, gateway and address", () => {
    expect(html).toContain('Bangsamoro &lt;General&gt; Hospital')
    expect(html).toContain('>BGH<')
    expect(html).toContain('Malasakit Desk')
    expect(html).toContain('Cotabato City')
  })

  it("never shows the default hospital's gateway when another is given", () => {
    expect(html).not.toContain('Medical Social Services')
  })
})

// Intake improvement A1 — every stored value is HTML-escaped. The printout is
// opened as a same-origin blob page, so patient-typed markup must never run.
describe('buildIntakeSheetHTML — escaping (stored XSS)', () => {
  const evil = '<img src=x onerror="alert(1)">'
  const html = buildIntakeSheetHTML({
    app: { requestId: 'REQ-1', patientName: evil, patientAddress: evil, patientContact: evil, assistanceType: evil },
    sheet: {
      ...sheet,
      familyMembers: [{ name: evil, relationship: evil, age: evil, occupation: evil, monthlyContribution: 100 }],
      employmentType: 'other', employmentTypeOther: evil, employer: evil, lengthOfEmployment: evil, incomeSource: evil,
      diagnosis: evil, attendingPhysician: evil, hospitalCaseNumber: evil,
      meansTestCategory: 'above_threshold', meansTestOverrideReason: evil,
      caseStudyNarrative: evil, recommendation: evil, completedBy: evil,
    },
    agency: { name: evil },
    currentUser: null,
  })

  it('contains no raw tag from any field', () => {
    expect(html).not.toContain('<img')
    expect(html).not.toMatch(/onerror="/)
  })

  it('shows the text itself, escaped', () => {
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })
})
