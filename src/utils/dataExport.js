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

  // Profile + flat collections fan out in parallel.
  const [
    profileSnap,
    requestsSnap,
    applicationsSnap,
    documentsSnap,
    documentContentsSnap,
    certificatesSnap,
    notificationsSnap,
    conversationsSnap,
  ] = await Promise.all([
    getDoc(doc(db, 'users', uid)),
    getDocs(query(collection(db, 'requests'),         where('patientId',    '==',             uid))),
    getDocs(query(collection(db, 'applications'),     where('patientId',    '==',             uid))),
    getDocs(query(collection(db, 'documents'),        where('patientId',    '==',             uid))),
    getDocs(query(collection(db, 'documentContents'), where('patientId',    '==',             uid))),
    getDocs(query(collection(db, 'certificates'),     where('patientId',    '==',             uid))),
    getDocs(collection(db, 'notifications', uid, 'items')),
    getDocs(query(collection(db, 'conversations'),    where('participants', 'array-contains', uid))),
  ])

  // For each conversation, fetch its messages subcollection. Done
  // sequentially so a slow shard doesn't tank the others; in practice a
  // patient has <10 conversations.
  const conversations = []
  for (const convDoc of conversationsSnap.docs) {
    const msgs = await getDocs(collection(db, 'conversations', convDoc.id, 'messages'))
    conversations.push({
      ...shapeDoc(convDoc),
      messages: msgs.docs.map(shapeDoc),
    })
  }

  return {
    exportedAt:    new Date().toISOString(),
    exportFormat:  'MAPA-RA10173-v1',
    subjectUid:    uid,
    profile:       profileSnap.exists() ? shapeDoc(profileSnap) : null,
    requests:         requestsSnap.docs.map(shapeDoc),
    applications:     applicationsSnap.docs.map(shapeDoc),
    documents:        documentsSnap.docs.map(shapeDoc),
    documentContents: documentContentsSnap.docs.map(shapeDoc),
    certificates:     certificatesSnap.docs.map(shapeDoc),
    notifications:    notificationsSnap.docs.map(shapeDoc),
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