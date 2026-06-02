import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase'

// RA 10173 (Data Privacy Act of 2012, Philippines) §16(f) gives the
// data subject the right to obtain a copy of their personal data in
// an electronic or structured format. This module assembles that copy
// for a given patient uid by walking every collection that holds data
// keyed to them.
//
// Output is a single JSON object covering:
//   profile           — users/{uid}
//   requests          — requests where patientId == uid
//   applications      — applications where patientId == uid (agency slices)
//   documents         — documents where patientId == uid (file metadata,
//                       includes storagePath for Storage-backed docs)
//   documentContents  — documentContents where patientId == uid; legacy
//                       (pre-Storage-migration) base64 content. After
//                       migration this collection is empty and the
//                       Storage path is the source of truth.
//   certificates      — certificates where patientId == uid (GL records)
//   notifications     — notifications/{uid}/items
//   conversations     — conversations the patient participates in, plus
//                       every message in each (both sides, since messages
//                       received by the patient are their data too)
//
// Excluded: auditLog (system-internal log entries) and any data tied to
// other users.

// Recursively walk a Firestore-shaped object and replace Timestamp values
// with ISO strings. Native JSON.stringify already converts Timestamps to
// { seconds, nanoseconds } pairs which is technically valid but not
// human-friendly. ISO strings round-trip into Date() cleanly.
function normalizeTimestamps(value) {
  if (value === null || value === undefined) return value
  // Firestore Timestamp shape
  if (typeof value?.toDate === 'function' && typeof value.seconds === 'number') {
    return value.toDate().toISOString()
  }
  if (Array.isArray(value)) {
    return value.map(normalizeTimestamps)
  }
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = normalizeTimestamps(v)
    }
    return out
  }
  return value
}

function shapeDoc(d) {
  return { id: d.id, ...normalizeTimestamps(d.data()) }
}

export async function buildPatientDataExport(uid) {
  if (!uid) throw new Error('uid required')

  // R6 fix (2026-06-03 review): the original implementation used
  // Promise.all, so a permission-denied on a single collection (e.g.
  // rules out of sync after a partial deploy) would reject the whole
  // export and the patient would get nothing. For an RA 10173 right-
  // to-portability flow that's the wrong failure mode -- a partial
  // export with a clear "these sections were unreachable" note is
  // strictly better than a generic "couldn't prepare your data"
  // toast.
  //
  // Switched to Promise.allSettled. Each fulfilled fetch is normalised
  // via shapeDoc; each rejected fetch goes into the export as
  // `{ error: { code, message } }` so the patient (or their lawyer)
  // can see exactly what was missing.

  const queries = [
    ['profile',          getDoc(doc(db, 'users', uid))],
    ['requests',         getDocs(query(collection(db, 'requests'),         where('patientId',    '==',             uid)))],
    ['applications',     getDocs(query(collection(db, 'applications'),     where('patientId',    '==',             uid)))],
    ['documents',        getDocs(query(collection(db, 'documents'),        where('patientId',    '==',             uid)))],
    ['documentContents', getDocs(query(collection(db, 'documentContents'), where('patientId',    '==',             uid)))],
    ['certificates',     getDocs(query(collection(db, 'certificates'),     where('patientId',    '==',             uid)))],
    ['notifications',    getDocs(collection(db, 'notifications', uid, 'items'))],
    ['conversations',    getDocs(query(collection(db, 'conversations'),    where('participants', 'array-contains', uid)))],
  ]
  const settled = await Promise.allSettled(queries.map(([, p]) => p))

  const sections = {}
  const errors   = []
  settled.forEach((res, i) => {
    const [name] = queries[i]
    if (res.status === 'fulfilled') {
      sections[name] = res.value
    } else {
      const err = res.reason
      errors.push({
        section: name,
        code:    err?.code    ?? null,
        message: err?.message ?? String(err),
      })
      console.warn(`[dataExport] ${name} fetch failed:`, err)
    }
  })

  // For each conversation that was fetched, also pull its messages
  // subcollection. Sequential to keep concurrent connection count
  // bounded on a patient with many threads; in practice patients have
  // <10 conversations.
  const conversations = []
  if (sections.conversations) {
    for (const convDoc of sections.conversations.docs) {
      try {
        const msgs = await getDocs(collection(db, 'conversations', convDoc.id, 'messages'))
        conversations.push({
          ...shapeDoc(convDoc),
          messages: msgs.docs.map(shapeDoc),
        })
      } catch (err) {
        errors.push({
          section: `conversations/${convDoc.id}/messages`,
          code:    err?.code    ?? null,
          message: err?.message ?? String(err),
        })
        // Include the conversation header even if its messages couldn't
        // be fetched. Otherwise the existence of the thread itself is
        // erased from the export.
        conversations.push({ ...shapeDoc(convDoc), messages: null })
      }
    }
  }

  return {
    exportedAt:    new Date().toISOString(),
    exportFormat:  'MAPA-RA10173-v1',
    subjectUid:    uid,
    // `errors` is an array (may be empty). Surfaced at the top of the
    // payload so anyone auditing the export sees the gaps immediately.
    errors,
    profile:          sections.profile?.exists?.() ? shapeDoc(sections.profile) : null,
    requests:         sections.requests        ? sections.requests.docs.map(shapeDoc)        : null,
    applications:     sections.applications    ? sections.applications.docs.map(shapeDoc)    : null,
    documents:        sections.documents       ? sections.documents.docs.map(shapeDoc)       : null,
    documentContents: sections.documentContents ? sections.documentContents.docs.map(shapeDoc) : null,
    certificates:     sections.certificates    ? sections.certificates.docs.map(shapeDoc)    : null,
    notifications:    sections.notifications   ? sections.notifications.docs.map(shapeDoc)   : null,
    conversations,
  }
}

// Trigger a JSON download from the browser without a server round-trip.
// Used by the SettingsModal's "Download my data" button.
export function downloadAsJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Stable filename suggested for the download.
export function patientExportFilename(uid, date = new Date()) {
  const stamp = date.toISOString().slice(0, 10)  // YYYY-MM-DD
  return `mapa-data-export-${uid.slice(0, 8)}-${stamp}.json`
}