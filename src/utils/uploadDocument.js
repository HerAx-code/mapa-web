import {
  collection, addDoc, setDoc, updateDoc, doc, deleteDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'

// Shared patient-document upload pipeline. Mirrors the Documents page: images
// are compressed client-side to fit Firestore's ~1MB doc limit; PDFs are read
// as-is (size pre-checked). Metadata goes in `documents`, the base64 content
// in `documentContents` (keyed by the same id, kept separate so list queries
// stay light). Used by both the Documents library and the in-application
// uploader on the Request Assistance form.

export const PDF_MAX_BYTES = 650 * 1024

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
  const isImage = file.type.startsWith('image/')
  const isPdf   = file.type === 'application/pdf'
  if (!isImage && !isPdf) return 'Please upload an image or PDF file.'
  if (isPdf && file.size > PDF_MAX_BYTES) return 'PDF too large. Maximum is 650 KB.'
  return null
}

// Reads a file to a base64 data URL, compressing images to fit the doc limit.
const readContent = (file) => file.type.startsWith('image/')
  ? compressImage(file)
  : new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = (e) => resolve(e.target.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

// Uploads one document and returns the attachedDocuments-style entry. Throws
// on failure (metadata is rolled back if the content write fails).
export async function uploadPatientDocument({ file, typeName, typeId = null, idType = null, user }) {
  const content = await readContent(file)
  const sizeKB = (content.length * 0.75 / 1024).toFixed(2)
  const ref = await addDoc(collection(db, 'documents'), {
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
    createdAt:           serverTimestamp(),
  })

  try {
    await setDoc(doc(db, 'documentContents', ref.id), {
      content, documentId: ref.id, patientId: user.uid,
    })
  } catch (err) {
    await deleteDoc(doc(db, 'documents', ref.id)).catch(() => {})
    throw err
  }

  return {
    documentId:       ref.id,
    name:             typeName,
    documentTypeName: typeName,
    status:           'pending',
    date:             new Date().toLocaleDateString(),
  }
}

// Replaces the content of an EXISTING document (used to re-upload a rejected
// document). Keeps the same document id — so every application slice that
// references it picks up the new file + reset status without any snapshot
// rewrite. Resets status to 'pending' for re-review.
export async function replacePatientDocument({ docId, file, user }) {
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
  })
}