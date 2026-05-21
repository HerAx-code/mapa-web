import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import Layout from '../../components/Layout'
import { doc, onSnapshot, updateDoc, serverTimestamp, getDoc, getDocs, collection, query, where, setDoc, deleteField } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import { logAudit } from '../../utils/auditLog'
import {
  MdArrowBack, MdChevronLeft, MdChevronRight,
  MdCheckCircle, MdCancel, MdRefresh, MdPerson,
  MdDescription, MdCalendarToday, MdStorage,
  MdPhone, MdZoomIn, MdZoomOut, MdZoomOutMap,
  MdKeyboard, MdAssignment,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const readableFileType = (mime) => {
  if (!mime) return '—'
  if (mime.includes('pdf'))        return 'PDF'
  if (mime.startsWith('image/png'))  return 'PNG Image'
  if (mime.match(/image\/jpe?g/))    return 'JPEG Image'
  if (mime.startsWith('image/'))     return 'Image'
  return mime.split('/').pop()?.toUpperCase() ?? mime
}

// ── Predefined rejection reasons (shared with DocReview) ──────────────────

const REJECTION_REASONS = [
  'Wrong document type',
  'Document is expired',
  'Image is illegible or too blurry',
  'Wrong patient name on document',
  'Missing signature or official seal',
  'Incomplete document',
  'Other',
]


// ── Main page ─────────────────────────────────────────────────────────────

export default function DocReviewDetail() {
  const { docId }    = useParams()
  const navigate     = useNavigate()
  const location     = useLocation()
  const { user }     = useAuth()

  // docs array + current index passed from DocReview via navigation state
  const passedDocs   = location.state?.docs ?? []
  const passedIdx    = location.state?.startIndex ?? 0
  const [currentIdx, setCurrentIdx] = useState(passedIdx)

  const [docData,        setDocData]        = useState(null)
  const [done,           setDone]           = useState(false)
  const [content,        setContent]        = useState(null)
  const [contentError,   setContentError]   = useState(false)
  const [loading,        setLoading]        = useState(true)
  const [numPages,       setNumPages]       = useState(null)
  const [acting,         setActing]         = useState(false)
  const [zoom,           setZoom]           = useState(1)
  const [pdfWidth,       setPdfWidth]       = useState(600)
  const docPanelRef                         = useRef(null)

  // Context data
  const [patientProfile, setPatientProfile] = useState(null)
  const [patientDocs,    setPatientDocs]    = useState([])
  const [application,    setApplication]    = useState(null)

  // Reject panel state
  const [showReject, setShowReject] = useState(false)
  const [reason,     setReason]     = useState('')
  const [custom,     setCustom]     = useState('')

  const currentDocId = passedDocs[currentIdx]?.id ?? docId
  const total        = passedDocs.length
  const isFirst      = currentIdx <= 0
  const isLast       = currentIdx >= total - 1

  // Subscribe to document metadata real-time
  useEffect(() => {
    setLoading(true)
    setNumPages(null)
    setContent(null)
    setShowReject(false)
    setReason('')
    setCustom('')
    const unsub = onSnapshot(doc(db, 'documents', currentDocId), snap => {
      if (snap.exists()) setDocData({ id: snap.id, ...snap.data() })
      setLoading(false)
    })
    return unsub
  }, [currentDocId])

  // Load file content separately — from documentContents, fallback to document.content (legacy)
  useEffect(() => {
    if (!currentDocId) return
    setContent(null)
    setContentError(false)
    getDoc(doc(db, 'documentContents', currentDocId))
      .then(snap => { if (snap.exists()) setContent(snap.data().content) })
      .catch(() => setContentError(true))
  }, [currentDocId])

  // Load patient profile + application context + other docs when patientId changes
  useEffect(() => {
    if (!docData?.patientId) return
    const pid = docData.patientId

    // Patient profile (contact number)
    getDoc(doc(db, 'users', pid)).then(snap => {
      if (snap.exists()) setPatientProfile(snap.data())
    })

    // Patient's other documents (live)
    const unsubDocs = onSnapshot(
      query(collection(db, 'documents'), where('patientId', '==', pid)),
      snap => setPatientDocs(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )

    // Active application context
    getDocs(query(
      collection(db, 'applications'),
      where('patientId', '==', pid)
    )).then(snap => {
      const active = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .find(a => !['rejected', 'certificate'].includes(a.status))
      setApplication(active ?? null)
    })

    return unsubDocs
  }, [docData?.patientId])

  const navigate_to = (idx) => {
    if (idx < 0 || idx >= total) return
    setCurrentIdx(idx)
    navigate(`/admin/docreview/${passedDocs[idx].id}`,
      { state: { docs: passedDocs, startIndex: idx }, replace: true })
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  const advanceOrFinish = () => {
    if (!isLast) navigate_to(currentIdx + 1)
    else setDone(true)
  }

  const handleVerify = async () => {
    setActing(true)
    try {
      await updateDoc(doc(db, 'documents', docData.id), {
        status: 'verified', rejectionReason: null, verifiedAt: serverTimestamp(),
      })
      if (docData.patientId) await notify(docData.patientId, {
        type: 'doc_verified', title: 'Document verified',
        body: `Your "${docData.name}" has been verified by the administrator.`,
      })
      logAudit(user, { action: 'doc_verified', targetType: 'document', targetId: docData.id, targetName: docData.name, details: `Patient: ${docData.patientName ?? docData.patientId}` })
      toast.success('Document verified.')
      advanceOrFinish()
    } catch { toast.error('Failed to verify.') }
    finally { setActing(false) }
  }

  const handleReject = async () => {
    const finalReason = reason === 'Other' ? custom.trim() : reason
    if (!finalReason) { toast.error('Please select or enter a reason.'); return }
    setActing(true)
    try {
      await updateDoc(doc(db, 'documents', docData.id), {
        status: 'rejected', rejectionReason: finalReason, rejectedAt: serverTimestamp(),
      })
      if (docData.patientId) await notify(docData.patientId, {
        type: 'doc_rejected', title: 'Document rejected',
        body: `Your "${docData.name}" was rejected. Reason: ${finalReason}. Please re-upload a corrected copy.`,
      })
      logAudit(user, { action: 'doc_rejected', targetType: 'document', targetId: docData.id, targetName: docData.name, details: `Reason: ${finalReason}` })
      toast.error('Document rejected.')
      setShowReject(false)

      // If patient has an active application, notify them and the agency
      if (application) {
        notify(docData.patientId, {
          type:  'doc_rejected',
          title: 'Action required — document rejected',
          body:  `Your "${docData.name}" was rejected after your application was submitted. Please re-upload to avoid delays. Reason: ${finalReason}.`,
        }).catch(() => {})
        getDocs(query(collection(db, 'users'), where('agencyId', '==', application.agencyId), where('role', '==', 'agency')))
          .then(snap => Promise.all(snap.docs.map(d => notify(d.id, {
            type:  'doc_rejected',
            title: 'Supporting document rejected',
            body:  `A supporting document for ${docData.patientName}'s application (${application.appId}) was rejected: "${docData.name}". Reason: ${finalReason}.`,
          })))).catch(() => {})
      }

      advanceOrFinish()
    } catch { toast.error('Failed to reject.') }
    finally { setActing(false) }
  }

  const handleReReview = async () => {
    setActing(true)
    try {
      await updateDoc(doc(db, 'documents', docData.id), {
        status: 'pending', rejectionReason: null, reReviewedAt: serverTimestamp(),
      })
      toast.success('Document sent back for re-review.')
      advanceOrFinish()
    } catch { toast.error('Failed to send for re-review.') }
    finally { setActing(false) }
  }

  // content from documentContents collection; fallback to docData.content for legacy uploads
  const fileContent = content ?? docData?.content ?? null
  const isImage     = fileContent?.startsWith('data:image')
  const isPdf       = fileContent?.startsWith('data:application/pdf')
  const isPending   = docData?.status === 'pending'

  // Measure document panel width so react-pdf fills it exactly
  useEffect(() => {
    if (!docPanelRef.current) return
    const obs = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = Math.floor(e.contentRect.width) - 48 // subtract p-6 padding (24px × 2)
        setPdfWidth(Math.max(w, 300))
      }
    })
    obs.observe(docPanelRef.current)
    return () => obs.disconnect()
  }, [])

  // ── Presence tracking ────────────────────────────────────────────────────
  const [presence, setPresence] = useState({})

  // Write presence when viewing, clean up on navigate away or unmount
  useEffect(() => {
    if (!currentDocId || !user?.uid) return
    const presRef = doc(db, 'docReviewPresence', currentDocId)
    setDoc(presRef, {
      [user.uid]: { name: user.name ?? 'Admin', since: serverTimestamp() }
    }, { merge: true }).catch(() => {})
    return () => {
      updateDoc(presRef, { [user.uid]: deleteField() }).catch(() => {})
    }
  }, [currentDocId, user?.uid])

  // Subscribe to presence for this document
  useEffect(() => {
    if (!currentDocId) return
    const unsub = onSnapshot(doc(db, 'docReviewPresence', currentDocId), snap => {
      setPresence(snap.exists() ? snap.data() : {})
    })
    return unsub
  }, [currentDocId])

  const TEN_MINUTES = 10 * 60 * 1000
  const otherReviewers = Object.entries(presence)
    .filter(([uid, v]) => {
      if (uid === user?.uid) return false
      const since = v.since?.toDate?.() ?? null
      return since ? (Date.now() - since.getTime()) < TEN_MINUTES : true
    })
    .map(([, v]) => v.name)

  // Keyboard shortcuts — defined after all handlers so closures capture current values
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') navigate_to(currentIdx + 1)
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   navigate_to(currentIdx - 1)
      if ((e.key === 'v' || e.key === 'V') && isPending && !acting) handleVerify()
      if ((e.key === 'r' || e.key === 'R') && isPending && !acting) setShowReject(true)
      if (e.key === 'Escape' && showReject) { setShowReject(false); setReason(''); setCustom('') }
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(z + 0.25, 3))
      if (e.key === '-')                   setZoom(z => Math.max(z - 0.25, 0.5))
      if (e.key === '0')                   setZoom(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentIdx, isPending, acting, showReject, docData])

  if (done) {
    return (
      <Layout breadcrumb="Document Review">
        <div className="flex flex-col items-center justify-center flex-1 p-8 text-center">
          <div className="text-6xl mb-5">✅</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">All Done!</h2>
          <p className="text-gray-500 mb-1">
            You've reviewed all <strong>{total}</strong> document{total !== 1 ? 's' : ''} in this batch.
          </p>
          <p className="text-sm text-gray-400 mb-8">The queue has been cleared for this session.</p>
          <button className="btn-primary text-sm"
            onClick={() => navigate('/admin/docreview')}>
            Back to Document Review
          </button>
        </div>
      </Layout>
    )
  }

  return (
    <Layout breadcrumb="Document Review">
    <div className="flex flex-col flex-1 overflow-hidden min-h-0">

      {/* ── Sub-header: document navigation ─────────────────────────────── */}
      <div className="bg-white border-b border-gray-100 flex items-center px-4 py-2.5 gap-3 flex-shrink-0">
        <button
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors flex-shrink-0"
          onClick={() => navigate('/admin/docreview')}>
          <MdArrowBack size={16} /> Back to Review
        </button>

        <div className="h-4 w-px bg-gray-200 flex-shrink-0" />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {loading ? '—' : docData?.name}
          </p>
          {docData?.patientName && (
            <p className="text-xs text-gray-400 leading-tight">{docData.patientName}</p>
          )}
        </div>

        {/* Progress + navigation */}
        {total > 1 && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-gray-400">{currentIdx + 1} of {total}</span>
            <button disabled={isFirst}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-colors"
              onClick={() => navigate_to(currentIdx - 1)}>
              <MdChevronLeft size={18} />
            </button>
            <button disabled={isLast}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-colors"
              onClick={() => navigate_to(currentIdx + 1)}>
              <MdChevronRight size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Concurrent reviewer warning */}
      {otherReviewers.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2 flex-shrink-0">
          <span className="text-amber-500">👁</span>
          <p className="text-sm text-amber-700">
            <strong>{otherReviewers.join(', ')}</strong> {otherReviewers.length === 1 ? 'is' : 'are'} also reviewing this document. Coordinate to avoid duplicate actions.
          </p>
        </div>
      )}

      {/* ── Content area ────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden bg-gray-100">

        {/* Document panel */}
        <div ref={docPanelRef} className="flex-1 overflow-auto p-6 flex flex-col items-center">
          {loading ? (
            <div className="w-full max-w-3xl space-y-3 animate-pulse mt-4">
              <div className="h-8 bg-white rounded w-1/2" />
              <div className="h-[70vh] bg-white rounded-xl" />
            </div>
          ) : contentError ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <MdDescription size={48} className="text-red-200 mb-3" />
              <p className="text-sm text-red-500 font-medium mb-1">Failed to load document content</p>
              <p className="text-xs text-gray-400 mb-4">This may be a network error or the file may be corrupted.</p>
              <button className="btn-secondary text-sm"
                onClick={() => {
                  setContentError(false)
                  getDoc(doc(db, 'documentContents', currentDocId))
                    .then(snap => { if (snap.exists()) setContent(snap.data().content) })
                    .catch(() => setContentError(true))
                }}>
                Retry
              </button>
            </div>
          ) : !fileContent ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <MdDescription size={48} className="text-gray-200 mb-3" />
              <p className="text-sm text-gray-500">Loading document content...</p>
            </div>
          ) : isImage ? (
            <div className="w-full max-w-3xl">
              {/* Zoom controls */}
              <div className="flex items-center justify-end gap-2 mb-3">
                <button onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))}
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors">
                  <MdZoomOut size={16} />
                </button>
                <span className="text-xs text-gray-500 w-12 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(z => Math.min(z + 0.25, 3))}
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors">
                  <MdZoomIn size={16} />
                </button>
                <button onClick={() => setZoom(1)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors">
                  <MdZoomOutMap size={16} />
                </button>
              </div>
              <div className="overflow-auto rounded-xl shadow-md">
                <img src={fileContent} alt={docData?.name}
                  style={{ transform: `scale(${zoom})`, transformOrigin: 'top left',
                    width: `${100 / zoom}%`, display: 'block' }} />
              </div>
            </div>
          ) : isPdf ? (
            <div className="w-full max-w-3xl">
              {/* Zoom controls */}
              <div className="flex items-center justify-end gap-2 mb-3">
                <button onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))}
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors">
                  <MdZoomOut size={16} />
                </button>
                <span className="text-xs text-gray-500 w-12 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(z => Math.min(z + 0.25, 3))}
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors">
                  <MdZoomIn size={16} />
                </button>
                <button onClick={() => setZoom(1)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors">
                  <MdZoomOutMap size={16} />
                </button>
              </div>
              <Document
                file={fileContent}
                onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                onLoadError={() => setContentError(true)}
                loading={
                  <div className="flex items-center justify-center h-64 text-sm text-gray-400">
                    Loading PDF...
                  </div>
                }
                className="space-y-4">
                {numPages && Array.from({ length: numPages }, (_, i) => (
                  <Page
                    key={i + 1}
                    pageNumber={i + 1}
                    width={Math.floor(pdfWidth * zoom)}
                    className="rounded-xl overflow-hidden shadow-md"
                    renderAnnotationLayer
                    renderTextLayer
                  />
                ))}
              </Document>
              {numPages > 1 && (
                <p className="text-xs text-center text-gray-400 mt-2">{numPages} pages</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <p className="text-sm text-gray-500 mb-3">Preview not available for this file type.</p>
              <a href={fileContent} download={docData?.fileName}
                className="btn-primary text-sm">Download to View</a>
            </div>
          )}
        </div>

        {/* ── Right sidebar ──────────────────────────────────────────────── */}
        <div className="w-72 bg-white border-l border-gray-100 overflow-y-auto flex-shrink-0">
          <div className="p-4 space-y-5">

            {/* Status badge */}
            {docData && (
              <div className="flex items-center justify-between">
                <span className={`badge text-xs ${
                  docData.status === 'verified' ? 'badge-green'
                  : docData.status === 'rejected' ? 'badge-red'
                  : 'badge-amber'}`}>
                  {docData.status?.charAt(0).toUpperCase() + docData.status?.slice(1) ?? '—'}
                </span>
                {docData.idType && (
                  <span className="text-xs text-gray-500 font-medium">{docData.idType}</span>
                )}
              </div>
            )}

            {/* ── Actions — top of sidebar so they're always visible ── */}
            <div>
              {/* Pending actions */}
              {isPending && !showReject && (
                <div className="space-y-2">
                  <button
                    className="w-full btn-primary text-sm flex items-center justify-center gap-2"
                    disabled={acting} onClick={handleVerify}>
                    <MdCheckCircle size={16} /> {acting ? 'Saving…' : 'Verify Document'}
                  </button>
                  <button
                    className="w-full btn-danger text-sm flex items-center justify-center gap-2"
                    disabled={acting} onClick={() => setShowReject(true)}>
                    <MdCancel size={16} /> Reject Document
                  </button>
                </div>
              )}

              {/* Reject form */}
              {isPending && showReject && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-gray-700">Reason for rejection <span className="text-red-400">*</span></p>
                  <div className="space-y-1.5">
                    {REJECTION_REASONS.map(r => (
                      <label key={r}
                        className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                          reason === r ? 'border-red-300 bg-red-50' : 'border-gray-100 hover:bg-gray-50'
                        }`}>
                        <input type="radio" name="reason" value={r}
                          checked={reason === r}
                          onChange={() => setReason(r)}
                          className="accent-red-500 flex-shrink-0" />
                        <span className="text-sm text-gray-700">{r}</span>
                      </label>
                    ))}
                  </div>
                  {reason === 'Other' && (
                    <input className="input text-sm" placeholder="Specify reason..."
                      value={custom} onChange={e => setCustom(e.target.value)} autoFocus />
                  )}
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-2.5">
                    <p className="text-sm text-amber-700">The patient will be notified with this reason.</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-secondary text-sm flex-1"
                      onClick={() => { setShowReject(false); setReason(''); setCustom('') }}>
                      Cancel
                    </button>
                    <button className="btn-danger text-sm flex-1" disabled={acting}
                      onClick={handleReject}>
                      {acting ? 'Saving…' : 'Confirm'}
                    </button>
                  </div>
                </div>
              )}

              {/* Re-review for verified/rejected */}
              {!isPending && (
                <button
                  className="w-full flex items-center justify-center gap-2 text-sm text-amber-600 border border-amber-200 px-3 py-2.5 rounded-xl hover:bg-amber-50 transition-colors"
                  disabled={acting} onClick={handleReReview}>
                  <MdRefresh size={16} /> Send for Re-review
                </button>
              )}
            </div>

            <div className="border-t border-gray-100" />

            {/* Patient info */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Patient</p>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 bg-brand-50 rounded-full flex items-center justify-center flex-shrink-0">
                  <MdPerson size={16} className="text-brand-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800">{docData?.patientName ?? '—'}</p>
                  {patientProfile?.hospitalId
                    ? <p className="text-xs text-gray-400 font-mono">{patientProfile.hospitalId}</p>
                    : <p className="text-xs text-gray-400">No Hospital ID on file</p>
                  }
                </div>
              </div>
              {patientProfile?.contact && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <MdPhone size={14} className="text-gray-400 flex-shrink-0" />
                  <span>{patientProfile.contact}</span>
                </div>
              )}
            </div>

            {/* Application context */}
            {application && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Application</p>
                <div className="bg-gray-50 rounded-xl p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <MdAssignment size={14} className="text-gray-400 flex-shrink-0" />
                    <p className="text-sm font-medium text-gray-800 truncate">{application.agencyName}</p>
                  </div>
                  <p className="text-xs text-gray-400 font-mono pl-5">{application.appId}</p>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ml-5 inline-block ${
                    application.status === 'pending'   ? 'bg-blue-100 text-blue-700'
                    : application.status === 'reviewing' ? 'bg-amber-100 text-amber-700'
                    : application.status === 'interview' ? 'bg-purple-100 text-purple-700'
                    : 'bg-gray-100 text-gray-600'
                  }`}>{application.status}</span>
                </div>
              </div>
            )}

            {/* Document metadata */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Document Info</p>
              <div className="space-y-2">
                {[
                  { icon: MdDescription,  label: 'Type',      value: readableFileType(docData?.type) },
                  { icon: MdStorage,      label: 'Size',      value: docData?.size ?? '—'            },
                  { icon: MdCalendarToday,label: 'Submitted', value: docData?.date ?? '—'            },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex items-start gap-2">
                    <Icon size={14} className="text-gray-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs text-gray-400 leading-tight">{label}</p>
                      <p className="text-sm text-gray-700">{value}</p>
                    </div>
                  </div>
                ))}
              </div>
              {docData?.idVerifyUrl && (
                <a href={docData.idVerifyUrl} target="_blank" rel="noopener noreferrer"
                  className="mt-2 flex items-center gap-1 text-xs text-brand-500 hover:text-brand-600 font-medium">
                  🔗 Verify on official portal →
                </a>
              )}
            </div>

            {/* Other patient documents */}
            {patientDocs.length > 1 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
                  Patient Documents ({patientDocs.length})
                </p>
                <div className="space-y-1.5">
                  {(() => {
                    // Group by name, mark latest of each type
                    const latestByName = {}
                    patientDocs.forEach(d => {
                      const cur = latestByName[d.name]
                      const dTime = d.createdAt?.seconds ?? 0
                      const cTime = cur?.createdAt?.seconds ?? 0
                      if (!cur || dTime > cTime) latestByName[d.name] = d
                    })
                    return [...patientDocs]
                      .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
                      .map(d => {
                        const isLatest = latestByName[d.name]?.id === d.id
                        const isCurrent = d.id === docData?.id
                        return (
                          <div key={d.id}
                            className={`flex items-center justify-between p-2 rounded-lg ${
                              isCurrent ? 'bg-brand-50 border border-brand-200' : 'bg-gray-50'
                            }`}>
                            <div className="min-w-0 flex-1 mr-2">
                              <p className={`text-xs truncate ${isCurrent ? 'font-semibold text-brand-700' : 'text-gray-700'}`}>
                                {d.name}
                              </p>
                              {isLatest && patientDocs.filter(x => x.name === d.name).length > 1 && (
                                <span className="text-xs text-brand-500 font-medium">Latest version</span>
                              )}
                            </div>
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                              d.status === 'verified' ? 'bg-green-100 text-green-700'
                              : d.status === 'rejected' ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-700'
                            }`}>{d.status}</span>
                          </div>
                        )
                      })
                  })()}
                </div>
              </div>
            )}

            {/* Rejection reason (if rejected) */}
            {docData?.rejectionReason && (
              <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                <p className="text-xs font-semibold text-red-600 mb-1">Rejection Reason</p>
                <p className="text-sm text-red-700">{docData.rejectionReason}</p>
              </div>
            )}

            {/* Keyboard shortcuts hint */}
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center gap-1.5 mb-2">
                <MdKeyboard size={14} className="text-gray-400" />
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Shortcuts</p>
              </div>
              <div className="space-y-1 text-xs text-gray-400">
                <div className="flex justify-between"><span>Verify</span><kbd className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-mono">V</kbd></div>
                <div className="flex justify-between"><span>Reject</span><kbd className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-mono">R</kbd></div>
                <div className="flex justify-between"><span>Next</span><kbd className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-mono">→</kbd></div>
                <div className="flex justify-between"><span>Previous</span><kbd className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-mono">←</kbd></div>
                <div className="flex justify-between"><span>Zoom in/out</span><kbd className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-mono">+ / −</kbd></div>
                <div className="flex justify-between"><span>Reset zoom</span><kbd className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-mono">0</kbd></div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
    </Layout>
  )
}
