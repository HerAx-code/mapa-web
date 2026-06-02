import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import {
  collection, query, where, onSnapshot, getDocs,
  doc, setDoc, updateDoc, writeBatch, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import {
  generateRequestId, computeFunding,
} from '../../utils/requests'
import { uploadPatientDocument, replacePatientDocument, validateDocFile } from '../../utils/uploadDocument'
import { runIdOcr, isIdType } from '../../utils/idOcr'
import { isPatientIntakeComplete } from '../../utils/intakeSheet'
import SelfieCaptureModal from '../../components/SelfieCaptureModal'
import StatusBadge from '../../components/ui/StatusBadge'
import ConfirmModal from '../../components/ConfirmModal'
import { useTranslation } from 'react-i18next'
import {
  MdFavorite, MdCheckCircle, MdWarning, MdDescription,
  MdHourglassTop, MdUploadFile, MdClose, MdCameraAlt, MdAssignment, MdChevronRight,
  MdContentCopy,
} from 'react-icons/md'
import toast from 'react-hot-toast'

const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`
const isSelfieType = (name) => /selfie|live photo/i.test(name || '')

// Active = anything not in a terminal state. A patient works one bill toward
// zero balance at a time, so an active request blocks a new submission.
const ACTIVE = (s) => !['closed', 'rejected', 'fully_funded'].includes(s)

export default function RequestAssistance() {
  const { t }      = useTranslation()
  const { user }   = useAuth()
  const navigate   = useNavigate()

  const [types,         setTypes]         = useState([])
  const [reqDocTypes,   setReqDocTypes]   = useState([])
  const [activeRequest, setActiveRequest] = useState(null)
  const [slices,        setSlices]        = useState([])
  const [myDocs,        setMyDocs]        = useState([])
  const [agencyMap,     setAgencyMap]     = useState({})
  const [pendingFiles,  setPendingFiles]  = useState({})
  const [ocrResults,    setOcrResults]    = useState({})
  const [ocrRunning,    setOcrRunning]    = useState({})
  const [selfieFor,     setSelfieFor]     = useState(null)
  const [replacing,     setReplacing]     = useState(null)
  const [proceeding,    setProceeding]    = useState(false)
  const [loading,       setLoading]       = useState(true)
  const [submitting,    setSubmitting]    = useState(false)
  const [submittedId,   setSubmittedId]   = useState('')
  // Patient-initiated withdraw of an active request. CLAUDE.md is explicit:
  // "Patient can withdraw before endorsement" -- so the action is only
  // exposed while status is in the pre-endorsement window. Once CRMC has
  // endorsed (slices exist), the agencies have committed time to review
  // and we don't want the patient to silently pull the rug.
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const [withdrawing,     setWithdrawing]     = useState(false)

  const [form, setForm] = useState({
    assistanceType: '', amountNeeded: '', description: '',
  })
  const [declared, setDeclared] = useState(false)
  const set = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.value }))

  // Representative (filed-by) path — a relative filing on the patient's behalf
  // supplies their own ID + selfie + relationship. Their files reuse the
  // pendingFiles map under sentinel keys.
  const REP_ID = '__rep_id__', REP_SELFIE = '__rep_selfie__'
  const [filedByRep,  setFiledByRep]  = useState(false)
  const [repForm,     setRepForm]     = useState({ name: '', relationship: '' })
  const [repAuthorized, setRepAuthorized] = useState(false)
  const setRep = (f) => (e) => setRepForm(p => ({ ...p, [f]: e.target.value }))
  const [step, setStep] = useState(0)   // submission wizard step

  // Per-attachment OCR tokens. Each attach (or remove) bumps the token for
  // that typeName; when the OCR promise resolves we check that the token
  // still matches before writing the result. This prevents a slow OCR that
  // started before the patient removed or re-attached from leaving a stale
  // result behind. Without this, the UI mostly hid the bug (the doc row
  // wouldn't render OCR text unless `pending` was also set), but if the
  // patient re-attached before the old promise resolved, the new file's
  // fresh OCR result could be overwritten by the older promise.
  const ocrTokens = useRef({})

  // Shared OCR launcher used by both the initial file attach and the retry
  // button. Skips non-ID document types. For rep ID, the OCR cross-checks
  // against repForm.name (the rep's own name); for everything else, against
  // the patient's account name. Per-attach token guards against stale
  // promises from a removed or re-attached file overwriting fresh results.
  const startOcr = (typeName, file) => {
    const isRepId = typeName === REP_ID
    if (!isIdType(typeName) && !isRepId) return
    const token = (ocrTokens.current[typeName] ?? 0) + 1
    ocrTokens.current[typeName] = token
    setOcrResults(p => { const n = { ...p }; delete n[typeName]; return n })
    setOcrRunning(p => ({ ...p, [typeName]: true }))
    const expectedName = isRepId ? repForm.name : (user?.name ?? '')
    runIdOcr(file, expectedName)
      .then(res => {
        if (ocrTokens.current[typeName] !== token) return // stale: dropped
        setOcrResults(p => ({ ...p, [typeName]: res }))
      })
      .finally(() => {
        if (ocrTokens.current[typeName] === token) {
          setOcrRunning(p => ({ ...p, [typeName]: false }))
        }
      })
  }

  const attachReq = (typeName) => (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const err = validateDocFile(file)
    if (err) { toast.error(err); return }
    setPendingFiles(p => ({ ...p, [typeName]: file }))
    // ID documents (including the rep-ID sentinel) get an advisory
    // on-device OCR name-check. Never blocks the submission.
    startOcr(typeName, file)
  }

  // Re-runs OCR on the already-attached file. Surfaced via a "Try again"
  // button next to the OCR advisory when the previous attempt failed
  // outright (network blip during the language pack download, tesseract
  // wasm load error, etc.). Without this the patient had to detach +
  // reattach to retry, which is heavy for a transient error.
  const retryOcr = (typeName) => {
    const file = pendingFiles[typeName]
    if (file) startOcr(typeName, file)
  }

  const removeReq = (typeName) => {
    // Bump the token so any in-flight OCR for this slot is dropped on resolve.
    ocrTokens.current[typeName] = (ocrTokens.current[typeName] ?? 0) + 1
    setPendingFiles(p => { const n = { ...p }; delete n[typeName]; return n })
    setOcrResults(p => { const n = { ...p }; delete n[typeName]; return n })
    setOcrRunning(p => { const n = { ...p }; delete n[typeName]; return n })
  }

  // Proceed gate: the patient accepts the coverage plan, advancing every
  // endorsed slice into its agency's review queue and notifying the agencies.
  // Slice transitions go through a single writeBatch so the patient never
  // ends up in a half-accepted state (some slices 'reviewing', others still
  // 'endorsed') if one update fails mid-batch.
  const handleProceed = async () => {
    const toProceed = slices.filter(s => s.status === 'endorsed')
    if (proceeding || toProceed.length === 0) return
    setProceeding(true)
    try {
      const batch = writeBatch(db)
      for (const s of toProceed) {
        batch.update(doc(db, 'applications', s.id), {
          status:    'reviewing',
          updatedAt: serverTimestamp(),
        })
      }
      await batch.commit()
      toast.success(t('patient.request.proceedOk'))

      // Notify agency coordinators that a new endorsed slice landed in their
      // inbox. Awaited (with allSettled) so transient failures are logged
      // but never block the patient's success path — the slices themselves
      // already committed.
      const notifyResults = await Promise.allSettled(toProceed.map(s =>
        getDocs(query(collection(db, 'users'),
          where('agencyId', '==', s.agencyId),
          where('role', 'in', ['agency', 'agency_admin'])
        )).then(snap => Promise.all(snap.docs.map(d => notify(d.id, {
          type:  'app_submitted',
          title: 'New endorsed request',
          body:  `${user.name} accepted the endorsement and submitted their request. Please review.`,
        }))))
      ))
      const failed = notifyResults.filter(r => r.status === 'rejected')
      if (failed.length > 0) {
        console.error('[handleProceed] agency notify failures:',
          failed.map(f => f.reason))
      }
    } catch (err) {
      console.error('[handleProceed] batch commit failed:', err)
      toast.error(t('patient.request.proceedErr'))
    } finally {
      setProceeding(false)
    }
  }

  // Patient-initiated request withdrawal. Only callable while status is
  // pre-endorsement -- the button isn't even rendered otherwise. Marks the
  // request as 'closed' with closeReason so CRMC's logs still show what
  // happened. The patient is then free to submit a new one.
  const handleWithdraw = async () => {
    if (!activeRequest || withdrawing) return
    setWithdrawing(true)
    try {
      await updateDoc(doc(db, 'requests', activeRequest.id), {
        status:      'closed',
        closeReason: 'Withdrawn by applicant.',
        updatedAt:   serverTimestamp(),
      })
      // Notify CRMC so the request disappears from their action queue and
      // doesn't sit there as a stale "Needs action" row.
      getDocs(query(collection(db, 'users'), where('role', 'in', ['super_admin', 'staff_admin'])))
        .then(snap => Promise.all(snap.docs.map(d => notify(d.id, {
          type:  'app_withdrawn',
          title: 'Request withdrawn',
          body:  `${user.name} withdrew their ${activeRequest.assistanceType} request (${activeRequest.requestId}).`,
        }))))
        .catch(err => console.error('[withdraw] admin notify failed:', err))
      toast.success(t('patient.track.withdrawSuccess'))
      setConfirmWithdraw(false)
    } catch (err) {
      console.error('[withdraw] update failed:', err)
      toast.error(t('patient.track.withdrawFailed'))
    } finally {
      setWithdrawing(false)
    }
  }

  // Immediate upload of an agency-required document during compliance (active
  // request). Goes straight to the documents collection for the agency to
  // review — the live myDocs subscription reflects it.
  const uploadReqDoc = (typeName) => async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const err = validateDocFile(file)
    if (err) { toast.error(err); return }
    try {
      await uploadPatientDocument({ file, typeName, user })
      toast.success(t('patient.request.reuploadOk'))
    } catch {
      toast.error(t('patient.request.reuploadErr'))
    }
  }

  // Re-upload a rejected document in place (keeps the same id so every slice
  // referencing it picks up the new file + reset status).
  const reuploadDoc = (docId) => async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const err = validateDocFile(file)
    if (err) { toast.error(err); return }
    setReplacing(docId)
    try {
      await replacePatientDocument({ docId, file, user })
      toast.success(t('patient.request.reuploadOk'))
    } catch {
      toast.error(t('patient.request.reuploadErr'))
    } finally {
      setReplacing(null)
    }
  }

  // Assistance types (names only).
  useEffect(() => {
    getDocs(query(collection(db, 'assistanceTypes')))
      .then(snap => setTypes(snap.docs.map(d => d.data().name).filter(Boolean).sort()))
      .catch(() => {})
  }, [])

  // The standard required-documents checklist — the same for every request
  // (a `required` flag on document types, not per-assistance-type). Sorted by
  // the admin-defined order. Reusable types carry over once verified.
  useEffect(() => {
    getDocs(query(collection(db, 'documentTypes'), where('required', '==', true)))
      .then(snap => setReqDocTypes(
        snap.docs
          .map(d => ({ id: d.id, name: d.data().name, reusable: !!d.data().reusable, order: d.data().order ?? 0 }))
          .filter(t => t.name)
          .sort((a, b) => a.order - b.order)
      ))
      .catch(() => {})
  }, [])

  // Active-request guard + billing-statement presence check
  useEffect(() => {
    if (!user?.uid) return
    const unsub = onSnapshot(
      query(collection(db, 'requests'), where('patientId', '==', user.uid)),
      snap => {
        const active = snap.docs.map(d => ({ id: d.id, ...d.data() })).find(r => ACTIVE(r.status))
        setActiveRequest(active ?? null)
        setLoading(false)
      },
      (err) => {
        console.error('[RequestAssistance] requests snapshot error:', err)
        setLoading(false)
      },
    )
    return unsub
  }, [user?.uid])

  // Live slices (agency applications) of the active request — drives the
  // real funding figures + the per-agency breakdown.
  //
  // The patientId where-clause is required even though requestId already
  // narrows the result set: Firestore rules only allow a query if every
  // returned doc is reachable via the rule's allowed-read clauses. The
  // applications rule allows `resource.data.patientId == uid()`, so the
  // query must include that constraint up front -- otherwise the rule
  // engine rejects the query at parse time and we get "Missing or
  // insufficient permissions" (caught live via Playwright on the patient
  // surface). The duplicate filter is redundant data-wise but mandatory
  // for the rules check.
  useEffect(() => {
    if (!activeRequest?.id || !user?.uid) { setSlices([]); return }
    const unsub = onSnapshot(
      query(
        collection(db, 'applications'),
        where('requestId', '==', activeRequest.id),
        where('patientId', '==', user.uid),
      ),
      snap => setSlices(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => console.error('[RequestAssistance] slices snapshot error:', err),
    )
    return unsub
  }, [activeRequest?.id, user?.uid])

  // Live list of the patient's documents — powers the "already uploaded"
  // markers on the form and the document status + re-upload list on the
  // active-request view.
  useEffect(() => {
    if (!user?.uid) return
    const unsub = onSnapshot(
      query(collection(db, 'documents'), where('patientId', '==', user.uid)),
      snap => setMyDocs(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => console.error('[RequestAssistance] documents snapshot error:', err),
    )
    return unsub
  }, [user?.uid])

  // Agency details (requirements / procedure / description) for the coverage
  // plan. Agencies are publicly readable, so a one-shot fetch is enough.
  useEffect(() => {
    getDocs(collection(db, 'agencies'))
      .then(snap => {
        const m = {}
        snap.docs.forEach(d => { m[d.id] = d.data() })
        setAgencyMap(m)
      })
      .catch(() => {})
  }, [])

  const existingTypeNames = new Set(myDocs.map(d => (d.documentTypeName ?? d.name ?? '').toLowerCase()))
  // Verified docs on file, by type name — reusable types satisfy the checklist
  // without re-upload; non-reusable ones (Billing/SOA) must be supplied fresh.
  const verifiedTypeNames = new Set(
    myDocs.filter(d => d.status === 'verified').map(d => (d.documentTypeName ?? d.name ?? '').toLowerCase())
  )
  const docForType = (name) => myDocs.find(d => (d.documentTypeName ?? d.name ?? '').toLowerCase() === name.toLowerCase())
  const isSatisfied = (tp) =>
    !!pendingFiles[tp.name] || (tp.reusable && verifiedTypeNames.has(tp.name.toLowerCase()))
  const missingDocs = reqDocTypes.filter(tp => !isSatisfied(tp))

  const amountNeeded = Number(form.amountNeeded) || 0

  const handleSubmit = async () => {
    if (submitting) return
    if (activeRequest)            { toast.error(t('patient.request.errActive')); return }
    if (!form.assistanceType)     { toast.error(t('patient.request.errType')); return }
    if (amountNeeded <= 0)        { toast.error(t('patient.request.errNeeded')); return }
    if (missingDocs.length)       { toast.error(t('patient.request.errDocs')); return }
    if (filedByRep && (!repForm.name.trim() || !repForm.relationship.trim() || !pendingFiles[REP_ID] || !pendingFiles[REP_SELFIE] || !repAuthorized)) {
      toast.error(t('patient.request.errRep')); return
    }
    if (!declared)                { toast.error(t('patient.request.errDeclare')); return }

    setSubmitting(true)
    try {
      // Upload each attached required document before snapshotting. Replace a
      // same-type doc in place so we never create duplicates on retry --
      // when this loop fails partway, the patient's `myDocs` snapshot
      // already includes whatever uploaded successfully, so the next
      // attempt routes those through replacePatientDocument instead of
      // creating fresh duplicates. R26: per-doc try/catch so a failure
      // tells the patient WHICH document broke ("Failed to upload your
      // Medical Certificate") instead of a generic "submission failed."
      for (const tp of reqDocTypes) {
        const file = pendingFiles[tp.name]
        if (!file) continue
        const existing = docForType(tp.name)
        const ocr      = ocrResults[tp.name] ?? null
        try {
          if (existing) await replacePatientDocument({ docId: existing.id, file, ocr, user })
          else          await uploadPatientDocument({ file, typeName: tp.name, typeId: tp.id, ocr, user })
        } catch (uploadErr) {
          console.error('[request] doc upload failed:', tp.name, uploadErr)
          throw new Error(`UPLOAD_FAILED:${tp.name}`)
        }
      }

      // Representative identity documents (when filing on the patient's behalf).
      let filedBy = null
      if (filedByRep) {
        // Persist the rep-ID OCR result so the CRMC verifier sees the same
        // advisory line they get on the patient's own ID. The OCR ran at
        // attach time against repForm.name (see attachReq).
        const repIdOcr     = ocrResults[REP_ID] ?? null
        const repIdRef     = await uploadPatientDocument({ file: pendingFiles[REP_ID], typeName: 'Representative ID', ocr: repIdOcr, user })
        const repSelfieRef = await uploadPatientDocument({ file: pendingFiles[REP_SELFIE], typeName: 'Representative Selfie', user })
        filedBy = {
          name:          repForm.name.trim(),
          relationship:  repForm.relationship.trim(),
          authorized:    true,
          repIdDocId:    repIdRef.documentId,
          repSelfieDocId: repSelfieRef.documentId,
        }
      }

      const docsSnap = await getDocs(query(collection(db, 'documents'), where('patientId', '==', user.uid)))
      const attachedDocuments = docsSnap.docs.map(d => ({
        documentId:       d.id,
        name:             d.data().name ?? '',
        documentTypeName: d.data().documentTypeName ?? '',
        status:           d.data().status ?? 'pending',
        date:             d.data().date ?? '',
      }))

      const requestId = generateRequestId()
      const reqRef    = doc(collection(db, 'requests'))
      await setDoc(reqRef, {
        requestId,
        patientId:         user.uid,
        patientName:       user.name ?? '',
        patientContact:    user.contact ?? '',
        patientAddress:    user.address ?? '',
        patientHospitalId: user.hospitalId ?? null,
        assistanceType:    form.assistanceType,
        description:       form.description.trim(),
        amountNeeded,
        amountCommitted:   0,
        agencyIds:         [],
        status:            'submitted',
        attachedDocuments,
        filedBy,
        submittedAt:       serverTimestamp(),
        updatedAt:         serverTimestamp(),
      })

      setSubmittedId(requestId)

      // Notify CRMC admins so they can pick up the request. The patient
      // self-notification was dropped — they're literally on the success
      // page already, the in-app toast it triggered was redundant chrome
      // (and showed the same Request ID the success screen now displays
      // in a more compact form).
      getDocs(query(collection(db, 'users'), where('role', 'in', ['super_admin', 'staff_admin'])))
        .then(snap => Promise.all(snap.docs.map(d => notify(d.id, {
          type:  'app_submitted',
          title: 'New assistance request',
          body:  `${user.name} submitted a ${form.assistanceType} request for ${peso(amountNeeded)} (net). ID: ${requestId}.`,
        }))))
        .catch(err => console.error('[request] admin notify failed:', err))
    } catch (err) {
      console.error('[request] submit failed:', err?.code, err?.message, err)
      // R26: surface WHICH document failed so the patient knows what to
      // retry. Without this, the toast just said "submission failed" and
      // the patient retried the entire flow without knowing the network
      // had dropped only their Medical Certificate upload.
      const m = String(err?.message ?? '')
      if (m.startsWith('UPLOAD_FAILED:')) {
        const docName = m.slice('UPLOAD_FAILED:'.length)
        toast.error(`Could not upload "${docName}". Check your connection and try again.`)
      } else {
        toast.error(t('patient.request.errFailed'))
      }
      setSubmitting(false)
    }
  }

  // ── Success screen ───────────────────────────────────────────────────────
  if (submittedId) {
    return (
      <Layout breadcrumb={t('patient.request.navLabel')}>
        <div className="px-4 py-6 sm:p-6 max-w-xl mx-auto">
          <div className="card p-6 sm:p-8 text-center space-y-5">
            <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto">
              <MdCheckCircle size={36} className="text-green-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-1">{t('patient.request.successTitle')}</h2>
              <p className="text-sm text-gray-500">{t('patient.request.successDesc')}</p>
            </div>
            <button className="btn-primary w-full py-3 text-sm" onClick={() => navigate('/patient/status')}>
              {t('patient.request.viewStatus')} →
            </button>
            {/* Demoted Request ID — single-line w/ copy-to-clipboard. The
                ID is reference-only (the patient is signed in and can see
                everything in My Application), so it doesn't deserve hero
                treatment under the green check. Kept here so they can
                screenshot or quote it if they message CRMC. */}
            <p className="text-xs text-gray-400 flex items-center justify-center gap-1.5 pt-1">
              <span>{t('patient.request.successIdLabel')}:</span>
              <span className="font-mono text-gray-600">{submittedId}</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(submittedId)
                    .then(() => toast.success('Request ID copied'))
                    .catch(err => console.error('[request] clipboard write failed:', err))
                }}
                className="text-brand-500 hover:text-brand-600 p-1 rounded hover:bg-brand-50"
                title="Copy Request ID">
                <MdContentCopy size={13} />
              </button>
            </p>
          </div>
        </div>
      </Layout>
    )
  }

  // ── Active request — block new submission, show its state ─────────────────
  if (!loading && activeRequest) {
    const { committed, balance, pct } = computeFunding(activeRequest.amountNeeded, slices)
    return (
      <Layout breadcrumb={t('patient.request.navLabel')}>
        <div className="px-4 py-6 sm:p-6 max-w-xl mx-auto">
          <div className="card p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-3">
              <MdHourglassTop size={20} className="text-amber-500" />
              <h2 className="text-base font-semibold text-gray-900">{t('patient.request.activeTitle')}</h2>
              <StatusBadge status={activeRequest.status} kind="request" className="ml-auto flex-shrink-0" />
            </div>
            <p className="text-sm text-gray-500 mb-4">{t('patient.request.activeDesc')}</p>

            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <div className="flex justify-between items-center text-sm gap-2">
                <span className="text-gray-400">{t('patient.request.successIdLabel')}</span>
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="font-semibold text-gray-800 truncate">{activeRequest.requestId}</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(activeRequest.requestId)
                        .then(() => toast.success('Request ID copied'))
                        .catch(err => console.error('[request] clipboard write failed:', err))
                    }}
                    className="text-brand-500 hover:text-brand-600 p-1 rounded hover:bg-brand-50 flex-shrink-0"
                    title="Copy Request ID">
                    <MdContentCopy size={13} />
                  </button>
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">{t('patient.request.typeLabel')}</span>
                <span className="font-medium text-gray-700">{activeRequest.assistanceType}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">{t('patient.request.neededLabel')}</span>
                <span className="font-semibold text-gray-800">{peso(activeRequest.amountNeeded)}</span>
              </div>
              <div className="pt-2">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>{peso(committed)} {t('patient.request.secured')}</span>
                  <span>{peso(balance)} {t('patient.request.remaining')}</span>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-green-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>

            {/* Household Information Sheet — the patient fills the factual
                portion (family, income, expenses, medical); CRMC completes the
                assessment. Required before CRMC can endorse. */}
            {(() => {
              const done = isPatientIntakeComplete(activeRequest.intakeSheet)
              return (
                <button
                  className={`mt-4 w-full flex items-center gap-3 p-3 rounded-xl border text-left ${done ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}
                  onClick={() => navigate(`/patient/request/${activeRequest.id}/intake`)}>
                  <MdAssignment size={20} className={done ? 'text-green-600 flex-shrink-0' : 'text-amber-500 flex-shrink-0'} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{t('patient.request.intakeTitle')}</p>
                    <p className="text-xs text-gray-500">{done ? t('patient.request.intakeDone') : t('patient.request.intakeTodo')}</p>
                  </div>
                  <span className={`badge text-xs flex-shrink-0 ${done ? 'badge-green' : 'badge-amber'}`}>
                    {done ? t('patient.request.docUploaded') : t('patient.request.intakeIncomplete')}
                  </span>
                  <MdChevronRight size={18} className="text-gray-300 flex-shrink-0" />
                </button>
              )
            })()}

            {/* Coverage plan — which agencies cover how much, their info,
                procedure, and the requirements the patient must comply with. */}
            {slices.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('patient.request.coveragePlan')}</p>
                <div className="space-y-3">
                  {slices.map(s => {
                    const secured  = ['approved', 'certificate'].includes(s.status)
                    const amt      = Number(secured ? (s.amountApproved || s.amountRequested) : s.amountRequested) || 0
                    const needed   = Number(activeRequest.amountNeeded) || 0
                    const pctBill  = needed > 0 ? Math.round((amt / needed) * 100) : 0
                    const ag       = agencyMap[s.agencyId] ?? {}
                    const reqs     = ag.requirements ?? []
                    return (
                      <div key={s.id} className="rounded-xl border border-gray-100 p-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 ${s.agencyColor ?? 'bg-gray-400'} rounded-lg text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}>
                            {s.agencyInitials}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{s.agencyName}</p>
                            <p className="text-xs text-gray-400">{peso(amt)} · {pctBill}% {t('patient.request.ofYourBill')}</p>
                          </div>
                          <StatusBadge status={s.status} kind="app" className="flex-shrink-0" />
                        </div>

                        {ag.description && <p className="text-xs text-gray-500 mt-2 leading-snug">{ag.description}</p>}

                        {ag.procedure && (
                          <div className="mt-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                            <p className="text-xs font-medium text-blue-700">{t('patient.request.procedure')}</p>
                            <p className="text-xs text-blue-600 whitespace-pre-line">{ag.procedure}</p>
                          </div>
                        )}

                        {reqs.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs font-medium text-gray-500 mb-1">{t('patient.request.agencyRequirements')}</p>
                            <div className="space-y-1">
                              {reqs.map(r => {
                                const ok = existingTypeNames.has(r.toLowerCase())
                                return (
                                  <div key={r} className="flex items-center gap-2 text-xs">
                                    {ok
                                      ? <MdCheckCircle size={13} className="text-green-500 flex-shrink-0" />
                                      : <MdWarning size={13} className="text-amber-400 flex-shrink-0" />}
                                    <span className="flex-1 min-w-0 truncate text-gray-600">{r}</span>
                                    {!ok && (
                                      <label className="text-brand-600 hover:text-brand-700 font-medium cursor-pointer flex items-center gap-0.5 flex-shrink-0">
                                        <MdUploadFile size={12} /> {t('patient.request.docAttach')}
                                        <input type="file" accept="image/*,application/pdf" className="hidden" onChange={uploadReqDoc(r)} />
                                      </label>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Proceed gate — accept the coverage plan and submit to agencies */}
            {slices.some(s => s.status === 'endorsed') && (
              <div className="mt-4 bg-brand-50 border border-brand-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-brand-800 mb-1">{t('patient.request.proceedTitle')}</p>
                <p className="text-xs text-brand-700/80 mb-3">{t('patient.request.proceedDesc')}</p>
                <button className="btn-primary w-full text-sm" onClick={handleProceed} disabled={proceeding}>
                  {proceeding ? t('patient.request.proceeding') : `${t('patient.request.proceedBtn')} →`}
                </button>
              </div>
            )}

            {/* Documents — compact summary; only docs needing re-upload expand. */}
            {myDocs.length > 0 && (() => {
              const rejected = myDocs.filter(d => d.status === 'rejected')
              const verified = myDocs.filter(d => d.status === 'verified').length
              const chip = rejected.length > 0
                ? { cls: 'badge-red',   label: t('patient.request.docsActionNeeded') }
                : verified === myDocs.length
                  ? { cls: 'badge-green', label: t('patient.request.docsVerified') }
                  : { cls: 'badge-amber', label: t('patient.request.docsUnderReview') }
              return (
                <div className="mt-4">
                  <div className="flex items-center gap-2 p-3 rounded-xl border border-gray-100">
                    <MdDescription size={18} className="text-gray-400 flex-shrink-0" />
                    <p className="text-sm text-gray-700 flex-1 min-w-0">{t('patient.request.docsSummary', { count: myDocs.length })}</p>
                    <span className={`badge text-xs flex-shrink-0 ${chip.cls}`}>{chip.label}</span>
                  </div>
                  {rejected.length > 0 && (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-red-600">{t('patient.request.docsNeedFix')}</p>
                      {rejected.map(d => (
                        <div key={d.id} className="flex items-center gap-2 p-2.5 rounded-lg border border-red-100 bg-red-50/50">
                          <MdDescription size={16} className="text-gray-400 flex-shrink-0" />
                          <p className="text-sm text-gray-700 flex-1 min-w-0 truncate">{d.name}</p>
                          <label className="text-xs font-medium text-brand-600 hover:text-brand-700 cursor-pointer flex items-center gap-1 flex-shrink-0">
                            <MdUploadFile size={14} /> {replacing === d.id ? t('patient.request.reuploading') : t('patient.request.reupload')}
                            <input type="file" accept="image/*,application/pdf" className="hidden"
                              disabled={replacing === d.id} onChange={reuploadDoc(d.id)} />
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}

            <button className="btn-primary w-full mt-4 text-sm" onClick={() => navigate('/patient/status')}>
              {t('patient.request.viewStatus')} →
            </button>
            {/* Withdraw is only offered while CRMC hasn't endorsed yet. Once
                slices exist, agencies have started reviewing and the patient
                shouldn't silently bow out -- they should reach out via
                Messages instead. */}
            {['submitted', 'under_review', 'assessment'].includes(activeRequest.status) && slices.length === 0 && (
              <button
                className="w-full min-h-[44px] inline-flex items-center justify-center mt-3 text-sm font-medium text-gray-500 hover:text-red-600"
                onClick={() => setConfirmWithdraw(true)}>
                {t('patient.track.withdraw')}
              </button>
            )}
          </div>
        </div>

        <ConfirmModal
          open={confirmWithdraw}
          onClose={() => !withdrawing && setConfirmWithdraw(false)}
          onConfirm={handleWithdraw}
          title={t('patient.track.withdraw')}
          body={t('patient.track.withdrawConfirm')}
          tone="danger"
          confirmLabel={t('patient.track.withdrawYes')}
          confirmLabelBusy={t('patient.track.withdrawing')}
        />
      </Layout>
    )
  }

  // ── Request form — guided wizard ───────────────────────────────────────────
  const STEP_LABELS = [
    t('patient.request.stepNeed'), t('patient.request.stepDocs'),
    t('patient.request.stepRep'), t('patient.request.stepReview'),
  ]
  const lastStep = STEP_LABELS.length - 1
  const handleNext = () => {
    if (step === 0) {
      if (!form.assistanceType) { toast.error(t('patient.request.errType')); return }
      if (amountNeeded <= 0)    { toast.error(t('patient.request.errNeeded')); return }
    }
    if (step === 1 && missingDocs.length) { toast.error(t('patient.request.errDocs')); return }
    if (step === 2 && filedByRep && (!repForm.name.trim() || !repForm.relationship.trim() || !pendingFiles[REP_ID] || !pendingFiles[REP_SELFIE] || !repAuthorized)) {
      toast.error(t('patient.request.errRep')); return
    }
    setStep(s => Math.min(s + 1, lastStep))
  }

  return (
    <Layout breadcrumb={t('patient.request.navLabel')}>
      <div className="px-4 py-5 sm:p-6 max-w-xl mx-auto">
        <div className="mb-3">
          <h1 className="page-title flex items-center gap-2"><MdFavorite className="text-brand-500" size={22} /> {t('patient.request.title')}</h1>
          <p className="page-sub">{t('patient.request.subtitle')}</p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-1.5 mb-1">
          {STEP_LABELS.map((_, i) => (
            <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-brand-500' : 'bg-gray-200'}`} />
          ))}
        </div>
        <p className="text-sm font-semibold text-gray-800 mb-4">{t('patient.request.stepN', { n: step + 1, total: STEP_LABELS.length })} · {STEP_LABELS[step]}</p>

        <div className="card p-5 space-y-4">
          {step === 0 && (<>
          {/* Assistance type */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{t('patient.request.typeLabel')} <span className="text-red-400">*</span></label>
            <select className={`input ${!form.assistanceType ? 'text-gray-400' : ''}`} value={form.assistanceType} onChange={set('assistanceType')}>
              <option value="">{t('patient.request.typePlaceholder')}</option>
              {types.map(tp => <option key={tp} value={tp}>{tp}</option>)}
            </select>
          </div>

          {/* Amount needed — what the patient needs help with. CRMC verifies
              it against the uploaded Statement of Account; agencies (not the
              patient) decide how much each one covers. */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{t('patient.request.amountLabel')} <span className="text-red-400">*</span></label>
            <input type="number" min="0" inputMode="numeric" className="input" placeholder="0"
              value={form.amountNeeded} onChange={set('amountNeeded')} />
            <p className="text-xs text-gray-400 mt-1">{t('patient.request.amountHint')}</p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{t('patient.request.descLabel')}</label>
            <textarea className="input resize-none" rows={2} placeholder={t('patient.request.descPlaceholder')}
              value={form.description} onChange={set('description')} maxLength={300} />
          </div>
          </>)}

          {step === 1 && (<>
          {/* Required documents — the standard checklist (same for every
              request). CRMC verifies them; reusable ones (e.g. Valid ID) carry
              over once verified, while per-request ones (Billing/SOA) are
              re-submitted each time. */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('patient.request.documentsTitle')}</p>
            <p className="text-xs text-gray-400 mb-2">{t('patient.request.documentsHint')}</p>
            {reqDocTypes.length === 0 ? (
              <p className="text-xs text-gray-400 italic">{t('patient.request.documentsNone')}</p>
            ) : (
              <div className="space-y-2">
                {reqDocTypes.map(tp => {
                  const pending  = pendingFiles[tp.name]
                  const onFile   = tp.reusable && verifiedTypeNames.has(tp.name.toLowerCase())
                  const ocr      = ocrResults[tp.name]
                  const ocrBusy  = ocrRunning[tp.name]
                  return (
                    <div key={tp.id} className="p-3 rounded-lg border border-gray-100">
                      <div className="flex items-start gap-2">
                        <MdDescription size={16} className="text-gray-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-700">{tp.name} <span className="text-red-400">*</span></p>
                          {pending
                            ? <p className="text-xs text-green-600 break-all">{pending.name}</p>
                            : onFile && <p className="text-xs text-green-600">{t('patient.request.billingOnFile')}</p>}
                        </div>
                        {pending && (
                          <button type="button" className="text-gray-400 hover:text-red-500 flex-shrink-0 p-1" onClick={() => removeReq(tp.name)}>
                            <MdClose size={18} />
                          </button>
                        )}
                      </div>
                      {/* Full-width action — never clips on narrow screens. */}
                      {!pending && (
                        isSelfieType(tp.name) ? (
                          <button type="button" onClick={() => setSelfieFor(tp.name)}
                            className="mt-2 w-full py-2.5 rounded-lg border border-brand-200 text-brand-600 text-sm font-medium flex items-center justify-center gap-1.5">
                            <MdCameraAlt size={16} /> {t('patient.request.takeSelfie')}
                          </button>
                        ) : (
                          <label className="mt-2 w-full py-2.5 rounded-lg border border-brand-200 text-brand-600 text-sm font-medium flex items-center justify-center gap-1.5 cursor-pointer">
                            <MdUploadFile size={16} /> {onFile ? t('patient.request.replace') : t('patient.request.docAttach')}
                            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={attachReq(tp.name)} />
                          </label>
                        )
                      )}
                      {/* Advisory on-device ID name-check — never blocks submit. */}
                      {isIdType(tp.name) && pending && (ocrBusy || ocr) && (
                        <div className="flex items-baseline gap-2 mt-1.5 flex-wrap">
                          <p className={`text-xs ${
                            ocrBusy ? 'text-gray-400'
                            : ocr?.match === true ? 'text-green-600'
                            : 'text-amber-600' /* no-match AND unreadable both warn -- patient should look */
                          }`}>
                            {ocrBusy
                              ? t('patient.request.ocrChecking')
                              : ocr?.match === true
                                ? t('patient.request.ocrMatch')
                                : ocr?.match === false
                                  ? t('patient.request.ocrNoMatch')
                                  : t('patient.request.ocrUnreadable')}
                          </p>
                          {/* Hard-failure retry: OCR errored (no text + null match).
                              Skips retry if text was read but name didn't match --
                              same file would just produce the same result. */}
                          {!ocrBusy && ocr && ocr.match == null && !ocr.text && (
                            <button type="button" onClick={() => retryOcr(tp.name)}
                              className="text-xs text-brand-500 hover:text-brand-600 font-medium underline underline-offset-2">
                              Try again
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          </>)}

          {step === 2 && (<>
          {/* Filed by a representative */}
          <div className="rounded-lg border border-gray-100 p-3">
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input type="checkbox" className="mt-0.5 w-4 h-4 accent-brand-500 flex-shrink-0"
                checked={filedByRep} onChange={e => setFiledByRep(e.target.checked)} />
              <span className="text-sm text-gray-700 leading-snug">{t('patient.request.repToggle')}
                <span className="block text-xs text-gray-400">{t('patient.request.repToggleHint')}</span>
              </span>
            </label>

            {filedByRep && (
              <div className="mt-3 space-y-2.5 pl-6">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">{t('patient.request.repName')} <span className="text-red-400">*</span></label>
                  <input className="input" value={repForm.name} onChange={setRep('name')} placeholder={t('patient.request.repNamePlaceholder')} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">{t('patient.request.repRelationship')} <span className="text-red-400">*</span></label>
                  <input className="input" value={repForm.relationship} onChange={setRep('relationship')} placeholder={t('patient.request.repRelationshipPlaceholder')} />
                </div>
                {/* Representative ID */}
                <div className="p-3 rounded-lg border border-gray-100">
                  <div className="flex items-start gap-2">
                    <MdDescription size={16} className="text-gray-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700">{t('patient.request.repId')} <span className="text-red-400">*</span></p>
                      {pendingFiles[REP_ID] && <p className="text-xs text-green-600 break-all">{pendingFiles[REP_ID].name}</p>}
                    </div>
                    {pendingFiles[REP_ID] && (
                      <button type="button" className="text-gray-400 hover:text-red-500 flex-shrink-0 p-1" onClick={() => removeReq(REP_ID)}>
                        <MdClose size={18} />
                      </button>
                    )}
                  </div>
                  {!pendingFiles[REP_ID] && (
                    <label className="mt-2 w-full py-2.5 rounded-lg border border-brand-200 text-brand-600 text-sm font-medium flex items-center justify-center gap-1.5 cursor-pointer">
                      <MdUploadFile size={16} /> {t('patient.request.docAttach')}
                      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={attachReq(REP_ID)} />
                    </label>
                  )}
                  {/* Advisory on-device OCR name-check for the rep's ID.
                      Matched against repForm.name at attach time, so if the
                      rep typed their name AFTER attaching, the match may
                      not reflect the typed name -- detaching + reattaching
                      re-runs OCR with the latest name (or tap Try again). */}
                  {pendingFiles[REP_ID] && (ocrRunning[REP_ID] || ocrResults[REP_ID]) && (() => {
                    const ocr = ocrResults[REP_ID]
                    const busy = ocrRunning[REP_ID]
                    return (
                      <div className="flex items-baseline gap-2 mt-1.5 flex-wrap">
                        <p className={`text-xs ${
                          busy ? 'text-gray-400'
                          : ocr?.match === true ? 'text-green-600'
                          : 'text-amber-600'
                        }`}>
                          {busy
                            ? t('patient.request.ocrChecking')
                            : ocr?.match === true
                              ? t('patient.request.ocrMatch')
                              : ocr?.match === false
                                ? t('patient.request.ocrNoMatch')
                                : t('patient.request.ocrUnreadable')}
                        </p>
                        {!busy && ocr && ocr.match == null && !ocr.text && (
                          <button type="button" onClick={() => retryOcr(REP_ID)}
                            className="text-xs text-brand-500 hover:text-brand-600 font-medium underline underline-offset-2">
                            Try again
                          </button>
                        )}
                      </div>
                    )
                  })()}
                </div>
                {/* Representative selfie */}
                <div className="p-3 rounded-lg border border-gray-100">
                  <div className="flex items-start gap-2">
                    <MdCameraAlt size={16} className="text-gray-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700">{t('patient.request.repSelfie')} <span className="text-red-400">*</span></p>
                      {pendingFiles[REP_SELFIE] && <p className="text-xs text-green-600">{t('patient.request.selfieReady')}</p>}
                    </div>
                    {pendingFiles[REP_SELFIE] && (
                      <button type="button" className="text-gray-400 hover:text-red-500 flex-shrink-0 p-1" onClick={() => removeReq(REP_SELFIE)}>
                        <MdClose size={18} />
                      </button>
                    )}
                  </div>
                  {!pendingFiles[REP_SELFIE] && (
                    <button type="button" onClick={() => setSelfieFor(REP_SELFIE)}
                      className="mt-2 w-full py-2.5 rounded-lg border border-brand-200 text-brand-600 text-sm font-medium flex items-center justify-center gap-1.5">
                      <MdCameraAlt size={16} /> {t('patient.request.takeSelfie')}
                    </button>
                  )}
                </div>
                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input type="checkbox" className="mt-0.5 w-4 h-4 accent-brand-500 flex-shrink-0"
                    checked={repAuthorized} onChange={e => setRepAuthorized(e.target.checked)} />
                  <span className="text-xs text-gray-600 leading-snug">{t('patient.request.repAuth')}</span>
                </label>
              </div>
            )}
          </div>
          </>)}

          {step === 3 && (<>
          {/* Review summary */}
          <div className="space-y-2">
            <div className="flex justify-between gap-3 text-sm border-b border-gray-50 pb-2">
              <span className="text-gray-400">{t('patient.request.typeLabel')}</span>
              <span className="font-medium text-gray-800 text-right">{form.assistanceType || '—'}</span>
            </div>
            <div className="flex justify-between gap-3 text-sm border-b border-gray-50 pb-2">
              <span className="text-gray-400">{t('patient.request.amountLabel')}</span>
              <span className="font-medium text-gray-800 text-right">{peso(amountNeeded)}</span>
            </div>
            <div className="flex justify-between gap-3 text-sm border-b border-gray-50 pb-2">
              <span className="text-gray-400">{t('patient.request.documentsTitle')}</span>
              <span className="font-medium text-gray-800 text-right">{reqDocTypes.length - missingDocs.length}/{reqDocTypes.length}</span>
            </div>
            {filedByRep && (
              <div className="flex justify-between gap-3 text-sm border-b border-gray-50 pb-2">
                <span className="text-gray-400">{t('patient.request.repName')}</span>
                <span className="font-medium text-gray-800 text-right">{repForm.name} ({repForm.relationship})</span>
              </div>
            )}
          </div>

          {/* Declaration */}
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input type="checkbox" className="mt-0.5 w-4 h-4 accent-brand-500 flex-shrink-0"
              checked={declared} onChange={e => setDeclared(e.target.checked)} />
            <span className="text-sm text-gray-600 leading-snug">{t('patient.request.declaration')}</span>
          </label>
          </>)}
        </div>

        {/* Wizard nav */}
        <div className="flex items-center gap-3 mt-4">
          {step > 0 && (
            <button className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-700 font-medium text-sm flex items-center justify-center gap-1.5"
              onClick={() => setStep(s => s - 1)}>
              ← {t('patient.request.back')}
            </button>
          )}
          {step < lastStep ? (
            <button className="flex-1 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm"
              onClick={handleNext}>
              {t('patient.request.next')} →
            </button>
          ) : (
            <button className="flex-1 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm disabled:opacity-60"
              onClick={handleSubmit} disabled={submitting || loading}>
              {submitting ? t('patient.request.submitting') : `${t('patient.request.submit')} →`}
            </button>
          )}
        </div>
        <p className="text-xs text-gray-400 text-center mt-2">{t('patient.request.routeNote')}</p>
      </div>

      {selfieFor && (
        <SelfieCaptureModal
          onCapture={(file) => setPendingFiles(p => ({ ...p, [selfieFor]: file }))}
          onClose={() => setSelfieFor(null)}
        />
      )}
    </Layout>
  )
}