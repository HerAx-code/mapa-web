### B.2 Request-status derivation and slice-terminal predicate

`deriveRequestStatus` maps a request's funding figures onto its lifecycle
state; `isSliceTerminal` decides whether an agency slice is "done" (so the
patient's In-Progress vs. Past views agree).

**Source:** `src/utils/requests.js`, lines 99–165 (trimmed).

```javascript
// src/utils/requests.js
export function deriveRequestStatus({ committed, outstanding }, amountNeeded = 0) {
  const need = Number(amountNeeded) || 0
  if (need > 0 && committed >= need) return 'fully_funded'
  if (committed > 0)                 return 'partially_funded'
  if (outstanding > 0)               return 'endorsed'
  return 'submitted'
}

// Is this slice DONE from the patient's perspective?
//   - rejected (agency turned it down — terminal)
//   - certificate + glStatus 'redeemed' | 'expired'
//   - certificate + past GL_VALIDITY_DAYS (sweep hasn't flipped glStatus yet)
export function isSliceTerminal(app, { isGLExpired } = {}) {
  if (!app) return false
  if (app.status === 'rejected') return true
  if (app.status === 'certificate') {
    if (app.glStatus === 'redeemed') return true
    if (app.glStatus === 'expired')  return true
    if (typeof isGLExpired === 'function' && isGLExpired(app)) return true
  }
  return false
}
```

*Trimmed: `deriveRequestFinancials` (which re-syncs a parent request's
`amountCommitted`/`status` from its slices inside the reversal transaction) and
the explanatory comment blocks.*
