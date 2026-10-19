### B.6 Request-financials sync Cloud Function

A Firestore trigger that keeps a request's derived funding fields
(`amountCommitted` + `status`) authoritative by recomputing them from the child
application "slices" whenever any slice is written. The agency client also writes
the figure for an instant UI, but the security rules cannot re-derive a sum over
sibling documents — so an agency holding a single slice could otherwise write an
inflated-but-well-formed total. Making the number server-derived removes that
whole class of problem. (This replaces the retired interview-slot sync handler;
scheduled booking was removed in favor of the remote asynchronous assessment.)

**Source:** `functions/src/syncRequestFinancials.js`, trimmed.

```javascript
// functions/src/syncRequestFinancials.js — mirror of src/utils/requests.js
const COMMITTED_SLICE_STATUSES   = ['approved', 'certificate']
const OUTSTANDING_SLICE_STATUSES = ['endorsed', 'reviewing', 'awaiting_info']

// An expired-GL 'certificate' slice released its budget, so it stops counting.
function isCommittedSlice(s) {
  if (!COMMITTED_SLICE_STATUSES.includes(s.status)) return false
  if (s.status === 'certificate' && s.glStatus === 'expired') return false
  return true
}

function computeFunding(amountNeeded = 0, slices = []) {
  const need = Number(amountNeeded) || 0
  const committed = slices.filter(isCommittedSlice)
    .reduce((sum, s) => sum + (Number(s.amountApproved) || 0), 0)
  const outstanding = slices.filter(s => OUTSTANDING_SLICE_STATUSES.includes(s.status))
    .reduce((sum, s) => sum + (Number(s.amountRequested) || 0), 0)
  return { committed, outstanding, need }
}

function deriveRequestStatus({ committed, outstanding }, amountNeeded = 0) {
  const need = Number(amountNeeded) || 0
  if (need > 0 && committed >= need) return 'fully_funded'
  if (committed > 0)                 return 'partially_funded'
  if (outstanding > 0)               return 'endorsed'
  return 'submitted'
}

async function handleSyncRequestFinancials({ db, requestId }) {
  if (!requestId) return { skipped: 'no-request-id' }      // pre-redesign slice
  const reqSnap = await db.collection('requests').doc(requestId).get()
  if (!reqSnap.exists) return { skipped: 'request-missing' } // deleted mid-write

  const req = reqSnap.data()
  const slicesSnap = await db.collection('applications')
    .where('requestId', '==', requestId).get()
  const slices = slicesSnap.docs.map(d => d.data())

  const committed   = /* Σ amountApproved over committed slices */ 0
  const outstanding = /* Σ amountRequested over in-flight slices */ 0
  const status      = deriveRequestStatus({ committed, outstanding }, req.amountNeeded)
  // … write back only amountCommitted + a derived status; terminal states
  //   (closed / rejected) stay CRMC's call, never overwritten by the trigger.
}
```

*Trimmed: the `computeFunding` call inside the handler, the change-guarded
write-back, and the `onDocumentWritten` v2 wrapper that resolves `requestId` from
the event and calls the pure handler. Same testable-handler pattern as
`verifyAccessCode` and `glExpirySweep`. The money maths are a deliberate mirror of
`src/utils/requests.js` (the web and functions bundles share no module surface).*
