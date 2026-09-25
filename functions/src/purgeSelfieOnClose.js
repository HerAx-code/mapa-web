const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

/**
 * purgeSelfieOnClose — RA-10173 retention. When a request reaches a terminal
 * state (fully_funded / closed / rejected) the live-selfie image is no longer
 * needed, so its base64 content in documentContents/{docId} is deleted. The
 * documents/{docId} METADATA is kept — including the non-biometric advisory
 * verdict flags (faceMatch / liveness / scores) for audit — and stamped with
 * selfieContentPurgedAt. Only the selfie image is purged; the ID document (the
 * identity proof of record) is left intact.
 *
 * See docs/id-verification-plan.md §6 + threat-model.md A6a. Decision: purge on
 * case close (2026-09-25).
 *
 * WHY A TRIGGER: fires exactly when a request goes terminal, so the image is
 * gone as soon as it's no longer needed (tighter than a daily sweep). Terminal
 * is final, so the "into terminal" transition happens once; writes to an
 * already-terminal request early-return. Same testable-handler pattern as
 * syncRequestFinancials / glExpirySweep.
 */

const TERMINAL = ['fully_funded', 'closed', 'rejected']

// Mirror of src/utils/idOcr.isSelfieType (separate bundle — can't import).
const isSelfieType = (name) => /selfie|live photo/i.test(name || '')

async function handlePurgeSelfieOnClose({ db, before, after, serverTimestamp }) {
  // Act only on the transition INTO a terminal state.
  const wasTerminal = TERMINAL.includes(before?.status)
  const isTerminal  = TERMINAL.includes(after?.status)
  if (!isTerminal || wasTerminal) return { skipped: 'no-terminal-transition' }

  const attached = Array.isArray(after?.attachedDocuments) ? after.attachedDocuments : []
  const selfies = attached.filter(a => isSelfieType(a?.documentTypeName || a?.name))
  if (selfies.length === 0) return { skipped: 'no-selfie', status: after.status }

  let purged = 0, skipped = 0
  for (const a of selfies) {
    const docId = a?.documentId
    if (!docId) { skipped++; continue }
    try {
      const contentRef = db.collection('documentContents').doc(docId)
      const snap = await contentRef.get()
      if (snap.exists) {
        await contentRef.delete()
        purged++
      } else {
        skipped++ // already purged / never had content
      }
      // Audit stamp on the metadata doc (kept). Best-effort — the image is the
      // thing that matters; a missing stamp doesn't leave PII behind.
      await db.collection('documents').doc(docId).set({
        selfieContentPurgedAt: serverTimestamp(),
        selfieContentPurgedReason: 'case_closed',
      }, { merge: true }).catch(() => {})
    } catch (err) {
      skipped++
      logger.error('[purgeSelfieOnClose] failed to purge one selfie', { docId, err: err?.message ?? String(err) })
    }
  }
  return { purged, skipped, status: after.status }
}

exports.handlePurgeSelfieOnClose = handlePurgeSelfieOnClose

exports.purgeSelfieOnClose = onDocumentWritten({
  document: 'requests/{requestId}',
  region: 'asia-southeast1',
  timeoutSeconds: 60,
  memory: '256MiB',
}, async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const after  = event.data?.after?.exists  ? event.data.after.data()  : null
  try {
    const result = await handlePurgeSelfieOnClose({
      db: admin.firestore(),
      before, after,
      serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    })
    if (result.purged) logger.info('[purgeSelfieOnClose] purged selfie content', { requestId: event.params?.requestId, ...result })
    return result
  } catch (err) {
    // Never rethrow: a retry storm on the request write path is worse than a
    // one-cycle delay in purging; the next write (or a manual sweep) retries.
    logger.error('[purgeSelfieOnClose] handler failed', { requestId: event.params?.requestId, err: err.message })
    return { failed: err.message }
  }
})
