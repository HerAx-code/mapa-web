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
import { REQUEST_STATUS_CONFIG, APP_STATUS_CONFIG, DOC_STATUS_CONFIG } from '../../utils/constants'
import { useTranslation } from 'react-i18next'
import {
  MdFavorite, MdCheckCircle, MdWarning, MdDescription,
  MdHourglassTop, MdUploadFile, MdClose,
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
  const [activeRequest, setActiveRequest] = useState(null)
  const [slices,        setSlices]        = useState([])
  const [myDocs,        setMyDocs]        = useState([])
  const [agencyMap,     setAgencyMap]     = useState({})
  const [billingFile,   setBillingFile]   = useState(null)
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

  const attachBilling = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const err = validateDocFile(file)
    if (err) { toast.error(err); return }
    setBillingFile(file)
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

  // Assistance types (names only — the request needs just a billing statement,
  // not per-type documents).
  useEffect(() => {
    getDocs(query(collection(db, 'assistanceTypes')))
      .then(snap => setTypes(snap.docs.map(d => d.data().name).filter(Boolean).sort()))
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

  // The only document needed to submit a request is the billing statement
  // (Statement of Account). Agency-specific requirements are handled later,
  // during per-agency compliance after endorsement.
  const billingDoc = myDocs.find(d => (d.documentTypeName ?? d.name ?? '').toLowerCase().includes('billing'))
  const hasBilling = !!billingDoc

  const amountNeeded = Number(form.amountNeeded) || 0

  const handleSubmit = async () => {
    if (submitting) return
    if (activeRequest)            { toast.error(t('patient.request.errActive')); return }
    if (!form.assistanceType)     { toast.error(t('patient.request.errType')); return }
    if (amountNeeded <= 0)        { toast.error(t('patient.request.errNeeded')); return }
    if (!billingFile && !hasBilling) { toast.error(t('patient.request.errBilling')); return }
    if (!declared)                { toast.error(t('patient.request.errDeclare')); return }

    setSubmitting(true)
    try {
      // Upload the billing statement (if newly attached) before snapshotting.
      // Replace the existing one in place so we never create a duplicate.
      if (billingFile) {
        if (billingDoc) await replacePatientDocument({ docId: billingDoc.id, file: billingFile, user })
        else            await uploadPatientDocument({ file: billingFile, typeName: 'Billing Statement', user })
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

            {/* Documents — status + re-upload of rejected ones */}
            {myDocs.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('patient.request.yourDocuments')}</p>
                <div className="space-y-2">
                  {myDocs.map(d => {
                    const dcfg = DOC_STATUS_CONFIG[d.status] ?? DOC_STATUS_CONFIG.pending
                    return (
                      <div key={d.id} className="flex items-center gap-2 p-2.5 rounded-lg border border-gray-100">
                        <MdDescription size={16} className="text-gray-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-700 truncate">{d.name}</p>
                        </div>
                        <span className={`badge text-xs flex-shrink-0 ${dcfg.badge}`}>{dcfg.label}</span>
                        {d.status === 'rejected' && (
                          <label className="text-xs font-medium text-brand-600 hover:text-brand-700 cursor-pointer flex items-center gap-1 flex-shrink-0">
                            <MdUploadFile size={14} /> {replacing === d.id ? t('patient.request.reuploading') : t('patient.request.reupload')}
                            <input type="file" accept="image/*,application/pdf" className="hidden"
                              disabled={replacing === d.id} onChange={reuploadDoc(d.id)} />
                          </label>
                        )}
                      </div>
                    )
                  })}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">{t('patient.request.reuploadHint')}</p>
              </div>
            )}

            <button className="btn-secondary w-full mt-4 text-sm" onClick={() => navigate('/patient/status')}>
              {t('patient.request.viewStatus')} →
            </button>
          </div>
        </div>
      </Layout>
    )
  }

  // ── Request form ──────────────────────────────────────────────────────────
  return (
    <Layout breadcrumb={t('patient.request.navLabel')}>
      <div className="px-4 py-5 sm:p-6 max-w-lg mx-auto">
        <div className="mb-5">
          <h1 className="page-title flex items-center gap-2"><MdFavorite className="text-brand-500" size={22} /> {t('patient.request.title')}</h1>
          <p className="page-sub">{t('patient.request.subtitle')}</p>
        </div>

        <div className="card p-5 space-y-4">
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

          {/* Billing statement — the only document needed to submit. CRMC
              verifies the amount needed against it. Agency-specific documents
              are collected later, after endorsement. */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('patient.request.billingTitle')}</p>
            <p className="text-xs text-gray-400 mb-2">{t('patient.request.billingHint')}</p>
            <div className="flex items-center gap-2 p-2.5 rounded-lg border border-gray-100">
              <MdDescription size={16} className="text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700 truncate">{t('patient.request.billingLabel')} <span className="text-red-400">*</span></p>
                {billingFile
                  ? <p className="text-xs text-green-600 truncate">{billingFile.name}</p>
                  : hasBilling && <p className="text-xs text-green-600 truncate">{t('patient.request.billingOnFile')}</p>}
              </div>
              {billingFile ? (
                <button type="button" className="text-gray-400 hover:text-red-500 flex-shrink-0" onClick={() => setBillingFile(null)}>
                  <MdClose size={16} />
                </button>
              ) : (
                <label className="text-xs font-medium text-brand-600 hover:text-brand-700 cursor-pointer flex items-center gap-1 flex-shrink-0">
                  <MdUploadFile size={14} /> {hasBilling ? t('patient.request.replace') : t('patient.request.docAttach')}
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={attachBilling} />
                </label>
              )}
            </div>
          </div>

          {/* Declaration */}
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input type="checkbox" className="mt-0.5 w-4 h-4 accent-brand-500 flex-shrink-0"
              checked={declared} onChange={e => setDeclared(e.target.checked)} />
            <span className="text-sm text-gray-600 leading-snug">{t('patient.request.declaration')}</span>
          </label>
        </div>

        <button
          className="btn-primary w-full mt-4 py-3 text-sm"
          onClick={handleSubmit}
          disabled={submitting || loading}>
          {submitting ? t('patient.request.submitting') : `${t('patient.request.submit')} →`}
        </button>
        <p className="text-xs text-gray-400 text-center mt-2">{t('patient.request.routeNote')}</p>
      </div>
    </Layout>
  )
}