import { useRef, useState } from 'react'
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { notify } from '../utils/notifications'
import { MdClose, MdUpload, MdPictureAsPdf, MdOpenInNew } from 'react-icons/md'
import toast from 'react-hot-toast'

const MAX_WIDTH = 1200
const QUALITY   = 0.78

// Firestore documents are capped at 1 MiB. We store the signed scan as
// a base64 data URL inside the certificate document, so the
// post-encode payload must fit under that envelope. For images we
// aggressively resize + re-encode as JPEG to land under ~900 KB. PDFs
// can't be resized client-side without a heavy library (pdf-lib is
// ~80 KB), so the raw file size has to be small enough that base64
// (~33% inflation) still fits. 700 KB raw → ~933 KB base64 → fits.
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

// Detect whether a data URL holds a PDF or an image. Patient and agency
// preview surfaces use this to render PDFs differently from images.
const isPdfDataUrl = (s) => typeof s === 'string' && s.startsWith('data:application/pdf')

export default function SignedGLUploadModal({ app, existing, onClose }) {
  const fileRef             = useRef()
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview]     = useState(existing?.base64 ?? null)
  const [fileName, setFileName]   = useState(existing?.fileName ?? null)

  const previewIsPdf = isPdfDataUrl(preview)

  const handleFile = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    const isPdf   = file.type === 'application/pdf'
    const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)

    if (!isPdf && !isImage) {
      toast.error('Please upload a JPG, PNG, or PDF file.')
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
      let base64
      if (isPdf) {
        base64 = await fileToBase64(file)
      } else {
        base64 = await resizeImage(file)
      }
      if (base64.length > MAX_BASE64_LEN) {
        toast.error(
          isPdf
            ? 'PDF too large to store after encoding. Try a lower-DPI scan.'
            : 'Image is still too large after compression. Try a lower resolution scan.'
        )
        return
      }
      setPreview(base64)
      setFileName(file.name)
    } catch {
      toast.error('Failed to process file.')
    }
  }

  const handleSave = async () => {
    if (!preview) { toast.error('Please select a file first.'); return }
    setUploading(true)
    try {
      await setDoc(doc(db, 'certificates', app.id), {
        base64:     preview,
        fileName:   fileName ?? (previewIsPdf ? 'guarantee-letter.pdf' : 'guarantee-letter.jpg'),
        appId:      app.id,
        agencyId:   app.agencyId,
        patientId:  app.patientId,
        uploadedAt: serverTimestamp(),
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
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Upload Signed Guarantee Letter</h2>
            <p className="text-xs text-gray-400 mt-0.5">{app.patientName} · {app.appId}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {preview ? (
            previewIsPdf ? (
              // PDF preview — can't render inline in <img>, so show a
              // document card with filename + open-in-new-tab affordance.
              <div className="relative">
                <div className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-5 flex items-center gap-3">
                  <div className="w-12 h-12 bg-red-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <MdPictureAsPdf size={26} className="text-red-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{fileName}</p>
                    <p className="text-xs text-gray-400 mt-0.5">PDF document · ready to upload</p>
                  </div>
                  <a href={preview} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1 flex-shrink-0">
                    <MdOpenInNew size={13} /> Preview
                  </a>
                </div>
                <button
                  className="absolute top-2 right-2 w-7 h-7 bg-white rounded-full shadow flex items-center justify-center text-gray-400 hover:text-red-500"
                  onClick={() => { setPreview(null); setFileName(null) }}>
                  <MdClose size={14} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <img src={preview} alt="Guarantee Letter preview"
                  className="w-full rounded-xl border border-gray-100 object-contain max-h-64" />
                <button
                  className="absolute top-2 right-2 w-7 h-7 bg-white rounded-full shadow flex items-center justify-center text-gray-400 hover:text-red-500"
                  onClick={() => { setPreview(null); setFileName(null) }}>
                  <MdClose size={14} />
                </button>
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

          {!preview && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
              Upload a scanned image or PDF of the signed Guarantee Letter. PDFs from office
              scanners should be at 150 DPI to stay under 700 KB. The patient will be able to
              download it from their Track Status page.
            </div>
          )}

          {preview && fileName && !previewIsPdf && (
            <p className="text-xs text-gray-400 text-center">{fileName}</p>
          )}
        </div>

        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          {!preview && (
            <button className="btn-primary text-sm" onClick={() => fileRef.current?.click()}>
              Choose File
            </button>
          )}
          {preview && (
            <button className="btn-primary text-sm" onClick={handleSave} disabled={uploading}>
              {uploading ? 'Uploading…' : existing ? 'Replace Signed GL' : 'Upload Signed GL'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
