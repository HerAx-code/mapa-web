import {
  collection, addDoc, updateDoc, doc, deleteDoc, serverTimestamp,
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '../firebase'

// Shared patient-document upload pipeline. As of Tier-2 item 8, the file
// content lives in Cloud Storage at /documents/{patientId}/{docId}/{file},
// not in a Firestore documentContents/{docId} doc. The metadata doc in
// `documents` still holds everything else (name, type, OCR, status,
// agencyIds at endorse time, ...) plus the new `storagePath` field so
// the viewer can locate the bytes.
//
// Legacy docs (pre-migration) that still have a documentContents/{docId}
// entry continue to work via DocViewerModal's fallback path; the
// scripts/migrate-doc-content-to-storage.js admin-SDK script reads each
// legacy entry, uploads its base64 to Storage, stamps storagePath on
// the metadata doc, and removes the documentContents doc.

// 10 MiB matches the Storage rule cap. Higher than the previous Firestore
// base64 budget (~700 KiB after compression) so real-world scanner PDFs
// and high-quality phone photos go through without aggressive lossy
// compression.
export const FILE_MAX_BYTES = 10 * 1024 * 1024

// Sanitize the user-supplied filename for use in the Storage path. Strips
// path separators and anything weirder than printable ASCII + dot/dash/
// underscore. Length-capped so a pathological 4 KiB filename can't make
// the Storage path itself problematic.
const sanitizeFilename = (name) => {
  const clean = (name || 'file').replace(/[^\w.\-]+/g, '_').replace(/^_+|_+$/g, '')
  return clean.slice(0, 80) || 'file'
}

// Returns an error string if the file is unacceptable, else null.
export function validateDocFile(file) {
  if (!file) return 'No file selected.'
  const isImage = file.type?.startsWith('image/')
  const isPdf   = file.type === 'application/pdf'
  if (!isImage && !isPdf) return 'Please upload an image or PDF file.'
  if (file.size > FILE_MAX_BYTES) return `File too large. Maximum is ${(FILE_MAX_BYTES / 1024 / 1024).toFixed(0)} MB.`
  return null
}

const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

// Uploads one document and returns the attachedDocuments-style entry.
// Throws on failure; rolls back the metadata doc so a partial Storage
// upload doesn't leave orphan rows.
export async function uploadPatientDocument({ file, typeName, typeId = null, idType = null, ocr = null, user }) {
  // 1. Create the metadata doc first to mint a stable docId.
  const metaRef = await addDoc(collection(db, 'documents'), {
    patientId:           user.uid,
    patientName:         user.name ?? '',
    name:                typeName,
    fileName:            file.name,
    documentTypeId:      typeId,
    documentTypeName:    typeName,
    type:                file.type || 'application/octet-stream',
    size:                formatSize(file.size),
    sizeBytes:           file.size,
    date:                new Date().toLocaleDateString(),
    status:              'pending',
    agreedToAttestation: true,
    attestedAt:          new Date().toISOString(),
    ...(idType ? { idType } : {}),
    ...(ocr ? { ocrText: (ocr.text ?? '').slice(0, 2000), ocrMatch: ocr.match ?? null } : {}),
    createdAt:           serverTimestamp(),
  })

  // 2. Upload the file bytes to Storage. Path is colocated with the
  //    metadata doc by id so admin/Patients-side deletion can find it
  //    deterministically.
  const cleanName   = sanitizeFilename(file.name)
  const storagePath = `documents/${user.uid}/${metaRef.id}/${cleanName}`
  try {
    await uploadBytes(ref(storage, storagePath), file, { contentType: file.type })
    // 3. Stamp storagePath on the metadata so the viewer can locate
    //    the bytes. Patients have allow update on their own documents
    //    docs already; this fits inside that allowance.
    await updateDoc(doc(db, 'documents', metaRef.id), { storagePath })
  } catch (err) {
    await deleteDoc(doc(db, 'documents', metaRef.id)).catch(() => {})
    throw err
  }

  return {
    documentId:       metaRef.id,
    name:             typeName,
    documentTypeName: typeName,
    status:           'pending',
    date:             new Date().toLocaleDateString(),
    storagePath,
  }
}

// Replaces the file backing an EXISTING document (used to re-upload a
// rejected document). Keeps the same documentId so every application
// slice that references it picks up the new file + reset status
// without any snapshot rewrite. Resets status to 'pending'.
export async function replacePatientDocument({ docId, file, ocr = null, user }) {
  const cleanName   = sanitizeFilename(file.name)
  const storagePath = `documents/${user.uid}/${docId}/${cleanName}`

  await uploadBytes(ref(storage, storagePath), file, { contentType: file.type })
  await updateDoc(doc(db, 'documents', docId), {
    status:     'pending',
    fileName:   file.name,
    type:       file.type || 'application/octet-stream',
    size:       formatSize(file.size),
    sizeBytes:  file.size,
    date:       new Date().toLocaleDateString(),
    reviewedBy: null,
    reviewedAt: null,
    storagePath,
    ...(ocr ? { ocrText: (ocr.text ?? '').slice(0, 2000), ocrMatch: ocr.match ?? null } : {}),
  })
}

// Helper for the viewer / data-export: fetch the actual file as a
// data URL (image/PDF), preferring Storage when storagePath is
// present and falling back to the legacy documentContents path for
// pre-migration docs. Returns null on failure (caller renders a
// "could not load" affordance).
export async function fetchDocumentContent(docMeta) {
  if (docMeta?.storagePath) {
    try {
      const url = await getDownloadURL(ref(storage, docMeta.storagePath))
      const res = await fetch(url)
      if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`)
      const blob = await res.blob()
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload  = (e) => resolve(e.target.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
    } catch (err) {
      console.error('[fetchDocumentContent] Storage fetch failed:', err)
      return null
    }
  }
  return null  // Caller falls back to the legacy documentContents fetch.
}

// Deletes the Storage object associated with a document (best-effort).
// Used by admin/Patients during patient deletion. Silent on
// already-missing objects so legacy docs without a Storage path don't
// produce false-positive errors.
export async function deleteDocumentStorage(docMeta) {
  if (!docMeta?.storagePath) return
  try {
    await deleteObject(ref(storage, docMeta.storagePath))
  } catch (err) {
    if (err?.code !== 'storage/object-not-found') {
      console.warn('[deleteDocumentStorage] failed:', err)
    }
  }
}
