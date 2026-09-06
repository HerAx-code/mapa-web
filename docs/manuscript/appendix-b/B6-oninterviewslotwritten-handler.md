### B.6 Interview-slot sync Cloud Function

A Firestore trigger that keeps the parent request in sync with a booked slot
(the patient writes only `interviewSlots`; this Admin-SDK function carries the
facts onto the money-adjacent request). It also assigns the in-person queue
number and releases any duplicate slot a patient holds.

**Source:** `functions/src/onInterviewSlotWritten.js`, lines 40–130 (trimmed).

```javascript
// functions/src/onInterviewSlotWritten.js
async function assignQueueNo({ db, slot }) {                 // A-001, A-002 …
  const daySnap = await db.collection('interviewSlots')
    .where('date', '==', slot.date).where('mode', '==', 'in_person')
    .where('status', '==', 'booked').get()
  return `A-${String(daySnap.size).padStart(3, '0')}`
}

async function bookSync({ db, slotId, slot, serverTimestamp }) {
  const reqRef = db.collection('requests').doc(slot.requestId)
  const reqSnap = await reqRef.get(); if (!reqSnap.exists) return { skipped: 'request-missing' }
  let queueNo = slot.queueNo ?? null
  if (slot.mode === 'in_person' && !queueNo) {
    queueNo = await assignQueueNo({ db, slot })
    await db.collection('interviewSlots').doc(slotId).update({ queueNo, updatedAt: serverTimestamp() })
  }
  const update = { interviewSlotId: slotId, interviewDate: slot.date, interviewTime: slot.time,
    interviewMode: slot.mode, meetLink: slot.meetLink || null, interviewQueueNo: queueNo,
    reminderSent24h: false, reminderSent1h: false, updatedAt: serverTimestamp() }
  if (['submitted', 'under_review'].includes(reqSnap.data().status)) update.status = 'assessment'
  await reqRef.update(update)
  // Dedupe: release any OTHER slot this patient holds (a cross-device race
  // can leave two booked); the request now points at slotId, so their
  // cancel-sync sees the reassignment and skips the request wipe.
  if (slot.patientId) {
    const held = await db.collection('interviewSlots')
      .where('patientId', '==', slot.patientId).where('status', '==', 'booked').get()
    await Promise.all(held.docs.filter(d => d.id !== slotId).map(d =>
      db.collection('interviewSlots').doc(d.id).update(
        { status: 'open', patientId: null, requestId: null, updatedAt: serverTimestamp() })))
  }
  return { synced: 'booked', queueNo }
}

function handleInterviewSlotWritten({ db, slotId, before, after, serverTimestamp }) {
  const wasBooked = before?.status === 'booked', isBooked = after?.status === 'booked'
  if (!wasBooked && isBooked) return bookSync({ db, slotId, slot: after, serverTimestamp })
  if (wasBooked && !isBooked) return cancelSync({ db, slotId, prevSlot: before, serverTimestamp })
  return { skipped: 'no-transition' }
}
```

*Trimmed: `cancelSync` (clears the request's interview fields on booked→open,
guarded by an `interviewSlotId` ownership check) and the `onDocumentWritten` v2
wrapper that resolves before/after and calls the pure handler.*
