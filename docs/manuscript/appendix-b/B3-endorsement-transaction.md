### B.3 CRMC endorsement transaction

When CRMC endorses a verified request, one Firestore transaction creates a
child application "slice" per selected agency, decrements each agency's daily
slot, and advances the request to `endorsed` — all-or-nothing, with all reads
before any writes (Firestore's transaction contract).

**Source:** `src/pages/admin/Requests.jsx`, lines 180–249 (trimmed).

```javascript
// src/pages/admin/Requests.jsx — handleEndorse()
await runTransaction(db, async (tx) => {
  const reqRef = doc(db, 'requests', request.id)

  // ── All reads first ──
  const rSnap = await tx.get(reqRef)
  if (!rSnap.exists()) throw new Error('GONE')
  const agencySnaps = await Promise.all(
    selectedIds.map(id => tx.get(doc(db, 'agencies', id))))
  for (let i = 0; i < selectedIds.length; i++) {
    if (!agencySnaps[i].exists()) throw new Error(`GONE:${selectedIds[i]}`)
    if ((agencySnaps[i].data()?.slots?.remaining ?? 0) <= 0)   // slot guard
      throw new Error(`NO_SLOTS:${selectedIds[i]}`)
  }
  const r = rSnap.data()

  // ── Writes ──
  tx.update(reqRef, { agencyIds: arrayUnion(...selectedIds),
                      status: 'endorsed', updatedAt: serverTimestamp() })
  for (let i = 0; i < selectedIds.length; i++) {
    const id = selectedIds[i], aData = agencySnaps[i].data()
    tx.set(doc(collection(db, 'applications')), {
      appId: newAppId(), requestId: request.id,
      amountRequested: sliceAmount, amountApproved: 0,   // endorsed cap
      patientId: r.patientId, agencyId: id, agencyName: aData.name,
      status: 'endorsed',                                // awaits patient Proceed
      endorsedById: user.uid, endorsedAt: serverTimestamp(),
      crmcNotes: notesValue,
      // … patient snapshot + display fields omitted
    })
    tx.update(doc(db, 'agencies', id),
      { 'slots.remaining': (aData?.slots?.remaining ?? 0) - 1 })  // decrement
  }
})
// … best-effort post-step: stamp documents.agencyIds[] and notify the patient
```

*Trimmed: the patient-snapshot display fields on the slice, the optional
watcher-subscription write, and the post-transaction `documents.agencyIds[]`
stamping + patient notification.*
