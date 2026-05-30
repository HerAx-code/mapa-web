import { useRef, useState } from 'react'
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { notify } from '../utils/notifications'
import { MdClose, MdUpload, MdPictureAsPdf, MdOpenInNew } from 'react-icons/md'
import toast from 'react-hot-toast'

// IMPORTANT: this project is on Firebase Spark (no-cost plan), and Firebase
// Storage requires Blaze on projects created after Oct 2024. So instead of
// uploading the signed scan to /certificates/{appId}/signed.{ext}, we stuff
// the file into certificates/{appId}.base64 inside Firestore (1 MiB doc cap).
//
// To fit under the cap we aggressively resize + JPEG-re-encode images. PDFs
// can't be resized client-side without a heavy library, so the raw file must
// be small enough that the base64 inflation (~33%) still fits — ~700 KB raw.
//
// Code for the Cloud-Storage upload path is preserved in git history (commit
// b888fa9). When the project moves to Blaze, that commit can be reapplied and
// this base64 path retired. The read sites (GLDocumentPanel, TrackStatus)
// already prefer downloadUrl with a base64 fallback, so they don't need to
// change in either direction.
const MAX_WIDTH = 1200
const QUALITY   = 0.78
const MAX_PDF_RAW_BYTES = 700 * 1024
const MAX_IMG_RAW_BYTES = 4 * 1024 * 1024
const MAX_BASE64_LEN    = 900_000

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = (e) => resolve(e.target.result)
  reader.onerror = reject
  reader.readAsDataURL(file)
})

const resizeImage = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = (e) => {
    const img = new Image()
    img.onload = () => {
      const scale  = Math.min(1, MAX_WIDTH / img.width)
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.width  * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', QUALITY))
    }
    img.onerror = reject
    img.src = e.target.result
  }
  reader.onerror = reject
  reader.readAsDataURL(file)
})

const isPdfDataUrl = (s) => typeof s === 'string' && s.startsWith('data:application/pdf')

export default function SignedGLUploadModal({ app, existing, onClose }) {
  const fileRef             = useRef()
  const [uploading, setUploading] = useState(false)
  // The base64-encoded payload, ready to write. null = nothing new selected.
  const [pendingPayload, setPendingPayload] = useState(null)
  const [pendingName, setPendingName]       = useState(null)
  const [pendingType, setPendingType]       = useState(null)

  // Existing scan — download URL takes precedence (legacy Storage uploads
  // pre-revert), base64 is the current path. Used purely for preview when no
  // new file is queued.
  const existingUrl  = existing?.downloadUrl ?? existing?.base64 ?? null
  const existingType = existing?.contentType ?? (
    typeof existing?.base64 === 'string' && existing.base64.startsWith('data:application/pdf')
      ? 'application/pdf'
      : 'image/jpeg'
  )
  const existingIsPdf = existingType === 'application/pdf'

  const showingPending = !!pendingPayload
  const previewIsPdf   = showingPending
    ? pendingType === 'application/pdf'
    : existingIsPdf
  const previewUrl     = showingPending ? pendingPayload : existingUrl
  const fileName       = showingPending ? pendingName    : (existing?.fileName ?? null)

  const handleFile = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    const isPdf   = file.type === 'application/pdf'
    const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)

    if (!isPdf && !isImage) {
      toast.error('Please upload a JPG, PNG, WEBP, or PDF file.')
      return
    }

    if (isPdf && file.size > MAX_PDF_RAW_BYTES) {
      toast.error(
        `PDF too large (${Math.round(file.size / 1024)} KB). Maximum is 700 KB. ` +
        `Try scanning at 150 DPI instead of 300, or use the "Reduce file size" option in your PDF reader.`,
        { duration: 8000 },
      )
      return
    }
    if (isImage && file.size > MAX_IMG_RAW_BYTES) {
      toast.error('Image too large. Please use an image under 4 MB.')
      return
    }

    try {
      const payload = isPdf ? await fileToBase64(file) : await resizeImage(file)
      if (payload.length > MAX_BASE64_LEN) {
        toast.error(
          isPdf
            ? 'PDF too large to store after encoding. Try a lower-DPI scan.'
            : 'Image is still too large after compression. Try a lower resolution scan.'
        )
        return
      }
      setPendingPayload(payload)
      setPendingName(file.name)
      setPendingType(isPdf ? 'application/pdf' : 'image/jpeg')
    } catch (err) {
      console.error('[SignedGLUpload] file processing failed:', err)
      toast.error('Failed to process file.')
    }
  }

  const clearPending = () => {
    setPendingPayload(null)
    setPendingName(null)
    setPendingType(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleSave = async () => {
    if (!pendingPayload) { toast.error('Please select a file first.'); return }
    setUploading(true)
    try {
      await setDoc(doc(db, 'certificates', app.id), {
        base64:      pendingPayload,
        contentType: pendingType,
        fileName:    pendingName ?? (pendingType === 'application/pdf' ? 'guarantee-letter.pdf' : 'guarantee-letter.jpg'),
        appId:       app.id,
        agencyId:    app.agencyId,
        patientId:   app.patientId,
        uploadedAt:  serverTimestamp(),
        // Explicitly null these so a stale Storage-era doc doesn't keep
        // pointing read sites at a downloadUrl that no longer resolves.
        downloadUrl: null,
        storagePath: null,
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
      toast.error('Upload failed. Please try again.')
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
              <p className="text-xs text-gray-400">JPG, PNG, or PDF · Max 4 MB image / 700 KB PDF</p>
            </button>
          )}

          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden" onChange={handleFile} />

          {existing && !showingPending && (
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full text-sm text-brand-600 hover:text-brand-700 font-medium border border-brand-100 hover:border-brand-200 rounded-lg py-2">
              Replace with a different file
            </button>
          )}

          {!previewUrl && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
              Upload a scanned image or PDF of the signed Guarantee Letter. PDFs from office
              scanners should be at 150 DPI to stay under 700 KB. The patient will be able to
              download it from their Track Status page.
            </div>
          )}

          {showingPending && !previewIsPdf && fileName && (
            <p className="text-xs text-gray-400 text-center">{fileName}</p>
          )}
        </div>

        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose} disabled={uploading}>Cancel</button>
          {!pendingPayload && !existing && (
            <button className="btn-primary text-sm" onClick={() => fileRef.current?.click()}>
              Choose File
            </button>
          )}
          {pendingPayload && (
            <button className="btn-primary text-sm" onClick={handleSave} disabled={uploading}>
              {uploading ? 'Uploading…' : existing ? 'Replace Signed GL' : 'Upload Signed GL'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}