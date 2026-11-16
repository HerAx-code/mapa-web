import { describe, it, expect } from 'vitest'
import { ageOn, dohReportRows } from '../../src/utils/dohReport.js'

describe('ageOn', () => {
  it('counts whole years, before and after the birthday', () => {
    expect(ageOn('1990-05-01', new Date(2026, 3, 30))).toBe(35)
    expect(ageOn('1990-05-01', new Date(2026, 4, 1))).toBe(36)
    expect(ageOn('', new Date())).toBe('')
  })
})

describe('dohReportRows', () => {
  const lookups = {
    requests: { r1: { requestId: 'REQ-1', intakeSheet: { diagnosis: 'CKD stage 5' }, careSetting: 'outpatient', assistanceType: 'Dialysis' } },
    users: { p1: { birthdate: '1980-01-15', sex: 'female', city: 'Cotabato City', province: 'Maguindanao del Norte' } },
    agencies: { a1: { name: 'MOH-MAIFIP', budget: { fundSource: 'MOH-MAIFIP' } } },
  }
  const slice = (id, status, day, extra = {}) => ({ id, status, requestId: 'r1', patientId: 'p1', agencyId: 'a1',
    amountApproved: 5000, approvedAt: new Date(2026, 9, day), ...extra })

  it('one row per approved slice in the month, with the DOH fields and no name', () => {
    const rows = dohReportRows([
      slice('s1', 'certificate', 10, { redeemedAmount: 4200 }),
      slice('s2', 'approved', 20),
      slice('s3', 'rejected', 12),
      slice('s4', 'approved', 5, { approvedAt: new Date(2026, 8, 30) }),
    ], lookups, { from: new Date(2026, 9, 1), to: new Date(2026, 9, 31, 23, 59) })
    expect(rows.map(r => r.id)).toEqual(['s1', 's2'])
    expect(rows[0]).toMatchObject({ requestRef: 'REQ-1', age: 46, sex: 'F', city: 'Cotabato City',
      diagnosis: 'CKD stage 5', careSetting: 'Outpatient', fundSource: 'MOH-MAIFIP', amountApproved: 5000, amountBilled: 4200 })
    expect(rows[0]).not.toHaveProperty('patientName')
  })
})
