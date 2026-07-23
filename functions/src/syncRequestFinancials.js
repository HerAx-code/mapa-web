const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

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
 * CRMC owns the request lifecycle; this function must not fight it.
 * `status` is only rewritten when the request is currently sitting in one
 * of the four states deriveRequestStatus() itself can produce. If CRMC
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
const COMMITTED_SLICE_STATUSES   = ['approved', 'certificate']
const OUTSTANDING_SLICE_STATUSES = ['endorsed', 'for_funding', 'needs_info', 'reviewing', 'interview']

// A `certificate` slice whose GL has expired released its committed
// budget back to the agency, so it must stop counting as committed.
function isCommittedSlice(s) {
  if (!COMMITTED_SLICE_STATUSES.includes(s.status)) return false
  if (s.status === 'certificate' && s.glStatus === 'expired') return false
  return true
}

function computeFunding(amountNeeded = 0, slices = []) {
  const need = Number(amountNeeded) || 0
  const committed = slices
    .filter(isCommittedSlice)
    .reduce((sum, s) => sum + (Number(s.amountApproved) || 0), 0)
  const outstanding = slices
    .filter(s => OUTSTANDING_SLICE_STATUSES.includes(s.status))
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

function deriveRequestFinancials(slices = [], amountNeeded = 0) {
  const f = computeFunding(amountNeeded, slices)
  return {
    amountCommitted: f.committed,
    status: deriveRequestStatus({ committed: f.committed, outstanding: f.outstanding }, amountNeeded),
  }
}

// The only statuses this function is allowed to write. Anything else on
// the request is CRMC's call -- see AUTHORITY BOUNDARY above.
const DERIVED_STATUSES = ['submitted', 'endorsed', 'partially_funded', 'fully_funded']

async function handleSyncRequestFinancials({ db, requestId, serverTimestamp }) {
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
  if (DERIVED_STATUSES.includes(req.status) && req.status !== next.status) {
    update.status = next.status
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
// Exported for tests + parity checks against src/utils/requests.js.
exports.deriveRequestFinancials = deriveRequestFinancials
exports.deriveRequestStatus     = deriveRequestStatus

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
      db: admin.firestore(),
      requestId,
      serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
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
