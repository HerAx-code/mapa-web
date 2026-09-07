### B.4 Agency approval transaction

When an agency approves its slice, one transaction enforces the budget gate,
records the approval + issues the Guarantee Letter, increments the agency's
committed budget, advances the parent request's secured total, and stamps the
patient's Hospital ID to start the double-funding cooldown.

**Source:** `src/pages/agency/ApplicationDetail.jsx`, lines 469–544 (trimmed).
*(The brief lists `ApplicationModals.jsx`; the transaction itself lives in
`ApplicationDetail.jsx` — the modal collects the input and calls this handler.)*

```javascript
// src/pages/agency/ApplicationDetail.jsx — handleApprove()
await runTransaction(db, async (tx) => {
  const agencySnap = await tx.get(agencyRef)          // reads inside the tx
  const reqSnap    = reqRef ? await tx.get(reqRef) : null
  const data      = agencySnap.exists() ? agencySnap.data() : {}
  const allocated = data.budget?.allocated ?? 0
  const committed = data.budget?.committed ?? 0
  const remaining = Math.max(0, allocated - committed)

  if (allocated > 0 && approvedAmount > remaining)    // budget gate
    throw new Error(`BUDGET_INSUFFICIENT:Only ₱${remaining.toLocaleString()} remaining …`)

  tx.update(appRef, {                                  // record + issue GL
    status: 'approved', approvedAmount, amountApproved: approvedAmount,
    purposeOfAssistance, payableTo, approvedBy, approvedAt: serverTimestamp(),
    glStatus: 'issued', glRedeemedAt: null, updatedAt: serverTimestamp(),
  })
  if (allocated > 0)
    tx.update(agencyRef, { 'budget.committed': increment(approvedAmount) })
  if (patientHospitalId && !app.requestId)             // begin cooldown (legacy path)
    tx.update(doc(db, 'hospitalIds', patientHospitalId),
      { lastApprovedAt: serverTimestamp(), cooldownUntilAt: null })

  if (reqSnap?.exists()) {                             // advance parent request
    const r = reqSnap.data(), need = r.amountNeeded ?? 0
    const newCommitted = (r.amountCommitted ?? 0) + approvedAmount
    tx.update(reqRef, {
      amountCommitted: newCommitted,
      status: (need > 0 && newCommitted >= need) ? 'fully_funded' : 'partially_funded',
      updatedAt: serverTimestamp(),
    })
  }
})
```

*The per-applicant cooldown + per-applicant cap pre-checks run just above this
block; `amountApproved` is additionally capped at the endorsed `amountRequested`
by `firestore.rules` (see B.5-adjacent hardening).*
