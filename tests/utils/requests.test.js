import { describe, it, expect } from 'vitest'
import {
  computeAmountNeeded,
  computeFunding,
  deriveRequestStatus,
  COMMITTED_SLICE_STATUSES,
  OUTSTANDING_SLICE_STATUSES,
} from '../../src/utils/requests.js'

// computeAmountNeeded is what CRMC uses to derive the amountNeeded
// figure from the patient's bill minus PhilHealth and other coverage.
// Zero-floored so over-coverage doesn't go negative.
describe('computeAmountNeeded', () => {
  it('subtracts coverages from the total bill', () => {
    expect(computeAmountNeeded({ totalBill: 100_000, philhealthCovered: 20_000, otherCovered: 5_000 })).toBe(75_000)
  })

  it('treats missing fields as zero', () => {
    expect(computeAmountNeeded({ totalBill: 50_000 })).toBe(50_000)
    expect(computeAmountNeeded({})).toBe(0)
  })

  it('floors at zero when coverage exceeds the bill', () => {
    expect(computeAmountNeeded({ totalBill: 1_000, philhealthCovered: 2_000 })).toBe(0)
  })

  it('coerces string inputs that come from form fields', () => {
    expect(computeAmountNeeded({ totalBill: '50000', philhealthCovered: '20000', otherCovered: '5000' })).toBe(25_000)
  })

  it('handles non-finite input safely', () => {
    expect(computeAmountNeeded({ totalBill: NaN })).toBe(0)
    expect(computeAmountNeeded({ totalBill: 'abc' })).toBe(0)
  })
})

// computeFunding is the live aggregation across slice statuses that
// drives the admin/Requests funding progress bars and the L11
// "data check" invariant in d2771f1.
describe('computeFunding', () => {
  it('sums amountApproved from committed slices', () => {
    const slices = [
      { status: 'approved',    amountApproved: 10_000 },
      { status: 'certificate', amountApproved: 15_000 },
      { status: 'endorsed',    amountRequested: 20_000 },  // outstanding, not committed
      { status: 'rejected',    amountRequested: 5_000 },   // ignored
    ]
    const f = computeFunding(50_000, slices)
    expect(f.committed).toBe(25_000)
    expect(f.outstanding).toBe(20_000)
    expect(f.balance).toBe(25_000)
    expect(f.headroom).toBe(5_000)
    expect(f.pct).toBe(50)
    expect(f.fullyFunded).toBe(false)
  })

  it('reports fullyFunded when committed reaches the target', () => {
    const slices = [
      { status: 'approved',    amountApproved: 30_000 },
      { status: 'certificate', amountApproved: 20_000 },
    ]
    const f = computeFunding(50_000, slices)
    expect(f.committed).toBe(50_000)
    expect(f.fullyFunded).toBe(true)
    expect(f.balance).toBe(0)
    expect(f.pct).toBe(100)
  })

  it('handles an empty slice array (newly created request)', () => {
    const f = computeFunding(50_000, [])
    expect(f.committed).toBe(0)
    expect(f.outstanding).toBe(0)
    expect(f.balance).toBe(50_000)
    expect(f.headroom).toBe(50_000)
    expect(f.pct).toBe(0)
    expect(f.fullyFunded).toBe(false)
  })

  it('caps pct at 100 if committed exceeds need (over-approval, should not happen but guard anyway)', () => {
    const slices = [{ status: 'approved', amountApproved: 60_000 }]
    expect(computeFunding(50_000, slices).pct).toBe(100)
  })

  it('returns pct=0 when amountNeeded is 0', () => {
    expect(computeFunding(0, [{ status: 'approved', amountApproved: 100 }]).pct).toBe(0)
  })

  it('treats legacy slice statuses as outstanding (reviewing, interview, etc.)', () => {
    // Pre-redesign data may still have status='reviewing' or 'interview'.
    // The aggregation should not lose track of them.
    const slices = [
      { status: 'reviewing', amountRequested: 10_000 },
      { status: 'interview', amountRequested: 5_000 },
    ]
    const f = computeFunding(50_000, slices)
    expect(f.outstanding).toBe(15_000)
    expect(f.committed).toBe(0)
  })

  it('EXCLUDES expired GLs from committed (R2 fix)', () => {
    // Expiry releases budget back to the agency's allocation, so the
    // expired slice must stop counting as committed on the parent
    // request. status stays 'certificate' but glStatus flips to
    // 'expired'.
    const slices = [
      { status: 'certificate', glStatus: 'issued',   amountApproved: 20_000 },  // counted
      { status: 'certificate', glStatus: 'expired',  amountApproved: 15_000 },  // NOT counted
      { status: 'certificate', glStatus: 'redeemed', amountApproved: 10_000 },  // counted (paid out)
    ]
    const f = computeFunding(50_000, slices)
    expect(f.committed).toBe(30_000)  // 20 + 10, NOT 45
    expect(f.fullyFunded).toBe(false)
  })

  it('still counts plain approved slices as committed', () => {
    const slices = [
      { status: 'approved',    amountApproved: 25_000 },                       // no glStatus yet
      { status: 'certificate', glStatus: 'issued', amountApproved: 25_000 },
    ]
    const f = computeFunding(50_000, slices)
    expect(f.committed).toBe(50_000)
    expect(f.fullyFunded).toBe(true)
  })

  it('exports the status sets so callers can stay consistent with the aggregator', () => {
    expect(COMMITTED_SLICE_STATUSES).toContain('approved')
    expect(COMMITTED_SLICE_STATUSES).toContain('certificate')
    expect(OUTSTANDING_SLICE_STATUSES).toContain('endorsed')
    expect(OUTSTANDING_SLICE_STATUSES).toContain('for_funding')
    expect(OUTSTANDING_SLICE_STATUSES).toContain('needs_info')
  })
})

// deriveRequestStatus is the inverse: given current funding figures,
// what should the parent request's status be? Used to keep
// request.status in sync with the slice state, and is the contract
// the L11 data-check chip exists to enforce.
describe('deriveRequestStatus', () => {
  it('returns fully_funded when committed reaches need', () => {
    expect(deriveRequestStatus({ committed: 50_000, outstanding: 0 }, 50_000)).toBe('fully_funded')
    expect(deriveRequestStatus({ committed: 60_000, outstanding: 0 }, 50_000)).toBe('fully_funded')
  })

  it('returns partially_funded when committed > 0 but below need', () => {
    expect(deriveRequestStatus({ committed: 25_000, outstanding: 10_000 }, 50_000)).toBe('partially_funded')
  })

  it('returns endorsed when nothing is committed yet but something is outstanding', () => {
    expect(deriveRequestStatus({ committed: 0, outstanding: 30_000 }, 50_000)).toBe('endorsed')
  })

  it('does not return fully_funded for a zero-amount request, even when committed > 0', () => {
    // amountNeeded === 0 means the patient submitted no figure (yet). We
    // shouldn't flip to fully_funded under that condition.
    expect(deriveRequestStatus({ committed: 100, outstanding: 0 }, 0)).not.toBe('fully_funded')
  })

  it('returns submitted when no slices exist yet', () => {
    expect(deriveRequestStatus({ committed: 0, outstanding: 0 }, 50_000)).toBe('submitted')
  })
})