import { useState, useEffect } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { fetchDocumentContent } from '../utils/uploadDocument'
import {
  MdClose, MdDownload, MdZoomIn, MdInsertDriveFile,
  MdOpenInNew, MdRefresh,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import StatusBadge from './ui/StatusBadge'

// ── Fullscreen image lightbox ────────────────────────────────────────────

function ImageLightbox({ src, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/85 z-[500] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <button onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center">
        <MdClose size={20} />
      </button>
      <img src={src} alt="Document"
        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
    </div>
  )
}

// ── Shared document preview (body + open/download) ───────────────────────
// Fetches the document content from Storage (when docMeta.storagePath is
// present; new uploads since Tier-2 item 8) or from documentContents
// (legacy path). Renders the image/PDF inline with robust fallbacks.
// Used both inside DocViewerModal and inline in the CRMC request
// detail's side-by-side review panel.
export function DocPreview({ docMeta, className = '' }) {
  const [content, setContent]     = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [imgError, setImgError]   = useState(false)
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  useEffect(() => {
    if (!docMeta?.id) return
    setLoading(true); setError(null); setContent(null); setImgError(false)
    ;(async () => {
      try {
        // Prefer Storage when the doc has been migrated / freshly uploaded.
        const fromStorage = await fetchDocumentContent(docMeta)
        if (fromStorage) { setContent(fromStorage); return }

        // Legacy fallback: pre-migration docs still have the base64
        // content in documentContents/{docId}.
        const snap = await getDoc(doc(db, 'documentContents', docMeta.id))
        const fetched = snap.exists() ? snap.data()?.content : null
        const resolved = fetched || docMeta?.content
        if (resolved) setContent(resolved)
        else setError(snap.exists()
          ? 'The file content is empty. Ask the patient to re-upload this document.'
          : 'The file content has not been uploaded yet, or was deleted. Ask the patient to (re-)upload it.')
      } catch (err) {
        console.error('DocPreview load failed:', err)
        setError(`Failed to load document: ${err?.code === 'permission-denied' ? 'permission denied' : (err?.message ?? 'unknown error')}.`)
      } finally {
        setLoading(false)
      }
    })()
  }, [docMeta?.id, docMeta?.storagePath])

  const isImage = content?.startsWith?.('data:image')
  const isPdf   = content?.startsWith?.('data:application/pdf')

  // Chrome refuses to render a data: URL PDF in an iframe — convert to a Blob
  // URL so the inline preview works.
  useEffect(() => {
    if (!content || !isPdf) { setPdfBlobUrl(null); return }
    let url = null
    try {
      const [meta, base64] = content.split(',')
      const mime = meta?.match(/data:([^;]+);/)?.[1] ?? 'application/pdf'
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      url = URL.createObjectURL(new Blob([bytes], { type: mime }))
      setPdfBlobUrl(url)
    } catch (e) {
      console.error('PDF blob conversion failed:', e)
      setPdfBlobUrl(null)
    }
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [content, isPdf])

  const downloadName = (() => {
    const safe = (docMeta?.name ?? 'document').replace(/[^a-z0-9\s.-]/gi, '_').trim()
    const ext = isPdf ? '.pdf' : isImage ? '.jpg' : ''
    return safe.endsWith(ext) ? safe : `${safe}${ext}`
  })()

  const handleDownload = () => {
    if (!content) return
    const a = document.createElement('a')
    a.href = content; a.download = downloadName
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  const handleOpenInNewTab = () => {
    if (!content) return
    if (isPdf && pdfBlobUrl) {
      const win = window.open(pdfBlobUrl, '_blank')
      if (!win) toast.error('Please allow pop-ups to open the document.')
      return
    }
    const win = window.open()
    if (!win) { toast.error('Please allow pop-ups to open the document.'); return }
    if (isImage) win.document.write(`<img src="${content}" style="max-width:100vw;max-height:100vh;margin:auto;display:block;" />`)
    else win.document.write(`<a href="${content}" download="${downloadName}">Download document</a>`)
  }

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      {lightboxOpen && isImage && content && <ImageLightbox src={content} onClose={() => setLightboxOpen(false)} />}

      <div className="flex-1 overflow-auto bg-gray-50 flex items-center justify-center p-4 min-h-0">
        {loading && (
          <div className="text-center">
            <MdRefresh size={28} className="text-gray-300 mx-auto mb-2 animate-spin" />
            <p className="text-sm text-gray-400">Loading document…</p>
          </div>
        )}

        {!loading && error && (
          <div className="text-center max-w-sm">
            <MdInsertDriveFile size={36} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-500 font-medium">{error}</p>
          </div>
        )}

        {!loading && !error && content && isImage && !imgError && (
          <button onClick={() => setLightboxOpen(true)}
            className="relative group w-full max-w-3xl rounded-lg overflow-hidden bg-white border border-gray-200 shadow-sm hover:ring-2 hover:ring-brand-300 transition-all">
            <img src={content} alt={docMeta?.name ?? 'Document'}
              onError={() => setImgError(true)}
              className="w-full max-h-[74vh] object-contain block mx-auto" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-colors">
              <span className="opacity-0 group-hover:opacity-100 text-white text-sm font-medium flex items-center gap-1">
                <MdZoomIn size={18} /> View full size
              </span>
            </div>
          </button>
        )}

        {!loading && !error && content && isImage && imgError && (
          <div className="text-center max-w-sm">
            <MdInsertDriveFile size={36} className="text-amber-300 mx-auto mb-3" />
            <p className="text-sm text-gray-700 font-medium mb-1">This image couldn't be displayed</p>
            <p className="text-xs text-gray-500">Try Download or ask the patient to re-upload.</p>
          </div>
        )}

        {!loading && !error && content && isPdf && pdfBlobUrl && (
          <div className="w-full flex flex-col items-center">
            {/* <object> renders the PDF inline when the browser supports it, and
                shows the fallback children otherwise — unlike an <iframe>, it
                won't trigger a download when the browser is set to download
                PDFs (which was popping a Save dialog on view). */}
            <object data={pdfBlobUrl} type="application/pdf"
              className="w-full h-[74vh] bg-white rounded-lg border border-gray-200 shadow-sm">
              <div className="p-6 text-center">
                <MdInsertDriveFile size={36} className="text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-600 font-medium mb-1">PDF preview isn't available in this browser</p>
                <p className="text-xs text-gray-400">Your browser is set to download PDFs. Use <strong>Open in new tab</strong> or <strong>Download</strong> below.</p>
              </div>
            </object>
            <p className="text-xs text-gray-400 mt-2 text-center">
              Not showing? <button onClick={handleOpenInNewTab} className="text-brand-600 hover:underline font-medium">Open in a new tab</button>.
            </p>
          </div>
        )}

        {!loading && !error && content && isPdf && !pdfBlobUrl && (
          <div className="text-center max-w-sm">
            <MdInsertDriveFile size={36} className="text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-600 font-medium mb-1">PDF document</p>
            <p className="text-xs text-gray-400">Use Open in new tab or Download below.</p>
          </div>
        )}

        {!loading && !error && content && !isImage && !isPdf && (
          <div className="text-center max-w-sm">
            <MdInsertDriveFile size={36} className="text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-600 font-medium mb-1">Preview not available for this file type</p>
            <p className="text-xs text-gray-400">You can still download or open it in a new tab.</p>
          </div>
        )}
      </div>

      {content && (
        <div className="flex items-center justify-end gap-2 px-2 py-2 flex-shrink-0">
          <button onClick={handleOpenInNewTab} className="btn-secondary text-sm flex items-center gap-1.5">
            <MdOpenInNew size={14} /> Open in new tab
          </button>
          <button onClick={handleDownload} className="btn-primary text-sm flex items-center gap-1.5">
            <MdDownload size={14} /> Download
          </button>
        </div>
      )}
    </div>
  )
}

// ── Modal wrapper (used where a side-by-side panel isn't available) ──────

export default function DocViewerModal({ docMeta, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-[400] flex items-end sm:items-center justify-center sm:p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1.5 bg-gray-300 rounded-full" />
        </div>
        <div className="flex items-center justify-between px-5 py-3 sm:py-4 border-b border-gray-100 flex-shrink-0 gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <MdInsertDriveFile size={18} className="text-gray-400 flex-shrink-0" />
            <h2 className="text-base font-semibold text-gray-900 truncate">{docMeta?.name ?? 'Document'}</h2>
            {docMeta?.status && (
              <StatusBadge status={docMeta.status} kind="doc" />
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><MdClose size={20} /></button>
        </div>
        {docMeta?.documentTypeName && (
          <div className="px-5 py-2 border-b border-gray-50 text-xs text-gray-500 flex-shrink-0">Type: {docMeta.documentTypeName}</div>
        )}
        <DocPreview docMeta={docMeta} className="flex-1" />
        <div className="flex justify-end px-5 py-3 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} className="btn-secondary text-sm">Close</button>
        </div>
      </div>
    </div>
  )
}
