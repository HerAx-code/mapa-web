const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')

/**
 * syncRequestFinancials — keeps a request's derived funding fields
 * (`amountCommitted` + `status`) authoritative by recomputing them from
 * the child application slices whenever any slice is written.
 *
 * WHY THIS EXISTS
 *
 * `amountCommitted` on the parent request is a denormalised sum over the
 * child slices. Until now the agency client computed it and wrote it
 * directly, which the rules could only partially police: the
 * requests.update rule can constrain WHICH fields an agency touches and
 * bound the value's type/range, but it cannot re-derive a sum over
 * sibling documents. An agency holding a single slice could therefore
 * write an inflated but well-formed figure and the rules would accept it.
 *
 * Making the number server-derived removes the whole class of problem:
 * whatever a client writes, this trigger recomputes the truth from the
 * slices within a second or two. It is also self-healing for the drift
 * the codebase already knew about -- the "L11 data check" chip in the
 * admin UI exists precisely because slice reversals and GL expiries left
 * the parent stale.
 *
 * AUTHORITY BOUNDARY
 *
 * the gateway owns the request lifecycle; this function must not fight it.
 * `status` is only rewritten when the request is currently sitting in one
 * of the four states deriveRequestStatus() itself can produce. If the gateway
 * has moved the request to `under_review`, `assessment`, `closed` or
 * `rejected`, the status is left alone and only `amountCommitted` is
 * synced -- that figure is factual regardless of lifecycle state.
 * Without this guard, a slice reversal on a closed request would silently
 * reopen it as `partially_funded`.
 *
 * CONSISTENCY
 *
 * Eventually consistent (~1-2s), unlike the in-transaction write it
 * backs up. The agency UI may briefly show the pre-approval tally. The
 * client-side write is intentionally left in place for now so the UI
 * stays instant; this trigger corrects it if it is ever wrong. Removing
 * the client write (and the agency branch of the requests.update rule)
 * is a follow-up, once this has proven itself in production.
 *
 * Architecture: same testable-handler pattern as verifyAccessCode +
 * glExpirySweep. The onDocumentWritten wrapper at the bottom resolves the
 * requestId from the event and calls handleSyncRequestFinancials().
 */

// ── Mirror of src/utils/requests.js ───────────────────────────────────────
// Duplicated by necessity: the web bundle and the functions bundle are
// built separately and share no module surface (same reason
// glExpirySweep re-declares GL_VALIDITY_DAYS). If you change the funding
// maths in src/utils/requests.js, change it here too -- a mismatch would
// make the trigger "correct" the client's figure to a different wrong
// number, which is worse than no trigger at all.
// ⚠ Mirror of src/utils/requests.js — MUST match the exact strings written to
// applications.status. Previously listed the never-written 'for_funding' /
// 'needs_info' and omitted the real 'awaiting_info', so this trigger dropped an
// awaiting_info slice from `outstanding` and could rewrite an endorsed request
// back to 'submitted'.
// The funding maths is the shared definition (src/shared/caseState.js, bundled
// into ./generated/shared.cjs) — the same one the web uses, so the two can't
// drift (they had: see the awaiting_info note in git history).
const {
  deriveRequestFinancials, deriveRequestStatus,
  COMMITTED_SLICE_STATUSES, OUTSTANDING_SLICE_STATUSES,
  DERIVED_REQUEST_STATUSES: DERIVED_STATUSES, REQUEST_CLOSED_STATUSES,
} = require('./generated/shared.cjs')

// Phase 4 PR 4.1 (P4-A): an endorsed case with nothing waiting at any agency
// (every slice decided, not fully funded, still open) goes to the hospital's
// "Endorse more or close" queue; `nothingPendingSince` is when that started,
// and the case timers count from it. Cleared when something is pending again.
function nothingPending(req, slices, next) {
  return slices.length > 0 &&
    !REQUEST_CLOSED_STATUSES.includes(req.status) &&
    next.status !== 'fully_funded' &&
    !slices.some((s) => OUTSTANDING_SLICE_STATUSES.includes(s.status))
}

