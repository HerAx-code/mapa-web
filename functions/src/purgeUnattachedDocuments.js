const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const { getFirestore } = require('firebase-admin/firestore')

/**
 * purgeUnattachedDocuments — monthly cleanup for Phase 3 PR 3.1 (P3-A).
 *
 * Filing now uploads a NEW document for every file (an earlier case's document
 * is never replaced), so a filing that fails after its uploads leaves pending
 * documents that no request lists. This deletes those, with their content,
 * once they are 30 days old:
 *   - status pending (never reviewed), never sent to an agency;
 *   - no requestId (a document added to an active request is the hospital's to review);
 *   - not listed in any of the patient's requests' attachedDocuments.
 * onDocumentCountChanged gives the patient's upload count back.
 * Testable-handler pattern.
 */

const RETENTION_DAYS = 30
const DAY_MS = 86400000
const millis = (ts) => (ts?.toMillis ? ts.toMillis() : ts?.toDate ? ts.toDate().getTime() : typeof ts?.seconds === 'number' ? ts.seconds * 1000 : null)

async function handlePurgeUnattachedDocuments({ db, nowMs = Date.now(), write = true }) {
  const cutoff = nowMs - RETENTION_DAYS * DAY_MS
  const pending = await db.collection('documents').where('status', '==', 'pending').get()
  const candidates = pending.docs.filter((d) => {
    const x = d.data()
    const at = millis(x.createdAt)
    return at != null && at < cutoff && !x.requestId && !(x.agencyIds ?? []).length && x.patientId
  })

  const listedByPatient = new Map()
  const listed = async (patientId) => {
    if (!listedByPatient.has(patientId)) {
      const reqs = await db.collection('requests').where('patientId', '==', patientId).get()
      listedByPatient.set(patientId, new Set(reqs.docs.flatMap((r) => (r.data().attachedDocuments ?? []).map((a) => a?.documentId))))
    }
    return listedByPatient.get(patientId)
  }

  let deleted = 0
  for (const d of candidates) {
    if ((await listed(d.data().patientId)).has(d.id)) continue
    if (write) {
      await db.doc(`documentContents/${d.id}`).delete()
      await d.ref.delete()
    }
    deleted++
  }
  return { scanned: pending.size, candidates: candidates.length, deleted }
}

exports.handlePurgeUnattachedDocuments = handlePurgeUnattachedDocuments
exports.RETENTION_DAYS = RETENTION_DAYS

exports.purgeUnattachedDocuments = onSchedule(
  {
    schedule: '30 3 1 * *',          // 03:30 on the 1st of every month
    timeZone: 'Asia/Manila',
    region: 'asia-southeast1',
    retryCount: 1,
  },
  async () => {
    const result = await handlePurgeUnattachedDocuments({ db: getFirestore() })
    logger.info('[purgeUnattachedDocuments] monthly cleanup', result)
  },
)
