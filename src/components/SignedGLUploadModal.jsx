import { useRef, useState, useEffect } from 'react'
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase'
import { notify } from '../utils/notifications'
import { MdClose, MdUpload, MdPictureAsPdf, MdOpenInNew } from 'react-icons/md'
import toast from 'react-hot-toast'

// Files now go to Cloud Storage instead of being base64-stuffed into a
// Firestore doc. The 1 MiB Firestore limit no longer applies, so we accept
// signed scans up to 10 MB raw — enough headroom for 300 DPI office scanner
// PDFs and high-resolution JPEGs without re-encoding the legal document.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const EXT_FOR_TYPE = {
  'application/pdf': 'pdf',
  'image/jpeg':      'jpg',
  'image/png':       'png',
  'image/webp':      'webp',
}

const ACCEPTED_TYPES = Object.keys(EXT_FOR_TYPE)

// Build a local preview data URL only for images (so the modal can show a
// thumbnail before upload). PDFs render as a card with the filename — they
// can't be previewed inline without a heavy renderer.
const fileToLocalDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = (e) => resolve(e.target.result)
  reader.onerror = reject
  reader.readAsDataURL(file)
})

export default function SignedGLUploadModal({ app, existing, onClose }) {
  const fileRef = useRef()
  const [uploading, setUploading]       = useState(false)
  // The File object the user picked. null = nothing new selected.
  const [pendingFile, setPendingFile]   = useState(null)
  // Local preview data URL for images. null for PDFs or no selection.
  const [imagePreview, setImagePreview] = useState(null)

  // Existing scan (already in Storage / legacy in Firestore base64) — used
  // as the fallback display when no new file is queued. downloadUrl is the
  // canonical field; base64 is the legacy field from pre-Storage uploads.
  const existingUrl  = existing?.downloadUrl ?? existing?.base64 ?? null
  const existingType = existing?.contentType ?? (
    typeof existing?.base64 === 'string' && existing.base64.startsWith('data:application/pdf')
      ? 'application/pdf'
      : 'image/jpeg'
  )
  const existingIsPdf = existingType === 'application/pdf'

  // Render decisions: show the pending file if one is selected, otherwise
  // show the existing scan, otherwise show the picker placeholder.
  const showingPending = !!pendingFile
  const previewIsPdf   = showingPending
    ? pendingFile.type === 'application/pdf'
    : existingIsPdf
  const previewUrl     = showingPending
    ? (imagePreview ?? null)
    : existingUrl
  const fileName       = showingPending ? pendingFile.name : (existing?.fileName ?? null)

  // Clean up the local preview when the modal unmounts or the file changes.
  useEffect(() => {
    return () => { setImagePreview(null) }
  }, [pendingFile])

  const handleFile = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error('Please upload a JPG, PNG, WEBP, or PDF file.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(
        `File too large (${Math.round(file.size / 1024 / 1024)} MB). Maximum is 10 MB. ` +
        `If you need to fit more, try scanning at 200 DPI instead of 600.`,
        { duration: 8000 },
      )
      return
    }

    setPendingFile(file)
    // Build a local preview for images only; PDFs show a filename card.
    if (file.type !== 'application/pdf') {
      try {
        const dataUrl = await fileToLocalDataUrl(file)
        setImagePreview(dataUrl)
      } catch {
        setImagePreview(null)
      }
    } else {
      setImagePreview(null)
    }
  }

  const clearPending = () => {
    setPendingFile(null)
    setImagePreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleSave = async () => {
    if (!pendingFile) { toast.error('Please select a file first.'); return }
    setUploading(true)
    try {
      const ext         = EXT_FOR_TYPE[pendingFile.type]
      const storagePath = `certificates/${app.id}/signed.${ext}`
      const fileRefObj  = storageRef(storage, storagePath)
      const uploadSnap  = await uploadBytes(fileRefObj, pendingFile, {
        contentType: pendingFile.type,
        // Cache for an hour; signed scans rarely change after first upload.
        cacheControl: 'private, max-age=3600',
      })
      const downloadUrl = await getDownloadURL(uploadSnap.ref)

      await setDoc(doc(db, 'certificates', app.id), {
        downloadUrl,
        storagePath,
        contentType:  pendingFile.type,
        fileName:     pendingFile.name,
        size:         pendingFile.size,
        appId:        app.id,
        agencyId:     app.agencyId,
        patientId:    app.patientId,
        uploadedAt:   serverTimestamp(),
        // Drop the legacy base64 field if we're overwriting a legacy doc.
        base64:       null,
      })
      await updateDoc(doc(db, 'applications', app.id), {
        certificateUploaded: true,
        updatedAt: serverTimestamp(),
      })
      await notify(app.patientId, {
        type:  'certificate_ready',
        title: 'Your signed Guarantee Letter is available',
        body:  `${app.agencyName} has uploaded your signed Guarantee Letter. You can download it from your Track Status page.`,
      })
      toast.success('Signed Guarantee Letter uploaded. Patient can now download it.')
      onClose()
    } catch (err) {
      console.error('[SignedGLUpload]', err?.code, err?.message, err)
      // Storage errors are usually one of these; surface a clearer hint.
      if (String(err?.code).includes('storage/unauthorized')) {
        toast.error('Upload denied. You may not be the owning agency for this application.')
      } else if (String(err?.code).includes('storage/canceled')) {
        toast.error('Upload canceled.')
      } else if (String(err?.code).includes('storage/quota-exceeded') || String(err?.code).includes('storage/limit')) {
        toast.error('Storage quota exceeded. Please contact CRMC admin.')
      } else {
        toast.error('Upload failed. Please try again.')
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && !uploading && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Upload Signed Guarantee Letter</h2>
            <p className="text-xs text-gray-400 mt-0.5">{app.patientName} · {app.appId}</p>
          </div>
          <button onClick={onClose} disabled={uploading}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"><MdClose size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {previewUrl ? (
            previewIsPdf ? (
              // PDF preview — can't render inline in <img>, so show a
              // document card with filename + open-in-new-tab affordance.
              <div className="relative">
                <div className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-5 flex items-center gap-3">
                  <div className="w-12 h-12 bg-red-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <MdPictureAsPdf size={26} className="text-red-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{fileName ?? 'signed-gl.pdf'}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      PDF document · {showingPending ? 'ready to upload' : 'currently uploaded'}
                    </p>
                  </div>
                  {!showingPending && (
                    <a href={previewUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1 flex-shrink-0">
                      <MdOpenInNew size={13} /> Preview
                    </a>
                  )}
                </div>
                {showingPending && (
                  <button
                    className="absolute top-2 right-2 w-7 h-7 bg-white rounded-full shadow flex items-center justify-center text-gray-400 hover:text-red-500"
                    onClick={clearPending}>
                    <MdClose size={14} />
                  </button>
                )}
              </div>
            ) : (
              <div className="relative">
                <img src={previewUrl} alt="Guarantee Letter preview"
                  className="w-full rounded-xl border border-gray-100 object-contain max-h-64" />
                {showingPending && (
                  <button
                    className="absolute top-2 right-2 w-7 h-7 bg-white rounded-full shadow flex items-center justify-center text-gray-400 hover:text-red-500"
                    onClick={clearPending}>
                    <MdClose size={14} />
                  </button>
                )}
              </div>
            )
          ) : (
            <button
              className="w-full border-2 border-dashed border-gray-200 rounded-xl p-8 flex flex-col items-center gap-2 hover:border-brand-300 hover:bg-brand-50/30 transition-colors"
              onClick={() => fileRef.current?.click()}>
              <MdUpload size={28} className="text-gray-300" />
              <p className="text-sm text-gray-500 font-medium">Click to select file</p>
              <p className="text-xs text-gray-400">JPG, PNG, WEBP, or PDF · Up to 10 MB</p>
            </button>
          )}

          {/* Picker hidden so the visible buttons trigger it cleanly. */}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden" onChange={handleFile} />

          {/* If we're showing an existing scan, give a way to swap it. */}
          {existing && !showingPending && (
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full text-sm text-brand-600 hover:text-brand-700 font-medium border border-brand-100 hover:border-brand-200 rounded-lg py-2">
              Replace with a different file
            </button>
          )}

          {!previewUrl && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
              Upload a scanned image or PDF of the signed Guarantee Letter. The patient will be able to
              download it from their Track Status page.
            </div>
          )}

          {showingPending && !previewIsPdf && fileName && (
            <p className="text-xs text-gray-400 text-center">{fileName}</p>
          )}
        </div>

        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose} disabled={uploading}>Cancel</button>
          {!pendingFile && !existing && (
            <button className="btn-primary text-sm" onClick={() => fileRef.current?.click()}>
              Choose File
            </button>
          )}
          {pendingFile && (
            <button className="btn-primary text-sm" onClick={handleSave} disabled={uploading}>
              {uploading ? 'Uploading…' : existing ? 'Replace Signed GL' : 'Upload Signed GL'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}