async function handleSyncRequestFinancials({ db, requestId, serverTimestamp, deleteField = () => FieldValue.delete() }) {
  // Slices created before the co-funding redesign have no requestId.
  if (!requestId) return { skipped: 'no-request-id' }

  const reqRef  = db.collection('requests').doc(requestId)
  const reqSnap = await reqRef.get()
  if (!reqSnap.exists) {
    // Request deleted (admin cascade) while a slice write was in flight.
    return { skipped: 'request-missing', requestId }
  }

  const req = reqSnap.data()
  const slicesSnap = await db
    .collection('applications')
    .where('requestId', '==', requestId)
    .get()
  const slices = slicesSnap.docs.map(d => d.data())

  const next = deriveRequestFinancials(slices, req.amountNeeded ?? 0)

  const update = {}
  if ((req.amountCommitted ?? 0) !== next.amountCommitted) {
    update.amountCommitted = next.amountCommitted
  }
  // Open (unsettled) letters decide when a fully funded case is FINISHED
  // (decision D4): onRequestWritten frees the patient and purgeSelfieOnClose
  // runs only once this reaches 0.
  if ((req.openLetters ?? 0) !== next.openLetters) {
    update.openLetters = next.openLetters
  }
  if (DERIVED_STATUSES.includes(req.status) && req.status !== next.status) {
    update.status = next.status
  }
  const idle = nothingPending(req, slices, next)
  if (idle && !req.nothingPendingSince) update.nothingPendingSince = serverTimestamp()
  if (!idle && req.nothingPendingSince) {
    update.nothingPendingSince = deleteField()
    // A new idle stretch gets its own warning (caseTimers, PR 4.2).
    if (req.closingWarnedAt) update.closingWarnedAt = deleteField()
  }

  // No-op writes still bill and still churn the updatedAt stamp, so skip.
  if (Object.keys(update).length === 0) {
    return { skipped: 'in-sync', requestId }
  }

  update.updatedAt = serverTimestamp()
  await reqRef.update(update)

  return { updated: update, requestId, sliceCount: slices.length }
}

exports.handleSyncRequestFinancials = handleSyncRequestFinancials
exports.nothingPending = nothingPending
// Exported for tests + parity checks against src/utils/requests.js. The status
// lists are exported too so the parity test can assert them directly, not just
// transitively through fixtures (a list drift with no matching fixture would
// otherwise slip through).
exports.deriveRequestFinancials     = deriveRequestFinancials
exports.deriveRequestStatus         = deriveRequestStatus
exports.COMMITTED_SLICE_STATUSES    = COMMITTED_SLICE_STATUSES
exports.OUTSTANDING_SLICE_STATUSES  = OUTSTANDING_SLICE_STATUSES

exports.syncRequestFinancials = onDocumentWritten({
  document: 'applications/{appId}',
  region: 'asia-southeast1',
  timeoutSeconds: 60,
  memory: '256MiB',
}, async (event) => {
  // On delete there is no `after`; on create there is no `before`. Either
  // way the slice knows which request it belonged to.
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const after  = event.data?.after?.exists  ? event.data.after.data()  : null
  const requestId = after?.requestId ?? before?.requestId ?? null

  try {
    const result = await handleSyncRequestFinancials({
      db: getFirestore(),
      requestId,
      serverTimestamp: () => FieldValue.serverTimestamp(),
    })
    if (result.updated) {
      logger.info('[syncRequestFinancials] re-synced parent request', result)
    }
    return result
  } catch (err) {
    // Never rethrow: a retry storm on the money path is worse than a
    // stale tally, and the admin "data check" chip already surfaces drift.
    logger.error('[syncRequestFinancials] sync failed', {
      requestId, appId: event.params?.appId, err: err.message,
    })
    return { failed: err.message }
  }
})
