import { describe, it, expect } from 'vitest'
import { breakdownByHospital, hospitalsIn, filterByHospital, sliceHospital } from '../../src/utils/hospitalBreakdown'
import { DEFAULT_HOSPITAL_ID } from '../../src/config/org'

// Multi-hospital: an agency's slices grouped by the endorsing hospital.
const slices = [
  { status: 'reviewing', tenantId: 'bgh' },
  { status: 'approved', amountApproved: 10000, tenantId: 'bgh' },
  { status: 'certificate', amountApproved: 5000, tenantId: 'bgh' },
  { status: 'awaiting_info', tenantId: 'cph' },
  { status: 'rejected', tenantId: 'cph' },
  { status: 'approved', amountApproved: 2000 },                 // untagged → hospital #1
  { status: 'endorsed', tenantId: 'zzz' },                      // not in the agency's queue yet
]

describe('breakdownByHospital', () => {
  it('counts queue, approved, rejected and pesos per hospital, busiest first', () => {
    expect(breakdownByHospital(slices)).toEqual([
      { tenantId: 'bgh', total: 3, inQueue: 1, approved: 2, rejected: 0, amountApproved: 15000 },
      { tenantId: 'cph', total: 2, inQueue: 1, approved: 0, rejected: 1, amountApproved: 0 },
      { tenantId: DEFAULT_HOSPITAL_ID, total: 1, inQueue: 0, approved: 1, rejected: 0, amountApproved: 2000 },
    ])
  })

  it("leaves out endorsed slices (the patient hasn't proceeded yet)", () => {
    expect(breakdownByHospital(slices).some((r) => r.tenantId === 'zzz')).toBe(false)
  })

  it('handles nothing', () => {
    expect(breakdownByHospital([])).toEqual([])
    expect(breakdownByHospital(undefined)).toEqual([])
  })
})

describe('hospitalsIn / filterByHospital', () => {
  it('lists the distinct hospitals an agency sees', () => {
    expect(hospitalsIn(slices).sort()).toEqual(['bgh', 'cph', DEFAULT_HOSPITAL_ID].sort())
  })

  it("filters to one hospital; 'all' keeps everything", () => {
    expect(filterByHospital(slices, 'cph')).toHaveLength(2)
    expect(filterByHospital(slices, 'all')).toBe(slices)
    expect(filterByHospital(slices, DEFAULT_HOSPITAL_ID)).toEqual([{ status: 'approved', amountApproved: 2000 }])
  })

  it('an untagged slice belongs to hospital #1', () => {
    expect(sliceHospital({})).toBe(DEFAULT_HOSPITAL_ID)
  })
})
