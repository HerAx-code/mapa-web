import Layout from '../../components/Layout'
import { useState, useEffect, useRef } from 'react'
import {
  MdUpload, MdCheckCircle, MdPending, MdCancel,
  MdDelete, MdInfo, MdClose, MdDescription, MdCameraAlt,
} from 'react-icons/md'
import { collection, query, where, onSnapshot, addDoc, deleteDoc, doc, setDoc, updateDoc, serverTimestamp, getDocs } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import { useTranslation } from 'react-i18next'
import DocViewerModal from '../../components/DocViewerModal'
import toast from 'react-hot-toast'

// ── Status visuals ───────────────────────────────────────────────────────
// Labels live in i18n at patient.documents.docStatus.* — read via t().

const STATUS_VISUAL = {
  verified: { badge: 'badge-green', icon: MdCheckCircle, iconColor: 'text-green-500' },
  pending:  { badge: 'badge-amber', icon: MdPending,     iconColor: 'text-amber-500' },
  rejected: { badge: 'badge-red',   icon: MdCancel,      iconColor: 'text-red-500'   },
}

// ── Upload Modal ──────────────────────────────────────────────────────────

// Philippine government-issued ID types with official verification portals
const PH_ID_TYPES = [
  { name: 'PhilSys National ID',  verifyUrl: 'https://philsys.gov.ph'            },
  { name: 'Passport',             verifyUrl: 'https://passport.gov.ph'            },
  { name: "Driver's License",     verifyUrl: 'https://lto.gov.ph'                 },
  { name: 'SSS ID',               verifyUrl: 'https://www.sss.gov.ph'             },
  { name: 'PhilHealth ID',        verifyUrl: 'https://www.philhealth.gov.ph'      },
  { name: 'PagIBIG ID',           verifyUrl: 'https://www.pagibigfund.gov.ph'     },
  { name: "Voter's ID (COMELEC)", verifyUrl: 'https://www.comelec.gov.ph'         },
  { name: 'Postal ID',            verifyUrl: 'https://www.phlpost.gov.ph'         },
  { name: 'PRC ID',               verifyUrl: 'https://www.prc.gov.ph'             },
  { name: 'Senior Citizen ID',    verifyUrl: null                                 },
  { name: 'PWD ID',               verifyUrl: null                                 },
  { name: 'Barangay ID',          verifyUrl: null                                 },
  { name: 'School / Student ID',  verifyUrl: null                                 },
  { name: 'Company / Employee ID',verifyUrl: null                                 },
]

// Compress image to fit within Firestore 1MB document limit
// Target: base64 string under 900,000 chars (~675KB raw)
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

