import { useRef, useState } from 'react'
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { notify } from '../utils/notifications'
import { MdClose, MdUpload } from 'react-icons/md'
import toast from 'react-hot-toast'

const MAX_WIDTH = 1200
const QUALITY   = 0.78

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

export default function SignedGLUploadModal({ app, existing, onClose }) {
  const fileRef             = useRef()
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview]     = useState(existing?.base64 ?? null)
  const [fileName, setFileName]   = useState(existing?.fileName ?? null)

  const handleFile = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) {
      toast.error('Please upload a JPG or PNG image.')
      return
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error('File too large. Please use an image under 4 MB.')
      return
    }
    try {
      const base64 = await resizeImage(file)
      if (base64.length > 900_000) {
        toast.error('Image is still too large after compression. Try a lower resolution scan.')
        return
      }
      setPreview(base64)
      setFileName(file.name)
    } catch {
      toast.error('Failed to process image.')
    }
  }

  const handleSave = async () => {
    if (!preview) { toast.error('Please select an image first.'); return }
    setUploading(true)
    try {
      await setDoc(doc(db, 'certificates', app.id), {
        base64:     preview,
        fileName:   fileName ?? 'guarantee-letter.jpg',
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
      console.error(err)
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
            <div className="relative">
              <img src={preview} alt="Guarantee Letter preview"
                className="w-full rounded-xl border border-gray-100 object-contain max-h-64" />
              <button
                className="absolute top-2 right-2 w-7 h-7 bg-white rounded-full shadow flex items-center justify-center text-gray-400 hover:text-red-500"
                onClick={() => { setPreview(null); setFileName(null) }}>
                <MdClose size={14} />
              </button>
            </div>
          ) : (
            <button
              className="w-full border-2 border-dashed border-gray-200 rounded-xl p-8 flex flex-col items-center gap-2 hover:border-brand-300 hover:bg-brand-50/30 transition-colors"
              onClick={() => fileRef.current?.click()}>
              <MdUpload size={28} className="text-gray-300" />
              <p className="text-sm text-gray-500 font-medium">Click to select image</p>
              <p className="text-xs text-gray-400">JPG or PNG · Max 4 MB</p>
            </button>
          )}

          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
            className="hidden" onChange={handleFile} />

          {!preview && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
              Upload a scanned image of the signed Guarantee Letter. The patient will be able to download it from their Track Status page.
            </div>
          )}

          {preview && fileName && (
            <p className="text-xs text-gray-400 text-center">{fileName}</p>
          )}
        </div>

        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          {!preview && (
            <button className="btn-primary text-sm" onClick={() => fileRef.current?.click()}>
              Choose Image
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
