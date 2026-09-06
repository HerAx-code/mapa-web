### B.1 Order of Charging and sibling-slice funding tally

Computes a request's residual need after the statutory Order of Charging
(bill − PhilHealth − other coverage) and tallies committed vs. outstanding
money across a request's child application "slices."

**Source:** `src/utils/requests.js`, lines 24–95 (trimmed).

```javascript
// src/utils/requests.js
export function computeAmountNeeded({ totalBill = 0, philhealthCovered = 0, otherCovered = 0 } = {}) {
  const net = Number(totalBill) - Number(philhealthCovered) - Number(otherCovered)
  return Number.isFinite(net) ? Math.max(0, net) : 0
}

// Slice statuses that count as money already secured vs. still in flight.
export const COMMITTED_SLICE_STATUSES   = ['approved', 'certificate']
export const OUTSTANDING_SLICE_STATUSES = ['endorsed', 'for_funding', 'needs_info', 'reviewing', 'interview']
// …  isCommittedSlice(s) = COMMITTED_SLICE_STATUSES.includes(s.status)

export function computeFunding(amountNeeded = 0, slices = []) {
  const need = Number(amountNeeded) || 0
  const committed = slices
    .filter(isCommittedSlice)
    .reduce((sum, s) => sum + (Number(s.amountApproved) || 0), 0)
  const outstanding = slices
    .filter(s => OUTSTANDING_SLICE_STATUSES.includes(s.status))
    .reduce((sum, s) => sum + (Number(s.amountRequested) || 0), 0)
  const balance  = Math.max(0, need - committed)
  const headroom = Math.max(0, need - committed - outstanding)
  const pct      = need > 0 ? Math.min(100, Math.round((committed / need) * 100)) : 0
  return { committed, outstanding, balance, headroom, pct, fullyFunded: need > 0 && committed >= need }
}
```

*Trimmed: the `deriveAmountNeeded` legacy-fallback wrapper and the
`isCommittedSlice` one-line helper (noted inline as `// …`).*
