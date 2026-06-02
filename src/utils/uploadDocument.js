import {
  collection, addDoc, setDoc, updateDoc, doc, deleteDoc, serverTimestamp,
} from 'firebase/firestore'
import { ref, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '../firebase'

// Shared patient-document upload pipeline.
//
// HISTORY:
//   commit cad84ff (2026-06-02) migrated this module from Firestore base64
//   to Cloud Storage at /documents/{patientId}/{docId}/{file}, with a
//   matching admin-SDK migration script and a storage.rules path.
//   That commit had to be partially rolled back because the pilot stays
//   on the free Spark plan and Cloud Storage on Firebase requires the
//   Blaze plan to enable new buckets on projects created after the
//   policy change. (The signed-GL-scan path hit the same wall earlier
//   in the project and was reverted in commit b888fa9 with the same
//   note.) This file is the Spark-compatible revert: file content
//   goes back to documentContents/{docId}.content as a base64 data
//   URL, capped at ~700 KiB after image compression to fit
//   Firestore's 1 MiB doc cap.
//
//   The Storage code path is NOT removed entirely:
//     - storage.rules keeps the /documents/{patientId}/{docId}/{file}
//       match (no objects under it; the rule is dormant)
//     - DocViewerModal still tries Storage first via storagePath, so
//       any docs that DID get a storagePath stamped during today's
//       uncertainty continue to render correctly
//     - scripts/migrate-doc-content-to-storage.js stays in tree as
//       the v2 migration target for whenever the project moves to
//       Blaze
//
//   When the project does move to Blaze, this file gets
//   re-Storage-ified (revert this revert) and the migration script
//   is run end-to-end.

// PDF cap matches what fits in a single Firestore doc after base64
// inflation (~33% larger than raw). Images are aggressively compressed
// to the same ceiling.
export const PDF_MAX_BYTES = 650 * 1024
export const FILE_MAX_BYTES = PDF_MAX_BYTES  // back-compat alias

const compressImage = (file) => new Promise((resolve) => {
  const img = new Image()
  const url = URL.createObjectURL(file)
  img.onload = () => {
    URL.revokeObjectURL(url)
    const canvas = document.createElement('canvas')
    let { width, height } = img
    const maxDim = 1200
    if (width > maxDim || height > maxDim) {
      if (width > height) { height = Math.round(height * maxDim / width); width = maxDim }
      else                { width = Math.round(width * maxDim / height); height = maxDim }
    }
    canvas.width  = width
    canvas.height = height
    canvas.getContext('2d').drawImage(img, 0, 0, width, height)
    let quality = 0.85
    let dataUrl = canvas.toDataURL('image/jpeg', quality)
    while (dataUrl.length > 900_000 && quality > 0.3) {
      quality -= 0.1
      dataUrl = canvas.toDataURL('image/jpeg', quality)
    }
    resolve(dataUrl)
  }
  img.src = url
})

// Returns an error string if the file is unacceptable, else null.
export function validateDocFile(file) {
  if (!file) return 'No file selected.'
  const isImage = file.type?.startsWith('image/')
  const isPdf   = file.type === 'application/pdf'
  if (!isImage && !isPdf) return 'Please upload an image or PDF file.'
  if (isPdf && file.size > PDF_MAX_BYTES) return 'PDF too large. Maximum is 650 KB.'
  return null
}

// Reads a file to a base64 data URL, compressing images to fit the
// 1 MiB Firestore doc cap.
const readContent = (file) => file.type?.startsWith('image/')
  ? compressImage(file)
  : new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = (e) => resolve(e.target.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

// Uploads one document and returns the attachedDocuments-style entry.
// Writes metadata to documents/{docId} and the base64 content to
// documentContents/{docId} (same id, kept separate so list queries
// stay light).
export async function uploadPatientDocument({ file, typeName, typeId = null, idType = null, ocr = null, user }) {
  const content = await readContent(file)
  const sizeKB  = (content.length * 0.75 / 1024).toFixed(2)

  // 1. Metadata doc.
  const metaRef = await addDoc(collection(db, 'documents'), {
    patientId:           user.uid,
    patientName:         user.name ?? '',
    name:                typeName,
    fileName:            file.name,
    documentTypeId:      typeId,
    documentTypeName:    typeName,
    type:                file.type || 'application/octet-stream',
    size:                `${sizeKB} KB`,
    date:                new Date().toLocaleDateString(),
    status:              'pending',
    agreedToAttestation: true,
    attestedAt:          new Date().toISOString(),
    ...(idType ? { idType } : {}),
    // Advisory on-device OCR result (ID docs only): extracted text + a
    // fuzzy name-match flag, surfaced to the CRMC verifier. Never
    // authoritative.
    ...(ocr ? { ocrText: (ocr.text ?? '').slice(0, 2000), ocrMatch: ocr.match ?? null } : {}),
    createdAt:           serverTimestamp(),
  })

  // 2. Content doc. If this fails, roll back the metadata so we don't
  //    leave orphan rows.
  try {
    await setDoc(doc(db, 'documentContents', metaRef.id), {
      content, documentId: metaRef.id, patientId: user.uid,
    })
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
  }
}

// Replaces the file content of an EXISTING document (used to re-upload
// a rejected document). Keeps the same document id so every application
// slice that references it picks up the new file + reset status
// without any snapshot rewrite. Resets status to 'pending' for
// re-review.
export async function replacePatientDocument({ docId, file, ocr = null, user }) {
  const content = await readContent(file)
  const sizeKB  = (content.length * 0.75 / 1024).toFixed(2)
  await setDoc(doc(db, 'documentContents', docId), {
    content, documentId: docId, patientId: user.uid,
  })
  await updateDoc(doc(db, 'documents', docId), {
    status:     'pending',
    fileName:   file.name,
    type:       file.type || 'application/octet-stream',
    size:       `${sizeKB} KB`,
    date:       new Date().toLocaleDateString(),
    reviewedBy: null,
    reviewedAt: null,
    ...(ocr ? { ocrText: (ocr.text ?? '').slice(0, 2000), ocrMatch: ocr.match ?? null } : {}),
  })
}

// Storage-first content fetch. Used by DocViewerModal: if a doc was
// migrated to Storage during the abandoned Tier-2 attempt, its
// `storagePath` field still points at a real object that may be
// retrievable. Returns null on failure so the caller falls back to
// the documentContents path.
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
  return null
}

// Best-effort Storage deletion (used by admin/Patients during patient
// deletion). Silent on already-missing objects so legacy docs without
// a Storage path don't produce false-positive errors. On Spark with
// Storage disabled this is essentially a no-op.
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