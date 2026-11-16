import { describe, it, expect } from 'vitest'
import { docTypeRequired, outpatientCapExceeded, isDialysis } from '../../src/utils/outpatient.js'

const billing = { name: 'Hospital Billing Statement', required: true, careSetting: 'inpatient' }
const validId = { name: 'Valid ID', required: true }
const order   = { name: "Doctor's Order", required: false, requiredWhen: { careSetting: 'outpatient' } }
const dialysisCert = { name: 'PhilHealth Dialysis Sessions Certificate', required: false,
  requiredWhen: { careSetting: 'outpatient', assistanceTypes: ['Dialysis'] } }
const optional = { name: 'Medical Abstract', required: false }

describe('docTypeRequired', () => {
  it('inpatients keep the billing statement and never get outpatient documents', () => {
    const r = { careSetting: 'inpatient', assistanceType: 'Dialysis' }
    expect(docTypeRequired(billing, r)).toBe(true)
    expect(docTypeRequired(validId, r)).toBe(true)
    expect(docTypeRequired(order, r)).toBe(false)
    expect(docTypeRequired(dialysisCert, r)).toBe(false)
  })
  it('outpatients swap the billing statement for the order (and dialysis proof for Dialysis)', () => {
    expect(docTypeRequired(billing, { careSetting: 'outpatient' })).toBe(false)
    expect(docTypeRequired(order, { careSetting: 'outpatient', assistanceType: 'Medicines' })).toBe(true)
    expect(docTypeRequired(dialysisCert, { careSetting: 'outpatient', assistanceType: 'Medicines' })).toBe(false)
    expect(docTypeRequired(dialysisCert, { careSetting: 'outpatient', assistanceType: 'dialysis' })).toBe(true)
    expect(docTypeRequired(validId, { careSetting: 'outpatient' })).toBe(true)
  })
  it('a missing setting counts as admitted; optional types are never required', () => {
    expect(docTypeRequired(billing, {})).toBe(true)
    expect(docTypeRequired(order, {})).toBe(false)
    expect(docTypeRequired(optional, { careSetting: 'outpatient' })).toBe(false)
  })
})

describe('outpatient cap', () => {
  it('outpatient approvals cannot exceed the charge; inpatient keep the buffer', () => {
    expect(outpatientCapExceeded({ careSetting: 'outpatient', amountNeeded: 5000 }, 5001)).toBe(true)
    expect(outpatientCapExceeded({ careSetting: 'outpatient', amountNeeded: 5000 }, 5000)).toBe(false)
    expect(outpatientCapExceeded({ careSetting: 'inpatient', amountNeeded: 5000 }, 9000)).toBe(false)
  })
  it('recognises dialysis requests', () => {
    expect(isDialysis({ assistanceType: 'Dialysis' })).toBe(true)
    expect(isDialysis({ assistanceType: 'Medicines' })).toBe(false)
  })
})

describe('outpatient document checklists', () => {
  it('the doctor\'s order, charge slip and dialysis certificate each have a checklist', async () => {
    const { docChecksFor } = await import('../../src/utils/docChecks.js')
    expect(docChecksFor({ documentTypeName: "Doctor's Order" }).map(i => i.key)).toEqual(['physician', 'recent', 'matches'])
    expect(docChecksFor({ name: 'Charge Slip from the Hospital Unit' }).map(i => i.key)).toEqual(['unit', 'itemised', 'perOrder'])
    expect(docChecksFor({ name: 'PhilHealth Dialysis Sessions Certificate' }).map(i => i.key)).toEqual(['sessions', 'signed'])
  })
})

describe('careSettingLabel', () => {
  it('describes the request for staff', async () => {
    const { careSettingLabel } = await import('../../src/utils/outpatient.js')
    expect(careSettingLabel({})).toBe('Admitted (inpatient bill)')
    expect(careSettingLabel({ careSetting: 'outpatient', careUnit: 'dialysis', philhealthSessionsUsed: 40 }))
      .toBe('Outpatient · Dialysis unit · 40 of 156 PhilHealth sessions used')
  })
})
