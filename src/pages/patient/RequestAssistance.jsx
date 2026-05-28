import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import {
  collection, query, where, onSnapshot, getDocs,
  doc, setDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import {
  generateRequestId, computeAmountNeeded, computeFunding,
} from '../../utils/requests'
import { REQUEST_STATUS_CONFIG } from '../../utils/constants'
import { useTranslation } from 'react-i18next'
import {
  MdFavorite, MdCheckCircle, MdWarning, MdDescription,
  MdReceiptLong, MdHourglassTop,
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
  const [hasBilling,    setHasBilling]    = useState(false)
  const [loading,       setLoading]       = useState(true)
  const [submitting,    setSubmitting]    = useState(false)
  const [submittedId,   setSubmittedId]   = useState('')

  const [form, setForm] = useState({
    assistanceType: '', totalBill: '', philhealthCovered: '', otherCovered: '', description: '',
  })
  const [declared, setDeclared] = useState(false)
  const set = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.value }))

  // Assistance types (admin-managed list)
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

  useEffect(() => {
    if (!user?.uid) return
    getDocs(query(collection(db, 'documents'), where('patientId', '==', user.uid)))
      .then(snap => {
        const docs = snap.docs.map(d => d.data())
        setHasBilling(docs.some(d =>
          `${d.name ?? ''} ${d.documentTypeName ?? ''}`.toLowerCase().includes('billing')))
      })
      .catch(() => {})
  }, [user?.uid])

  const amountNeeded = computeAmountNeeded({
    totalBill:         form.totalBill,
    philhealthCovered: form.philhealthCovered,
    otherCovered:      form.otherCovered,
  })

  const handleSubmit = async () => {
    if (submitting) return
    if (activeRequest)            { toast.error(t('patient.request.errActive')); return }
    if (!form.assistanceType)     { toast.error(t('patient.request.errType')); return }
    if (!form.totalBill || Number(form.totalBill) <= 0) { toast.error(t('patient.request.errBill')); return }
    if (amountNeeded <= 0)        { toast.error(t('patient.request.errNeeded')); return }
    if (!declared)                { toast.error(t('patient.request.errDeclare')); return }

    setSubmitting(true)
    try {
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
        totalBill:         Number(form.totalBill) || 0,
        philhealthCovered: Number(form.philhealthCovered) || 0,
        otherCovered:      Number(form.otherCovered) || 0,
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
    const { committed, balance, pct } = computeFunding(activeRequest.amountNeeded, [])
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

          {/* Amounts */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{t('patient.request.billLabel')} <span className="text-red-400">*</span></label>
            <input type="number" min="0" inputMode="numeric" className="input" placeholder="0"
              value={form.totalBill} onChange={set('totalBill')} />
            <p className="text-xs text-gray-400 mt-1">{t('patient.request.billHint')}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">{t('patient.request.philhealthLabel')}</label>
              <input type="number" min="0" inputMode="numeric" className="input" placeholder="0"
                value={form.philhealthCovered} onChange={set('philhealthCovered')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">{t('patient.request.otherLabel')}</label>
              <input type="number" min="0" inputMode="numeric" className="input" placeholder="0"
                value={form.otherCovered} onChange={set('otherCovered')} />
            </div>
          </div>

          {/* Net amount needed */}
          <div className="bg-brand-50 border border-brand-100 rounded-xl px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-brand-700 font-medium">{t('patient.request.neededLabel')}</p>
              <p className="text-xs text-brand-600/80">{t('patient.request.neededHint')}</p>
            </div>
            <p className="text-xl font-bold text-brand-700">{peso(amountNeeded)}</p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{t('patient.request.descLabel')}</label>
            <textarea className="input resize-none" rows={2} placeholder={t('patient.request.descPlaceholder')}
              value={form.description} onChange={set('description')} maxLength={300} />
          </div>

          {/* Billing statement reminder */}
          <div className={`rounded-xl px-4 py-3 flex items-start gap-2 border ${hasBilling ? 'bg-green-50 border-green-100' : 'bg-amber-50 border-amber-100'}`}>
            {hasBilling
              ? <MdReceiptLong size={16} className="text-green-500 flex-shrink-0 mt-0.5" />
              : <MdWarning size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-medium ${hasBilling ? 'text-green-700' : 'text-amber-700'}`}>{t('patient.request.billingReminderTitle')}</p>
              <p className={`text-xs ${hasBilling ? 'text-green-600' : 'text-amber-600'}`}>{t('patient.request.billingReminderDesc')}</p>
              {!hasBilling && (
                <button className="text-xs font-semibold text-amber-700 underline mt-1" onClick={() => navigate('/patient/documents')}>
                  {t('patient.request.goToDocuments')} →
                </button>
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