function UploadModal({ docTypes, existingDocs, user, onClose }) {
  const { t } = useTranslation()
  const [selectedTypeId, setSelectedTypeId] = useState('')
  const [file, setFile]                     = useState(null)
  const [preview, setPreview]               = useState(null)
  const [uploading, setUploading]           = useState(false)
  const [attested,  setAttested]            = useState(false)
  const [idType,    setIdType]              = useState('')
  const fileRef                             = useRef(null)
  const cameraRef                           = useRef(null)

  // Deduplicate by name in case Firestore has duplicate entries
  const uniqueDocTypes = docTypes.filter(
    (t, i, arr) => arr.findIndex(x => x.name === t.name) === i
  )
  const selectedType  = uniqueDocTypes.find(t => t.id === selectedTypeId)
  const required      = uniqueDocTypes.filter(t => t.required)
  const optional      = uniqueDocTypes.filter(t => !t.required)
  const isIdDocument  = /\bid\b/i.test(selectedType?.name ?? '')

  // Reset file, preview, idType and attestation when document type changes
  useEffect(() => {
    setFile(null)
    setPreview(null)
    setIdType('')
    setAttested(false)
  }, [selectedTypeId])

  // Check for existing documents of the selected type
  const existingOfType = selectedTypeId
    ? existingDocs.filter(d => d.documentTypeId === selectedTypeId)
    : []
  const hasVerified = existingOfType.some(d => d.status === 'verified')
  const hasPending  = existingOfType.some(d => d.status === 'pending')

  const handleFileChange = (e) => {
    const f = e.target.files[0]
    if (!f) return
    // Only images and PDFs are accepted
    const isImage = f.type.startsWith('image/')
    const isPdf   = f.type === 'application/pdf'
    if (!isImage && !isPdf) {
      toast.error(t('patient.documents.upload.errFileType'))
      e.target.value = ''
      return
    }
    // PDFs cannot be compressed — enforce 650KB limit upfront
    if (isPdf && f.size > 650 * 1024) {
      toast.error(t('patient.documents.upload.errPdfTooBig'))
      return
    }
    setFile(f)
    // Generate preview for images
    if (f.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = (ev) => setPreview(ev.target.result)
      reader.readAsDataURL(f)
    } else {
      setPreview(null)
    }
  }

  const handleUpload = async () => {
    if (!selectedTypeId)              { toast.error(t('patient.documents.upload.errNoDocType')); return }
    if (isIdDocument && !idType)     { toast.error(t('patient.documents.upload.errNoIdType')); return }
    if (!file)                       { toast.error(t('patient.documents.upload.errNoFile')); return }
    setUploading(true)
    try {
      // Images: compress client-side to fit Firestore 1MB limit
      // PDFs/DOCs: read directly (size already checked in handleFileChange)
      const content = file.type.startsWith('image/')
        ? await compressImage(file)
        : await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload  = (e) => resolve(e.target.result)
            reader.onerror = reject
            reader.readAsDataURL(file)
          })

      // Calculate actual stored size from base64 (post-compression)
      const actualSizeKB = (content.length * 0.75 / 1024).toFixed(2)

      // Store metadata first (no content — keeps list queries fast)
      const docRef = await addDoc(collection(db, 'documents'), {
        patientId:        user.uid,
        patientName:      user.name ?? '',
        name:             selectedType.name,
        fileName:         file.name,
        documentTypeId:   selectedTypeId,
        documentTypeName: selectedType.name,
        type:             file.type || 'application/octet-stream',
        size:             `${actualSizeKB} KB`,
        date:             new Date().toLocaleDateString(),
        status:               'pending',
        agreedToAttestation:  true,
        attestedAt:           new Date().toISOString(),
        ...(isIdDocument && idType ? {
          idType,
          idVerifyUrl: PH_ID_TYPES.find(t => t.name === idType)?.verifyUrl ?? null,
        } : {}),
        createdAt:            serverTimestamp(),
      })

      // Store file content separately — rollback metadata if this fails
      try {
        await setDoc(doc(db, 'documentContents', docRef.id), {
          content,
          documentId: docRef.id,
          patientId:  user.uid,
        })
      } catch (contentErr) {
        // Content write failed — delete the metadata to avoid orphaned record
        await deleteDoc(doc(db, 'documents', docRef.id)).catch(() => {})
        throw contentErr
      }

      // Notify admins — fire-and-forget
      getDocs(query(collection(db, 'users'), where('role', 'in', ['super_admin', 'staff_admin'])))
        .then(snap => Promise.all(snap.docs.map(d => notify(d.id, {
          type:  'doc_uploaded',
          title: 'New document submitted',
          body:  `${user.name} has uploaded "${selectedType.name}" for review.`,
        })))).catch(() => {})

      // If patient has an active application, update its attachedDocuments and notify agency
      getDocs(query(collection(db, 'applications'), where('patientId', '==', user.uid)))
        .then(async appsSnap => {
          const active = appsSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .find(a => !['rejected', 'certificate'].includes(a.status))
          if (!active) return

          // Replace the entry for this document type with the new document ID
          const current = active.attachedDocuments ?? []
          const updated = [
            ...current.filter(d => d.documentTypeName !== selectedType.name),
            {
              documentId:       docRef.id,
              name:             selectedType.name,
              documentTypeName: selectedType.name,
              status:           'pending',
              date:             new Date().toLocaleDateString(),
              updatedAfterSubmission: true,
            },
          ]
          // Auto-revert from awaiting_info → reviewing when the patient
          // responds. The coordinator decides whether the new upload satisfies
          // their request; the system just unblocks the queue.
          const wasAwaiting = active.status === 'awaiting_info'
          const appUpdates  = { attachedDocuments: updated }
          if (wasAwaiting) {
            appUpdates.status                  = 'reviewing'
            appUpdates.awaitingInfoMessage     = null
            appUpdates.awaitingInfoRequestedAt = null
            appUpdates.awaitingInfoRequestedBy = null
            appUpdates.awaitingInfoResumedAt   = serverTimestamp()
          }
          await updateDoc(doc(db, 'applications', active.id), appUpdates)

          // Notify the agency
          const agencySnap = await getDocs(query(
            collection(db, 'users'),
            where('agencyId', '==', active.agencyId),
            where('role', '==', 'agency')
          ))
          const notifyBody = wasAwaiting
            ? `${user.name} responded to your request by uploading "${selectedType.name}" for application ${active.appId}. The application is back in your queue.`
            : `${user.name} uploaded a new "${selectedType.name}" for application ${active.appId}. Please review their updated documents.`
          agencySnap.docs.forEach(d => notify(d.id, {
            type:  wasAwaiting ? 'awaiting_info_responded' : 'doc_uploaded',
            title: wasAwaiting ? 'Patient responded — application resumed' : 'Patient updated a document',
            body:  notifyBody,
          }).catch(() => {}))
        }).catch(() => {})

      toast.success(t('patient.documents.upload.success'))
      onClose()
    } catch { toast.error(t('patient.documents.upload.failed')) }
    finally { setUploading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-end sm:items-center justify-center sm:p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[90vh] flex flex-col overflow-hidden">

        {/* Drag handle — mobile only */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1.5 bg-gray-300 rounded-full" />
        </div>

        <div className="flex items-center justify-between px-5 py-3 sm:py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{t('patient.documents.upload.modalTitle')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><MdClose size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* Document type selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('patient.documents.upload.docTypeLabel')} <span className="text-red-400">*</span>
            </label>
            {docTypes.length === 0 ? (
              <div className="input bg-gray-50 text-gray-400 text-sm">
                {t('patient.documents.upload.noDocTypes')}
              </div>
            ) : (
              <select className="input" value={selectedTypeId}
                onChange={e => setSelectedTypeId(e.target.value)}>
                <option value="">{t('patient.documents.upload.selectDocType')}</option>
                {required.length > 0 && (
                  <optgroup label={t('patient.documents.upload.required')}>
                    {required.map(dt => <option key={dt.id} value={dt.id}>{dt.name}</option>)}
                  </optgroup>
                )}
                {optional.length > 0 && (
                  <optgroup label={t('patient.documents.upload.optional')}>
                    {optional.map(dt => <option key={dt.id} value={dt.id}>{dt.name}</option>)}
                  </optgroup>
                )}
              </select>
            )}
            {selectedType?.description && (
              <div className="mt-2 bg-blue-50 border border-blue-100 rounded-lg p-2.5 flex items-start gap-2">
                <MdInfo size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-blue-700">{selectedType.description}</p>
              </div>
            )}
            {selectedType?.required && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                <MdInfo size={12} /> {t('patient.documents.upload.requiredHint')}
              </p>
            )}
            {hasVerified && (
              <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-start gap-2">
                <MdInfo size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">
                  {t('patient.documents.upload.alreadyVerified', { type: selectedType?.name })}
                </p>
              </div>
            )}
            {!hasVerified && hasPending && (
              <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-2.5 flex items-start gap-2">
                <MdInfo size={14} className="text-gray-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-gray-500">
                  {t('patient.documents.upload.alreadyPending', { type: selectedType?.name })}
                </p>
              </div>
            )}
          </div>

          {/* ID sub-type — required when document type name contains "ID" */}
          {isIdDocument && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('patient.documents.upload.idTypeLabel')} <span className="text-red-400">*</span>
              </label>
              <select className="input" value={idType}
                onChange={e => setIdType(e.target.value)}>
                <option value="">{t('patient.documents.upload.selectIdType')}</option>
                {PH_ID_TYPES.map(id => (
                  <option key={id.name} value={id.name}>{id.name}</option>
                ))}
                <option value="I'm not sure">{t('patient.documents.upload.idNotSure')}</option>
              </select>
              <p className="text-xs text-gray-400 mt-1">
                {t('patient.documents.upload.idHint')}
              </p>
            </div>
          )}

          {/* File picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('patient.documents.upload.attachLabel')} <span className="text-red-400">*</span>
            </label>
            <button
              onClick={() => !uploading && fileRef.current?.click()}
              className={`w-full border-2 border-dashed rounded-xl overflow-hidden text-center transition-colors ${
                file ? 'border-brand-300 bg-brand-50' : 'border-gray-200 hover:border-brand-300 hover:bg-brand-50/30'
              } ${uploading ? 'cursor-not-allowed opacity-70' : ''}`}>
              {uploading ? (
                <div className="p-6 flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-brand-600 font-medium">{t('patient.documents.upload.uploading')}</p>
                </div>
              ) : preview ? (
                <div>
                  <img src={preview} alt="Document preview"
                    className="w-full max-h-40 object-cover" />
                  <div className="px-4 py-2 bg-brand-50">
                    <p className="text-xs font-medium text-brand-700 truncate flex items-center gap-1.5">
                      <MdDescription size={13} className="flex-shrink-0" /> {file.name}
                    </p>
                    <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB · {t('patient.documents.upload.tapChange')}</p>
                  </div>
                </div>
              ) : file ? (
                <div className="p-5">
                  <p className="text-sm font-medium text-brand-700 flex items-center gap-1.5 justify-center">
                    <MdDescription size={14} className="flex-shrink-0" /> {file.name}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{(file.size / 1024).toFixed(1)} KB · {t('patient.documents.upload.tapChange')}</p>
                </div>
              ) : (
                <div className="p-5">
                  <MdUpload size={24} className="text-gray-300 mx-auto mb-1" />
                  <p className="text-sm text-gray-500">{t('patient.documents.upload.tapBrowse')}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{t('patient.documents.upload.fileTypesHint')}</p>
                </div>
              )}
            </button>
            <input ref={fileRef} type="file" className="hidden"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={handleFileChange} />
            <input ref={cameraRef} type="file" className="hidden"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange} />
            <div className="flex items-center gap-3 mt-2">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">{t('patient.documents.upload.or')}</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <button
              onClick={() => !uploading && cameraRef.current?.click()}
              disabled={uploading}
              className="mt-2 w-full py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
              <MdCameraAlt size={16} /> {t('patient.documents.upload.takePhoto')}
            </button>
            <p className="text-xs text-gray-400 text-center mt-1">
              {t('patient.documents.upload.cameraHint')}
            </p>
          </div>
        </div>

        {/* Attestation declaration */}
        <div className="px-5 pb-4 border-t border-gray-100 pt-4">
          <label className={`flex items-start gap-3 cursor-pointer p-3 rounded-xl border-2 transition-colors ${
            attested ? 'border-brand-400 bg-brand-50' : 'border-gray-200 hover:border-gray-300'
          }`}>
            <input
              type="checkbox"
              className="mt-0.5 w-4 h-4 accent-brand-500 flex-shrink-0"
              checked={attested}
              onChange={e => setAttested(e.target.checked)}
            />
            <p className="text-sm text-gray-600 leading-relaxed">
              {t('patient.documents.upload.attestation')}
            </p>
          </label>
        </div>

        <div className="px-5 py-3 space-y-2 border-t border-gray-50 flex-shrink-0">
          <button
            className="btn-primary w-full py-3 flex items-center justify-center gap-2 text-sm"
            onClick={handleUpload}
            disabled={uploading || !selectedTypeId || !file || !attested || (isIdDocument && !idType)}>
            <MdUpload size={16} />
            {uploading ? t('patient.documents.upload.uploading') : t('patient.documents.upload.uploadBtn')}
          </button>
          <button className="btn-secondary w-full py-2.5 text-sm" onClick={onClose}>
            {t('patient.documents.upload.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function Documents() {
  const { t }                             = useTranslation()
  const { user }                          = useAuth()
  const [docs, setDocs]                   = useState([])
  const [docTypes, setDocTypes]           = useState([])
  const [activeTab, setActiveTab]         = useState('all')
  const [loadingDocs, setLoadingDocs]     = useState(true)
  const [showUploadModal,  setShowUploadModal]  = useState(false)
  const [confirmDeleteId,  setConfirmDeleteId]  = useState(null)
  // Currently-previewing document — null when no viewer is open.
  // Reuses the same DocViewerModal the agency side uses.
  const [viewingDoc,       setViewingDoc]       = useState(null)

  // Load patient's documents
  useEffect(() => {
    if (!user) return
    const q = query(collection(db, 'documents'), where('patientId', '==', user.uid))
    const unsub = onSnapshot(q, (snap) => {
      const sorted = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
      setDocs(sorted)
      setLoadingDocs(false)
    })
    return unsub
  }, [user])

  // Load document types for upload modal — sort client-side so documents
  // without an order field are never silently excluded by Firestore orderBy
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'documentTypes'),
      snap => {
        const types = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setDocTypes(types.sort((a, b) => (a.order ?? 999) - (b.order ?? 999)))
      }
    )
    return unsub
  }, [])

  const handleDelete = async (id) => {
    try {
      // #8 — Block deletion if the document is currently attached to a
      // non-terminal application. Without this, the patient can delete a
      // doc that the agency is mid-review of, leaving the DocViewerModal
      // fetch with a missing reference and stalling review.
      const appsSnap = await getDocs(query(
        collection(db, 'applications'),
        where('patientId', '==', user.uid),
      ))
      const blockingApp = appsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .find(a =>
          !['rejected', 'certificate'].includes(a.status) &&
          (a.attachedDocuments ?? []).some(d => d.documentId === id)
        )
      if (blockingApp) {
        toast.error(t('patient.documents.delete.inUseError', { appId: blockingApp.appId }))
        setConfirmDeleteId(null)
        return
      }

      // Delete both metadata and content to fully remove the document
      await Promise.all([
        deleteDoc(doc(db, 'documents', id)),
        deleteDoc(doc(db, 'documentContents', id)).catch(() => {}), // content may not exist for legacy docs
      ])
      toast.success(t('patient.documents.delete.success'))
    } catch {
      toast.error(t('patient.documents.delete.failed'))
    } finally {
      setConfirmDeleteId(null)
    }
  }

  const verified = docs.filter(d => d.status === 'verified')
  const pending  = docs.filter(d => d.status === 'pending')
  const displayed = activeTab === 'all' ? docs : docs.filter(d => d.status === activeTab)

  return (
    <Layout breadcrumb={t('patient.documents.title')}>
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">

        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="page-title">{t('patient.documents.title')}</h1>
            <p className="page-sub">{t('patient.documents.subtitle')}</p>
          </div>
          <button className="btn-primary flex items-center gap-1.5"
            onClick={() => setShowUploadModal(true)}>
            <MdUpload size={16} /> {t('patient.documents.uploadBtn')}
          </button>
        </div>

        {/* Info banner */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5">
          <div className="flex items-start gap-2">
            <MdInfo size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-700">
              <strong>{t('patient.documents.howItWorksTitle')}</strong> {t('patient.documents.howItWorksBody')}
            </div>
          </div>
        </div>

        {/* Summary — stats come first on mobile (state-at-a-glance);
            verified-tags detail card stacks beneath. On lg+ the layout
            collapses to a single row with the tag list dominant. */}
        <div className="lg:hidden grid grid-cols-2 gap-3 mb-3">
          <div className="card p-3 text-center">
            <p className="text-2xl font-semibold text-green-600">{verified.length}</p>
            <p className="text-sm text-gray-500 mt-0.5">{t('patient.documents.summary.verifiedStat')}</p>
          </div>
          <div className="card p-3 text-center">
            <p className="text-2xl font-semibold text-amber-500">{pending.length}</p>
            <p className="text-sm text-gray-500 mt-0.5">{t('patient.documents.summary.pendingStat')}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
          <div className="card p-4 lg:col-span-2">
            <div className="flex items-center gap-2 mb-2">
              <MdCheckCircle size={16} className="text-green-500" />
              <span className="text-sm font-medium text-gray-700">{t('patient.documents.summary.verifiedHeading', { count: verified.length })}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {verified.map(d => (
                <span key={d.id} className="badge badge-green text-xs flex items-center gap-1">
                  <MdCheckCircle size={11} /> {d.name}
                </span>
              ))}
              {verified.length === 0 && <span className="text-xs text-gray-400">{t('patient.documents.summary.noVerifiedYet')}</span>}
            </div>
          </div>
          <div className="hidden lg:grid grid-cols-2 gap-3">
            <div className="card p-3 text-center">
              <p className="text-2xl font-semibold text-green-600">{verified.length}</p>
              <p className="text-sm text-gray-500 mt-0.5">{t('patient.documents.summary.verifiedStat')}</p>
            </div>
            <div className="card p-3 text-center">
              <p className="text-2xl font-semibold text-amber-500">{pending.length}</p>
              <p className="text-sm text-gray-500 mt-0.5">{t('patient.documents.summary.pendingStat')}</p>
            </div>
          </div>
        </div>

        {/* Document list */}
        <div className="card overflow-hidden">
          {/* Header + filter chips — stacked vertically on mobile to avoid
              awkward wrapping. The chips horizontally scroll on small screens
              if they overflow. */}
          <div className="px-4 py-3 border-b border-gray-50 flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="font-medium text-sm text-gray-700">
              {activeTab === 'all'
                ? t('patient.documents.tabs.allHeading', { count: docs.length })
                : t(`patient.documents.tabs.${activeTab}Heading`, { count: displayed.length })}
            </span>
            <div className="flex gap-1.5 sm:ml-auto overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
              {['all', 'verified', 'pending', 'rejected'].map(key => (
                <button key={key} onClick={() => setActiveTab(key)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    activeTab === key
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                  }`}>
                  {t(`patient.documents.tabs.${key}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-gray-50">
            {loadingDocs && (
              <>
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
                    <div className="w-8 h-8 bg-gray-100 rounded-lg flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-gray-100 rounded w-40" />
                      <div className="h-2.5 bg-gray-100 rounded w-56" />
                    </div>
                    <div className="h-5 bg-gray-100 rounded-full w-20 flex-shrink-0" />
                  </div>
                ))}
              </>
            )}
            {!loadingDocs && displayed.map(item => {
              const vis  = STATUS_VISUAL[item.status] ?? STATUS_VISUAL.pending
              const Icon = vis.icon
              return (
                <div key={item.id} className="hover:bg-gray-50 cursor-pointer"
                     onClick={() => setViewingDoc(item)}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <MdDescription size={16} className="text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{item.name}</p>
                    <p className="text-sm text-gray-400">
                      {item.fileName && `${item.fileName} · `}
                      {item.size} · {item.date}
                    </p>
                  </div>
                  <span className={`badge ${vis.badge} flex items-center gap-1 flex-shrink-0`}>
                    <Icon size={11} className={vis.iconColor} />
                    {t(`patient.documents.docStatus.${item.status}`, { defaultValue: item.status })}
                  </span>
                  {confirmDeleteId === item.id ? (
                    <div className="flex flex-col gap-2 flex-shrink-0 items-end" onClick={e => e.stopPropagation()}>
                      {item.status === 'verified' && (
                        <p className="text-xs text-red-500 text-right max-w-[180px]">
                          {t('patient.documents.delete.warningVerified')}
                        </p>
                      )}
                      {/* Mobile: stack 'Remove?' above the Yes/No buttons so
                          all three elements fit comfortably on a 360 px screen
                          without competing with the doc info on the same row. */}
                      <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
                        <span className="text-sm text-gray-600">{t('patient.documents.delete.prompt')}</span>
                        <div className="flex items-center gap-2">
                          <button
                            className="min-h-[44px] min-w-[44px] text-sm px-3 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors font-medium"
                            onClick={(e) => { e.stopPropagation(); handleDelete(item.id) }}>
                            {t('patient.documents.delete.yes')}
                          </button>
                          <button
                            className="min-h-[44px] min-w-[44px] text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors font-medium"
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null) }}>
                            {t('patient.documents.delete.no')}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="flex-shrink-0 w-11 h-11 flex items-center justify-center text-gray-300 hover:text-red-400 hover:bg-red-50 rounded-lg transition-colors -mr-2"
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(item.id) }}>
                      <MdDelete size={18} />
                    </button>
                  )}
                </div>
                {item.status === 'rejected' && item.rejectionReason && (
                  <div className="px-4 pb-3 flex items-start gap-1.5">
                    <MdCancel size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-600">
                      <strong>{t('patient.documents.rejection.label')}</strong> {item.rejectionReason} {t('patient.documents.rejection.suffix')}
                    </p>
                  </div>
                )}
                </div>
              )
            })}
            {!loadingDocs && docs.length === 0 && (
              <div className="py-12 text-center text-sm text-gray-400">
                {t('patient.documents.list.noneYet')}
              </div>
            )}
            {!loadingDocs && docs.length > 0 && displayed.length === 0 && (
              <div className="py-12 text-center text-sm text-gray-400">
                {t(`patient.documents.list.none${activeTab.charAt(0).toUpperCase()}${activeTab.slice(1)}`, { defaultValue: t('patient.documents.list.noneAll') })}
              </div>
            )}
          </div>
        </div>

        {/* Upload modal */}
        {showUploadModal && (
          <UploadModal
            docTypes={docTypes}
            existingDocs={docs}
            user={user}
            onClose={() => setShowUploadModal(false)}
          />
        )}

        {/* Document viewer — opened when a patient taps a document row */}
        {viewingDoc && (
          <DocViewerModal
            docMeta={viewingDoc}
            onClose={() => setViewingDoc(null)}
          />
        )}
      </div>
    </Layout>
  )
}
