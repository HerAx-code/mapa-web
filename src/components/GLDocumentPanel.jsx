import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import {
  MdCardMembership, MdDownload, MdRefresh,
  MdZoomIn, MdClose, MdLock, MdOpenInNew,
} from 'react-icons/md'

const tsToDate = (ts) => !ts ? null : (ts.toDate ? ts.toDate() : new Date(ts))
const formatDate = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
}

// ── Lightbox for viewing the scan full-size ───────────────────────────────

function Lightbox({ src, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/80 z-[400] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <button onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center">
        <MdClose size={20} />
      </button>
      <img src={src} alt="Signed Guarantee Letter"
        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
    </div>
  )
}

// ── Main panel ───────────────────────────────────────────────────────────

/**
 * Shows the Guarantee Letter document for an application.
 *
 * Props:
 * - app:        the application object
 * - canReplace: if true, shows the Replace Signed Scan action (agency coordinator)
 * - onReplace:  callback that opens the SignedGLUploadModal
 * - compact:    smaller layout for patient-side display
 */
export default function GLDocumentPanel({ app, canReplace = false, onReplace, compact = false }) {
  const { user }   = useAuth()
  const navigate   = useNavigate()
  const [signedScan, setSignedScan] = useState(null)
  const [loaded, setLoaded]         = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  useEffect(() => {
    if (!app?.id) return
    const unsub = onSnapshot(doc(db, 'certificates', app.id),
      snap => { setSignedScan(snap.exists() ? snap.data() : null); setLoaded(true) },
      () => setLoaded(true)
    )
    return unsub
  }, [app?.id])

  // No GL yet — application not approved
  if (!app?.approvedAmount && app?.status !== 'approved' && app?.status !== 'certificate') {
    return null
  }

  const handleOpenGL = () => {
    // Navigate to the dedicated GL viewer page (same tab).
    // From there the user can Print or Save as PDF via the browser dialog.
    navigate(`/agency/applications/${app.id}/gl`)
  }

  const handleDownload = () => {
    if (!signedScan?.base64) return
    const a = document.createElement('a')
    a.href = signedScan.base64
    a.download = signedScan.fileName ?? `guarantee-letter-${app.appId}.jpg`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }


  // State derivations
  const hasSigned = !!signedScan
  const status    = app.glStatus
  const isRedeemed = status === 'redeemed'
  const isExpired  = status === 'expired'

  const stateTag = isRedeemed ? { label: 'Redeemed', cls: 'badge-green' }
    : isExpired ? { label: 'Expired', cls: 'bg-orange-100 text-orange-700' }
    : hasSigned ? { label: 'Signed & Uploaded', cls: 'badge-green' }
    : status === 'issued' ? { label: 'Issued — awaiting signed scan', cls: 'badge-amber' }
    : { label: 'Not yet issued', cls: 'badge-gray' }

  // ── Compact (patient TrackStatus) variant ────────────────────────

  if (compact) {
    return (
      <>
        {lightboxOpen && signedScan && <Lightbox src={signedScan.base64} onClose={() => setLightboxOpen(false)} />}
        <div className="bg-white rounded-xl border border-gray-200 p-3 flex items-start gap-3">
          {/* Thumbnail or placeholder */}
          {hasSigned ? (
            <button onClick={() => setLightboxOpen(true)}
              className="relative w-20 h-24 rounded-lg overflow-hidden border border-gray-200 hover:ring-2 hover:ring-brand-300 transition-all flex-shrink-0 bg-gray-50">
              <img src={signedScan.base64} alt="Signed GL thumbnail"
                className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/0 hover:bg-black/30 flex items-center justify-center transition-colors">
                <MdZoomIn size={20} className="text-white opacity-0 hover:opacity-100" />
              </div>
            </button>
          ) : (
            <div className="w-20 h-24 rounded-lg border border-dashed border-gray-200 bg-gray-50 flex items-center justify-center flex-shrink-0">
              <MdCardMembership size={24} className="text-gray-300" />
            </div>
          )}

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <p className="text-sm font-semibold text-gray-800">Guarantee Letter</p>
              <span className={`badge text-xs ${stateTag.cls}`}>{stateTag.label}</span>
            </div>
            <p className="text-xs text-gray-500 mb-2">
              {hasSigned
                ? <>Click the thumbnail to view, or download a copy.</>
                : <>The signed copy will appear here once your agency uploads it.</>}
            </p>
            {hasSigned && (
              <button onClick={handleDownload}
                className="text-xs text-brand-500 hover:text-brand-600 font-medium flex items-center gap-1">
                <MdDownload size={13} /> Download
              </button>
            )}
          </div>
        </div>
      </>
    )
  }

  // ── Full (agency / admin) variant ────────────────────────────────

  return (
    <>
      {lightboxOpen && signedScan && <Lightbox src={signedScan.base64} onClose={() => setLightboxOpen(false)} />}

      <div className="card p-4">
        <div className="flex items-start justify-between mb-3 gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <MdCardMembership size={16} className="text-brand-500" />
            <p className="text-sm font-semibold text-gray-800">Guarantee Letter Document</p>
            <span className={`badge text-xs ${stateTag.cls}`}>{stateTag.label}</span>
          </div>
          {!canReplace && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <MdLock size={11} /> Read-only
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

          {/* Thumbnail / placeholder */}
          <div className="sm:col-span-1">
            {loaded && hasSigned ? (
              <button onClick={() => setLightboxOpen(true)}
                className="relative w-full aspect-[3/4] rounded-lg overflow-hidden border border-gray-200 hover:ring-2 hover:ring-brand-300 transition-all bg-gray-50 group">
                <img src={signedScan.base64} alt="Signed Guarantee Letter"
                  className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-colors">
                  <span className="text-white text-xs font-medium opacity-0 group-hover:opacity-100 flex items-center gap-1">
                    <MdZoomIn size={16} /> View full size
                  </span>
                </div>
              </button>
            ) : (
              <div className="w-full aspect-[3/4] rounded-lg border border-dashed border-gray-200 bg-gray-50/60 flex flex-col items-center justify-center gap-2 p-4 text-center">
                <MdCardMembership size={28} className="text-gray-300" />
                <p className="text-xs text-gray-400">
                  {!loaded ? 'Loading…' : 'No signed scan uploaded yet'}
                </p>
              </div>
            )}
          </div>

          {/* Info + actions */}
          <div className="sm:col-span-2 space-y-2">
            <div className="bg-gray-50 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-400">Approved Amount</p>
              <p className="text-sm font-semibold text-gray-800">₱{Number(app.approvedAmount ?? 0).toLocaleString()}</p>
            </div>
            {app.purposeOfAssistance?.length > 0 && (
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-400">For</p>
                <p className="text-sm text-gray-800">{app.purposeOfAssistance.join(', ')}</p>
              </div>
            )}
            {app.payableTo && (
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-400">Payable To</p>
                <p className="text-sm text-gray-800">{app.payableTo}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-400">Approved</p>
                <p className="text-xs text-gray-700">{formatDate(app.approvedAt)}</p>
              </div>
              {hasSigned && (
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-xs text-gray-400">Scan uploaded</p>
                  <p className="text-xs text-gray-700">{formatDate(signedScan.uploadedAt)}</p>
                </div>
              )}
              {isRedeemed && (
                <div className="bg-green-50 rounded-lg px-3 py-2 col-span-2">
                  <p className="text-xs text-green-600">Redeemed</p>
                  <p className="text-xs text-green-700">{formatDate(app.glRedeemedAt)}</p>
                </div>
              )}
              {isExpired && (
                <div className="bg-orange-50 rounded-lg px-3 py-2 col-span-2">
                  <p className="text-xs text-orange-600">Expired</p>
                  <p className="text-xs text-orange-700">{formatDate(app.glExpiredAt)} — committed budget released</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 flex-wrap pt-2">
              <button className="btn-primary text-xs flex items-center gap-1"
                title="Open the GL viewer page. From there you can Print or Save as PDF."
                onClick={handleOpenGL}>
                <MdOpenInNew size={13} /> Open Guarantee Letter
              </button>
              {hasSigned && (
                <button className="btn-secondary text-xs flex items-center gap-1"
                  title="Download the signed scan image uploaded by the agency"
                  onClick={handleDownload}>
                  <MdDownload size={13} /> Download Signed Scan
                </button>
              )}
              {canReplace && hasSigned && (
                <button className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                  onClick={onReplace}>
                  <MdRefresh size={13} /> Replace
                </button>
              )}
              {canReplace && !hasSigned && (
                <button className="btn-secondary text-xs flex items-center gap-1"
                  onClick={onReplace}>
                  <MdRefresh size={13} /> Upload Signed Scan
                </button>
              )}
            </div>

            {canReplace && (
              <p className="text-xs text-gray-400 leading-relaxed pt-2">
                <strong>Workflow:</strong> Click <strong>Open Guarantee Letter</strong> to view, then Print (for wet-signing) or Save as PDF from the viewer page. After signing on paper, scan it and click <strong>Upload Signed Scan</strong> so the patient can download the signed copy.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
