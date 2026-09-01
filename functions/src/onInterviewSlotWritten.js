const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

/**
 * onInterviewSlotWritten — the server-authoritative sync between a booked
 * interview slot and its parent request (Phase 2 of the appointment system,
 * docs/appointment-system-plan.md §4.2).
 *
 * WHY A TRIGGER, NOT A CLIENT WRITE
 *
 * A patient booking writes ONLY to interviewSlots (open → booked), touching
 * the handful of fields the isBooking() rule permits. It must not be able to
 * write the request — the requests.update rule is money-adjacent and tightly
 * scoped, and widening it to let patients stamp interview fields is exactly
 * the surface the rules work to avoid. So this trigger (Admin SDK, rules-
 * bypassing) carries the slot's facts onto the request instead. Same pattern
 * as syncRequestFinancials.
 *
 * BOOK  (open → booked): stamp interviewDate/Time/Mode/At/meetLink + a queue
 * number (in-person only) onto the request, and advance the lifecycle to
 * 'assessment' — but only from a pre-assessment state, never regressing a
 * request CRMC has already moved past the interview (authority boundary).
 *
 * CANCEL (booked → open, or a booked slot deleted): clear those same fields so
 * the patient's picker reappears and reschedule works end-to-end — but only if
 * the request still points at THIS slot (interviewSlotId), since the patient
 * may have already re-booked a different one whose book-sync ran first.
 *
 * Testable-handler pattern (verifyAccessCode / glExpirySweep / sync…): the
 * onDocumentWritten wrapper resolves before/after and calls the pure handler.
 */

const PRE_ASSESSMENT_STATUSES = ['submitted', 'under_review']

// Booking-order queue number for the day, in-person only: A-001, A-002…
// Counts the day's currently-booked in-person slots (this one included). At
// pilot volume two simultaneous bookings could tie; that's rare and harmless
// (staff reconcile at check-in). Cancelled slots drop out (status != booked).
async function assignQueueNo({ db, slot }) {
  const daySnap = await db.collection('interviewSlots')
    .where('date', '==', slot.date)
    .where('mode', '==', 'in_person')
    .where('status', '==', 'booked')
    .get()
  return `A-${String(daySnap.size).padStart(3, '0')}`
}

async function bookSync({ db, slotId, slot, serverTimestamp }) {
  const requestId = slot.requestId
  if (!requestId) return { skipped: 'no-request-id' }

  const reqRef  = db.collection('requests').doc(requestId)
  const reqSnap = await reqRef.get()
  if (!reqSnap.exists) return { skipped: 'request-missing', requestId }
  const req = reqSnap.data()

  // Queue number (in-person only). Written back onto the slot so the patient's
  // slip and the admin view both read it; also mirrored onto the request.
  let queueNo = slot.queueNo ?? null
  if (slot.mode === 'in_person' && !queueNo) {
    queueNo = await assignQueueNo({ db, slot })
    await db.collection('interviewSlots').doc(slotId).update({ queueNo, updatedAt: serverTimestamp() })
  }

  const update = {
    interviewSlotId:  slotId,
    interviewDate:    slot.date,
    interviewTime:    slot.time,
    interviewMode:    slot.mode,
    interviewAt:      slot.start ?? null,   // the instant (Timestamp)
    meetLink:         slot.meetLink || null,
    interviewQueueNo: queueNo,
    updatedAt:        serverTimestamp(),
  }
  if (PRE_ASSESSMENT_STATUSES.includes(req.status)) {
    update.status = 'assessment'
  }
  await reqRef.update(update)
  return { synced: 'booked', requestId, queueNo, mode: slot.mode }
}

async function cancelSync({ db, slotId, prevSlot, serverTimestamp }) {
  const requestId = prevSlot.requestId
  if (!requestId) return { skipped: 'no-request-id' }

  const reqRef  = db.collection('requests').doc(requestId)
  const reqSnap = await reqRef.get()
  if (!reqSnap.exists) return { skipped: 'request-missing', requestId }
  const req = reqSnap.data()

  // The patient may have re-booked a different slot before this cancel synced;
  // that book-sync repointed interviewSlotId. Only clear if we still own it.
  if (req.interviewSlotId !== slotId) return { skipped: 'reassigned', requestId }

  const update = {
    interviewSlotId:  null,
    interviewDate:    null,
    interviewTime:    null,
    interviewMode:    null,
    interviewAt:      null,
    meetLink:         null,
    interviewQueueNo: null,
    updatedAt:        serverTimestamp(),
  }
  // Roll the lifecycle back off 'assessment' if the booking had advanced it.
  if (req.status === 'assessment') update.status = 'under_review'
  await reqRef.update(update)
  return { synced: 'cancelled', requestId }
}

async function handleInterviewSlotWritten({ db, slotId, before, after, serverTimestamp }) {
  const wasBooked = before?.status === 'booked'
  const isBooked  = after?.status === 'booked'

  if (!wasBooked && isBooked) {
    return bookSync({ db, slotId, slot: after, serverTimestamp })
  }
  if (wasBooked && !isBooked) {
    // booked → open, or a booked slot deleted (after is null).
    return cancelSync({ db, slotId, prevSlot: before, serverTimestamp })
  }
  return { skipped: 'no-transition' }
}

exports.handleInterviewSlotWritten = handleInterviewSlotWritten
exports.assignQueueNo = assignQueueNo

exports.onInterviewSlotWritten = onDocumentWritten({
  document: 'interviewSlots/{slotId}',
  region: 'asia-southeast1',
  timeoutSeconds: 60,
  memory: '256MiB',
}, async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const after  = event.data?.after?.exists  ? event.data.after.data()  : null
  try {
    const result = await handleInterviewSlotWritten({
      db: admin.firestore(),
      slotId: event.params?.slotId,
      before, after,
      serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    })
    if (result.synced) logger.info('[onInterviewSlotWritten] synced', result)
    return result
  } catch (err) {
    // Never rethrow onto the booking path — a stale request field is recoverable
    // (CRMC can re-open booking); a retry storm on a patient action is worse.
    logger.error('[onInterviewSlotWritten] sync failed', {
      slotId: event.params?.slotId, err: err.message,
    })
    return { failed: err.message }
  }
})
