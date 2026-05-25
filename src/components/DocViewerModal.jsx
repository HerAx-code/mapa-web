import { useState, useEffect } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import {
  MdClose, MdDownload, MdZoomIn, MdInsertDriveFile,
  MdOpenInNew, MdRefresh,
} from 'react-icons/md'
import toast from 'react-hot-toast'

const STATUS_BADGE = {
  verified: 'badge-green',
  rejected: 'badge-red',
  pending:  'badge-amber',
}

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

// ── Main viewer modal ────────────────────────────────────────────────────

/**
 * View a submitted document by ID. Fetches from `documentContents/{id}`.
 *
 * Props:
 * - docMeta: { id, name, status, date, ... } — the document metadata row
 * - onClose: callback
 */
export default function DocViewerModal({ docMeta, onClose }) {
  const [content, setContent]     = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [imgError, setImgError]   = useState(false)
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  useEffect(() => {
    if (!docMeta?.id) return
    setLoading(true)
    setError(null)
    setContent(null)
    setImgError(false)
    getDoc(doc(db, 'documentContents', docMeta.id))
      .then(snap => {
        // Prefer the dedicated content collection, fall back to inline content
        // on the document doc itself (older records).
        const fetched = snap.exists() ? snap.data()?.content : null
        const legacy  = docMeta?.content
        const resolved = fetched || legacy

        if (resolved) {
          setContent(resolved)
        } else {
          setError(snap.exists()
            ? 'The file content is empty. This often happens with demo/seeded data — ask the patient to re-upload this document.'
            : 'The file content has not been uploaded yet, or was deleted. Ask the patient to (re-)upload this document.')
        }
      })
      .catch(err => {
        console.error('DocViewer load failed:', err)
        setError(`Failed to load document: ${err?.code === 'permission-denied' ? 'permission denied' : (err?.message ?? 'unknown error')}.`)
      })
      .finally(() => setLoading(false))
  }, [docMeta?.id])

  const isImage = content?.startsWith?.('data:image')
  const isPdf   = content?.startsWith?.('data:application/pdf')

  // Chrome (and other browsers) increasingly refuse to render PDFs from a
  // `data:application/pdf` URL inside an iframe — the iframe loads but stays
  // blank. Converting to a Blob URL sidesteps this restriction. We also use
  // the Blob URL for "Open in new tab" so the new-tab flow shows the PDF.
  useEffect(() => {
    if (!content || !isPdf) {
      setPdfBlobUrl(null)
      return
    }
    let url = null
    try {
      const [meta, base64] = content.split(',')
      const mime = meta?.match(/data:([^;]+);/)?.[1] ?? 'application/pdf'
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const blob = new Blob([bytes], { type: mime })
      url = URL.createObjectURL(blob)
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
    a.href = content
    a.download = downloadName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleOpenInNewTab = () => {
    if (!content) return
    if (isPdf && pdfBlobUrl) {
      // Use Blob URL for PDFs — same Chrome restriction applies in new tabs
      // when fed a data URL. Blob URLs render reliably.
      const win = window.open(pdfBlobUrl, '_blank')
      if (!win) toast.error('Please allow pop-ups to open the document.')
      return
    }
    const win = window.open()
    if (!win) {
      toast.error('Please allow pop-ups to open the document.')
      return
    }
    if (isImage) {
      win.document.write(`<img src="${content}" style="max-width:100vw;max-height:100vh;margin:auto;display:block;" />`)
    } else {
      win.document.write(`<a href="${content}" download="${downloadName}">Download document</a>`)
    }
  }

  return (
    <>
      {lightboxOpen && isImage && content && <ImageLightbox src={content} onClose={() => setLightboxOpen(false)} />}

      <div className="fixed inset-0 bg-black/40 z-[400] flex items-end sm:items-center justify-center sm:p-4"
        onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">

          {/* Drag handle — mobile only */}
          <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-10 h-1.5 bg-gray-300 rounded-full" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 sm:py-4 border-b border-gray-100 flex-shrink-0 gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <MdInsertDriveFile size={18} className="text-gray-400 flex-shrink-0" />
              <h2 className="text-base font-semibold text-gray-900 truncate">{docMeta?.name ?? 'Document'}</h2>
              {docMeta?.status && (
                <span className={`badge text-xs ${STATUS_BADGE[docMeta.status] ?? 'badge-gray'}`}>
                  {docMeta.status}
                </span>
              )}
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
              <MdClose size={20} />
            </button>
          </div>

          {/* Metadata strip */}
          <div className="px-5 py-2 border-b border-gray-50 text-xs text-gray-500 flex items-center gap-3 flex-wrap flex-shrink-0">
            {docMeta?.date && <span>Uploaded: {docMeta.date}</span>}
            {docMeta?.documentTypeName && (
              <>
                <span className="text-gray-300">·</span>
                <span>Type: {docMeta.documentTypeName}</span>
              </>
            )}
            {docMeta?.updatedAfterSubmission && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-amber-600 font-medium">Updated after submission</span>
              </>
            )}
          </div>

          {/* Body */}
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
                <p className="text-xs text-gray-400 mt-1">
                  The file may have been removed. Contact the patient to re-upload.
                </p>
              </div>
            )}

            {!loading && !error && content && isImage && !imgError && (
              <button onClick={() => setLightboxOpen(true)}
                className="relative group rounded-lg overflow-hidden bg-white border border-gray-200 shadow-sm hover:ring-2 hover:ring-brand-300 transition-all">
                <img src={content} alt={docMeta?.name ?? 'Document'}
                  onError={() => setImgError(true)}
                  className="max-w-full max-h-[60vh] object-contain block" />
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
                <p className="text-sm text-gray-700 font-medium mb-1">
                  This image couldn't be displayed
                </p>
                <p className="text-xs text-gray-500">
                  The file may be corrupted or in an unsupported format. Try Download or ask the patient to re-upload.
                </p>
              </div>
            )}

            {!loading && !error && content && isPdf && (
              <iframe src={pdfBlobUrl ?? content} title={docMeta?.name ?? 'Document'}
                className="w-full h-[70vh] bg-white rounded-lg border border-gray-200 shadow-sm" />
            )}

            {!loading && !error && content && !isImage && !isPdf && (
              <div className="text-center max-w-sm">
                <MdInsertDriveFile size={36} className="text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-600 font-medium mb-1">
                  Preview not available for this file type
                </p>
                <p className="text-xs text-gray-400 mb-4">
                  You can still download or open the file in a new tab.
                </p>
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 flex-shrink-0">
            {content && (
              <>
                <button onClick={handleOpenInNewTab}
                  className="btn-secondary text-sm flex items-center gap-1.5">
                  <MdOpenInNew size={14} /> Open in new tab
                </button>
                <button onClick={handleDownload}
                  className="btn-primary text-sm flex items-center gap-1.5">
                  <MdDownload size={14} /> Download
                </button>
              </>
            )}
            <button onClick={onClose} className="btn-secondary text-sm">Close</button>
          </div>
        </div>
      </div>
    </>
  )
}
