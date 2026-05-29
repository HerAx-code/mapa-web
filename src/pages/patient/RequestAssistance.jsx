import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import {
  collection, query, where, onSnapshot, getDocs,
  doc, setDoc, updateDoc, serverTimestamp,
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

const isSelfieType = (name) => /selfie|live photo/i.test(name || '')
import { REQUEST_STATUS_CONFIG, APP_STATUS_CONFIG, DOC_STATUS_CONFIG } from '../../utils/constants'
import { useTranslation } from 'react-i18next'
import {
  MdFavorite, MdCheckCircle, MdWarning, MdDescription,
  MdHourglassTop, MdUploadFile, MdClose, MdCameraAlt, MdAssignment, MdChevronRight,
} from 'react-icons/md'
import toast from 'react-hot-toast'

const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`

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

  const attachReq = (typeName) => (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const err = validateDocFile(file)
    if (err) { toast.error(err); return }
    setPendingFiles(p => ({ ...p, [typeName]: file }))

    // ID documents get an advisory on-device OCR name-check (never blocks).
    if (isIdType(typeName)) {
      setOcrResults(p => { const n = { ...p }; delete n[typeName]; return n })
      setOcrRunning(p => ({ ...p, [typeName]: true }))
      runIdOcr(file, user?.name ?? '')
        .then(res => setOcrResults(p => ({ ...p, [typeName]: res })))
        .finally(() => setOcrRunning(p => ({ ...p, [typeName]: false })))
    }
  }

  const removeReq = (typeName) => {
    setPendingFiles(p => { const n = { ...p }; delete n[typeName]; return n })
    setOcrResults(p => { const n = { ...p }; delete n[typeName]; return n })
    setOcrRunning(p => { const n = { ...p }; delete n[typeName]; return n })
  }

  // Proceed gate: the patient accepts the coverage plan, advancing every
  // endorsed slice into its agency's review queue and notifying the agencies.
  const handleProceed = async () => {
    const toProceed = slices.filter(s => s.status === 'endorsed')
    if (proceeding || toProceed.length === 0) return
    setProceeding(true)
    try {
      await Promise.all(toProceed.map(s =>
        updateDoc(doc(db, 'applications', s.id), { status: 'reviewing', updatedAt: serverTimestamp() })
      ))
      Promise.all(toProceed.map(s =>
        getDocs(query(collection(db, 'users'), where('agencyId', '==', s.agencyId), where('role', 'in', ['agency', 'agency_admin'])))
          .then(snap => Promise.all(snap.docs.map(d => notify(d.id, {
            type:  'app_submitted',
            title: 'New endorsed request',
            body:  `${user.name} accepted the endorsement and submitted their request. Please review.`,
          }))))
      )).catch(() => {})
      toast.success(t('patient.request.proceedOk'))
    } catch {
      toast.error(t('patient.request.proceedErr'))
    } finally {
      setProceeding(false)
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
      () => setLoading(false),
    )
    return unsub
  }, [user?.uid])

  // Live slices (agency applications) of the active request — drives the
  // real funding figures + the per-agency breakdown.
  useEffect(() => {
    if (!activeRequest?.id) { setSlices([]); return }
    const unsub = onSnapshot(
      query(collection(db, 'applications'), where('requestId', '==', activeRequest.id)),
      snap => setSlices(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    )
    return unsub
  }, [activeRequest?.id])

  // Live list of the patient's documents — powers the "already uploaded"
  // markers on the form and the document status + re-upload list on the
  // active-request view.
  useEffect(() => {
    if (!user?.uid) return
    const unsub = onSnapshot(
      query(collection(db, 'documents'), where('patientId', '==', user.uid)),
      snap => setMyDocs(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
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
      // same-type doc in place so we never create duplicates.
      for (const tp of reqDocTypes) {
        const file = pendingFiles[tp.name]
        if (!file) continue
        const existing = docForType(tp.name)
        const ocr      = ocrResults[tp.name] ?? null
        if (existing) await replacePatientDocument({ docId: existing.id, file, ocr, user })
        else          await uploadPatientDocument({ file, typeName: tp.name, typeId: tp.id, ocr, user })
      }

      // Representative identity documents (when filing on the patient's behalf).
      let filedBy = null
      if (filedByRep) {
        const repIdRef     = await uploadPatientDocument({ file: pendingFiles[REP_ID], typeName: 'Representative ID', user })
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

      // Fire-and-forget notifications — never block the success state.
      Promise.all([
        notify(user.uid, {
          type:  'app_submitted',
          title: t('patient.request.notifyPatientTitle'),
          body:  t('patient.request.notifyPatientBody', { id: requestId }),
        }),
        getDocs(query(collection(db, 'users'), where('role', 'in', ['super_admin', 'staff_admin'])))
          .then(snap => Promise.all(snap.docs.map(d => notify(d.id, {
            type:  'app_submitted',
            title: 'New assistance request',
            body:  `${user.name} submitted a ${form.assistanceType} request for ${peso(amountNeeded)} (net). ID: ${requestId}.`,
          })))),
      ]).catch(() => {})
    } catch (err) {
      console.error('[request] submit failed:', err?.code, err?.message, err)
      toast.error(t('patient.request.errFailed'))
      setSubmitting(false)
    }
  }

  // ── Success screen ───────────────────────────────────────────────────────
  if (submittedId) {
    return (
      <Layout breadcrumb={t('patient.request.navLabel')}>
        <div className="px-4 py-6 sm:p-6 max-w-md mx-auto">
          <div className="card p-6 sm:p-8 text-center space-y-4">
            <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto">
              <MdCheckCircle size={36} className="text-green-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-1">{t('patient.request.successTitle')}</h2>
              <p className="text-sm text-gray-500">{t('patient.request.successDesc')}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-4">
              <p className="text-xs text-gray-400 mb-1">{t('patient.request.successIdLabel')}</p>
              <p className="text-xl font-bold text-gray-900 tracking-wide">{submittedId}</p>
            </div>
            <button className="btn-primary w-full py-3 text-sm" onClick={() => navigate('/patient/status')}>
              {t('patient.request.viewStatus')} →
            </button>
          </div>
        </div>
      </Layout>
    )
  }

  // ── Active request — block new submission, show its state ─────────────────
  if (!loading && activeRequest) {
    const cfg = REQUEST_STATUS_CONFIG[activeRequest.status] ?? REQUEST_STATUS_CONFIG.submitted
    const { committed, balance, pct } = computeFunding(activeRequest.amountNeeded, slices)
    return (
      <Layout breadcrumb={t('patient.request.navLabel')}>
        <div className="px-4 py-6 sm:p-6 max-w-lg mx-auto">
          <div className="card p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-3">
              <MdHourglassTop size={20} className="text-amber-500" />
              <h2 className="text-base font-semibold text-gray-900">{t('patient.request.activeTitle')}</h2>
              <span className={`badge text-xs ml-auto ${cfg.badge}`}>{cfg.label}</span>
            </div>
            <p className="text-sm text-gray-500 mb-4">{t('patient.request.activeDesc')}</p>

            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">{t('patient.request.successIdLabel')}</span>
                <span className="font-semibold text-gray-800">{activeRequest.requestId}</span>
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
                    const scfg     = APP_STATUS_CONFIG[s.status] ?? APP_STATUS_CONFIG.pending
                    const secured  = ['approved', 'certificate'].includes(s.status)
                    const amt      = secured ? (s.amountApproved || s.amountRequested) : s.amountRequested
                    const pctBill  = activeRequest.amountNeeded > 0 ? Math.round((amt / activeRequest.amountNeeded) * 100) : 0
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
                          <span className={`badge text-xs flex-shrink-0 ${scfg.badge}`}>{scfg.label}</span>
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
          </div>
        </div>
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
      <div className="px-4 py-5 sm:p-6 max-w-lg mx-auto">
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
                        <p className={`text-xs mt-1.5 ${ocr?.match === true ? 'text-green-600' : ocr?.match === false ? 'text-amber-600' : 'text-gray-400'}`}>
                          {ocrBusy
                            ? t('patient.request.ocrChecking')
                            : ocr?.match === true
                              ? t('patient.request.ocrMatch')
                              : ocr?.match === false
                                ? t('patient.request.ocrNoMatch')
                                : t('patient.request.ocrUnreadable')}
                        </p>
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