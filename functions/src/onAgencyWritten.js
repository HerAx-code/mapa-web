const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

/**
 * onAgencyWritten — projects the PUBLIC subset of an agency doc into a
 * separate `agenciesPublic/{id}` collection.
 *
 * WHY THIS EXISTS
 *
 * The public marketing Landing page shows a live "programs" teaser (agency
 * name + remaining interview slots) to unauthenticated visitors. It used to
 * read `agencies` directly, which forced `allow read: if true` on that
 * collection — exposing every partner agency's budget (allocated / committed /
 * disbursed), fund source, contacts and signatories to anyone on the internet
 * (audit SEC-3). Splitting a tiny public projection out lets us gate the rich
 * `agencies` collection to `if isAuth()` while the Landing page reads only the
 * harmless projection.
 *
 * WHY A TRIGGER (not a client-side mirror)
 *
 * `slots.remaining` changes from many writers — the endorsement transaction
 * decrements it, the `resetAgencySlots` scheduled function resets it daily,
 * SlotManagement adjusts it, admins edit capacity. A single onWrite trigger
 * catches them all with no drift; a client mirror would miss the
 * function-driven writes.
 *
 * SAFE IN ANY DEPLOY ORDER
 *
 * If this function (or the backfill) hasn't run yet, `agenciesPublic` is empty
 * and the Landing teaser simply shows no agencies — degraded, never broken.
 * Nothing authenticated depends on the projection.
 *
 * Only the public, non-sensitive fields are copied. Never budget / fundSource /
 * contacts / signatories.
 */

// The exact public projection. Keep this minimal — anything added here becomes
// world-readable. Landing renders name + slots.{total,remaining}; `enabled`
// drives the query filter.
function projectPublicAgency(data = {}) {
  const slots = data.slots ?? {}
  return {
    name:    data.name ?? '',
    enabled: data.enabled !== false, // default-enabled unless explicitly false
    slots: {
      total:     Number(slots.total) || 0,
      remaining: Number(slots.remaining) || 0,
    },
  }
}

async function handleAgencyWritten({ db, agencyId, before, after, serverTimestamp }) {
  const pubRef = db.collection('agenciesPublic').doc(agencyId)

  // Agency deleted → drop its public mirror.
  if (!after) {
    if (before) await pubRef.delete()
    return { deleted: agencyId }
  }

  const next = projectPublicAgency(after)

  // Skip a write when the projected fields are unchanged, so unrelated agency
  // edits (e.g. a budget allocation) don't churn the public doc.
  if (before) {
    const prev = projectPublicAgency(before)
    if (JSON.stringify(prev) === JSON.stringify(next)) {
      return { skipped: 'projection-unchanged', agencyId }
    }
  }

  await pubRef.set({ ...next, updatedAt: serverTimestamp() }, { merge: true })
  return { projected: next, agencyId }
}

exports.handleAgencyWritten = handleAgencyWritten
exports.projectPublicAgency = projectPublicAgency

exports.onAgencyWritten = onDocumentWritten({
  document: 'agencies/{agencyId}',
  region: 'asia-southeast1',
  timeoutSeconds: 60,
  memory: '256MiB',
}, async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const after  = event.data?.after?.exists  ? event.data.after.data()  : null
  try {
    const result = await handleAgencyWritten({
      db: admin.firestore(),
      agencyId: event.params.agencyId,
      before,
      after,
      serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    })
    return result
  } catch (err) {
    // Never rethrow: a failed public projection must not retry-storm or block
    // anything. The Landing teaser tolerates a briefly-stale mirror.
    logger.error('[onAgencyWritten] projection failed', {
      agencyId: event.params?.agencyId, err: err.message,
    })
    return { failed: err.message }
  }
})
