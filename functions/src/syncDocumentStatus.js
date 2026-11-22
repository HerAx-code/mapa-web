const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')

/**
 * syncDocumentStatus — the document is the one owner of its status (Phase 3
 * PR 3.1, gap M4). A request keeps a list of its documents
 * (`attachedDocuments`, id + name + type + status) so queues can count them
 * without reading every document; this trigger keeps that list in step with
 * the documents themselves, one transaction per request, so two staff
 * reviewing at once can no longer overwrite each other's results (the page
 * used to rewrite the whole list from its own copy).
 *
 * On a document's status change it:
 *   - updates that document's entry on every request of the patient that lists it;
 *   - when a document added after filing (`requestId`) is VERIFIED and not yet
 *     on its request, attaches it there — in place of the document it
 *     `supersedes` if that one is listed (kept in `replacedDocuments` for the
 *     record) — and lets the request's endorsed agencies read it.
 *
 * The hospital pages no longer write `attachedDocuments`; the rules refuse it.
 * Testable-handler pattern.
 */

const entryOf = (id, d) => ({
  documentId: id,
  name: d.name ?? d.documentTypeName ?? '',
  documentTypeName: d.documentTypeName ?? d.name ?? '',
  status: d.status ?? 'pending',
  date: d.date ?? '',
})

async function handleSyncDocumentStatus({ db, docId, before, after, arrayUnion = (...v) => FieldValue.arrayUnion(...v), serverTimestamp = () => FieldValue.serverTimestamp() }) {
  if (!after) return { skipped: 'deleted' }
  if (before && before.status === after.status) return { skipped: 'no-status-change' }
  if (!after.patientId) return { skipped: 'no-patient' }

  const requests = await db.collection('requests').where('patientId', '==', after.patientId).get()
  const changed = []
  const grantTo = new Set()
  for (const r of requests.docs) {
    const listed = (r.data().attachedDocuments ?? []).some((a) => a?.documentId === docId)
    const joins = !listed && after.requestId === r.id && after.status === 'verified'
    if (!listed && !joins) continue
    const result = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(r.ref)
      if (!fresh.exists) return null
      const req = fresh.data()
      const list = req.attachedDocuments ?? []
      const at = list.findIndex((a) => a?.documentId === docId)
      if (at >= 0) {
        if (list[at].status === after.status) return null
        const next = list.map((a, i) => (i === at ? { ...a, status: after.status } : a))
        tx.update(fresh.ref, { attachedDocuments: next, updatedAt: serverTimestamp() })
        return 'updated'
      }
      if (!(after.requestId === fresh.id && after.status === 'verified')) return null
      const old = after.supersedes ? list.findIndex((a) => a?.documentId === after.supersedes) : -1
      const next = old >= 0
        ? list.map((a, i) => (i === old ? entryOf(docId, after) : a))
        : [...list, entryOf(docId, after)]
      tx.update(fresh.ref, {
        attachedDocuments: next,
        ...(old >= 0 ? { replacedDocuments: arrayUnion({ documentId: after.supersedes, by: docId }) } : {}),
        updatedAt: serverTimestamp(),
      })
      for (const a of req.agencyIds ?? []) grantTo.add(a)
      return old >= 0 ? 'replaced' : 'attached'
    })
    if (result) changed.push({ requestId: r.id, result })
  }
  // The agencies already funding the case may read a document that joined it.
  if ([...grantTo].some((a) => !(after.agencyIds ?? []).includes(a))) {
    await db.doc(`documents/${docId}`).update({ agencyIds: arrayUnion(...grantTo) })
  }
  return { docId, status: after.status, changed }
}

exports.handleSyncDocumentStatus = handleSyncDocumentStatus

exports.syncDocumentStatus = onDocumentWritten({
  document: 'documents/{docId}',
  region: 'asia-southeast1',
  timeoutSeconds: 60,
  memory: '256MiB',
}, async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const after = event.data?.after?.exists ? event.data.after.data() : null
  try {
    return await handleSyncDocumentStatus({ db: getFirestore(), docId: event.params.docId, before, after })
  } catch (err) {
    logger.error('[syncDocumentStatus] failed', { docId: event.params.docId, err: err.message })
    return { failed: err.message }
  }
})
