import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { MdSearch, MdLocationOn, MdSchedule, MdCheckCircle, MdClose, MdWarning, MdHourglassEmpty, MdCancel, MdHourglassTop, MdLocalHospital } from 'react-icons/md'
import Layout from '../../components/Layout'
import {
  collection, query, where, onSnapshot, getDocs,
  doc, serverTimestamp, runTransaction,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import { SLOT_STATUS } from '../../utils/constants'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'

// ── Apply Modal ───────────────────────────────────────────────────────────

function ApplyModal({ agency, onClose }) {
  const { t }                           = useTranslation()
  const { user }                        = useAuth()
  const navigate                        = useNavigate()
  const [allDocs,        setAllDocs]        = useState([])
  const [submitting,     setSubmitting]     = useState(false)
  const [alreadyApplied,  setAlreadyApplied]  = useState(false)
  const [activeElsewhere, setActiveElsewhere] = useState(null)
  const [checksLoading,   setChecksLoading]   = useState(true)
  const [declared,        setDeclared]        = useState(false)
  const [submitted,       setSubmitted]       = useState(false)
  const [submittedAppId,  setSubmittedAppId]  = useState('')

  // Load verified docs + duplicate check in parallel; disable Submit until both resolve
  useEffect(() => {
    if (!user) return
    setChecksLoading(true)
    Promise.all([
      getDocs(query(collection(db, 'documents'),    where('patientId', '==', user.uid))),
      getDocs(query(collection(db, 'applications'), where('patientId', '==', user.uid))),
    ]).then(([docsSnap, appsSnap]) => {
      setAllDocs(docsSnap.docs.map(d => ({
        name:   (d.data().name ?? '').toLowerCase(),
        status: d.data().status,
      })))

      const allApps   = appsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const activeOnes = allApps.filter(a => !['rejected', 'certificate'].includes(a.status))

      // Already applied to this specific agency
      setAlreadyApplied(activeOnes.some(a => a.agencyId === agency.id))

      // Has an active application to a DIFFERENT agency
      const elsewhere = activeOnes.find(a => a.agencyId !== agency.id)
      setActiveElsewhere(elsewhere ?? null)

      setChecksLoading(false)
    })
  }, [user, agency.id])

  const slots   = agency.slots ?? { total: 0, remaining: 0 }
  const isFull  = slots.remaining === 0
  const reqs    = agency.requirements ?? []

  const reqStatus = reqs.map(req => {
    const reqLower = req.toLowerCase().trim()
    const matching = allDocs.filter(d => d.name.includes(reqLower))
    const isVerified = matching.some(d => d.status === 'verified')
    const isPending  = matching.some(d => d.status === 'pending')
    return {
      name:     req,
      verified: isVerified,
      pending:  !isVerified && isPending,
      missing:  !isVerified && !isPending,
    }
  })
  const missingCount = reqStatus.filter(r => r.missing).length

  const handleSubmit = async () => {
    // #11 — Idempotency guard: prevent double-submit on slow phones where
    // React's disabled-prop re-render lags behind a double-tap. Without
    // this, two app docs + two slot decrements can fire.
    if (submitting) return

    if (alreadyApplied)  { toast.error(t('patient.apply.errAlreadyApplied')); return }
    if (activeElsewhere) { toast.error(t('patient.apply.errActiveElsewhere', { agency: activeElsewhere.agencyName })); return }
    if (isFull)         { toast.error(t('patient.apply.errNoSlots')); return }

    setSubmitting(true)
    try {
      // Snapshot patient's current documents at submission time
      const docsSnap = await getDocs(query(collection(db, 'documents'), where('patientId', '==', user.uid)))
      const attachedDocuments = docsSnap.docs.map(d => ({
        documentId:       d.id,
        name:             d.data().name ?? '',
        documentTypeName: d.data().documentTypeName ?? '',
        status:           d.data().status ?? 'pending',
        date:             d.data().date ?? '',
      }))

      const year   = new Date().getFullYear()
      const random = Math.random().toString(36).slice(2, 5).toUpperCase()
      const appId  = `APP-${year}-${String(Date.now()).slice(-6)}${random}`

      // #3 — Transactional slot decrement + app create. Without the
      // transaction, two patients passing the in-modal `remaining > 0`
      // check could both decrement, oversold by one. runTransaction
      // re-reads inside the boundary and aborts cleanly if the slot
      // disappeared between modal open and Submit.
      try {
        await runTransaction(db, async (tx) => {
          const agencyRef  = doc(db, 'agencies', agency.id)
          const agencySnap = await tx.get(agencyRef)
          const remaining  = agencySnap.data()?.slots?.remaining ?? 0
          if (remaining <= 0) throw new Error('NO_SLOTS')

          // addDoc inside a transaction: pre-allocate the ref so the
          // generated ID is known to both the set + downstream code.
          const appRef = doc(collection(db, 'applications'))
          tx.set(appRef, {
            appId,
            patientId:      user.uid,
            patientName:    user.name ?? '',
            patientContact: user.contact ?? '',
            patientAddress: user.address ?? '',
            agencyId:       agency.id,
            agencyName:     agency.name,
            agencyColor:    agency.color    ?? 'bg-gray-500',
            agencyInitials: agency.initials ?? agency.name?.slice(0, 2).toUpperCase(),
            status:             'pending',
            submittedAt:        serverTimestamp(),
            updatedAt:          serverTimestamp(),
            attachedDocuments,
            stages: [
              { key: 'submitted',   label: 'Application Submitted', done: true,  active: false, date: new Date().toLocaleDateString(), note: 'Your application was successfully submitted.'           },
              { key: 'docs',        label: 'Document Verification', done: false, active: true,  date: null, note: 'Upload your required documents. The administrator will verify them before your application proceeds.' },
              { key: 'reviewing',   label: 'Under Agency Review',   done: false, active: false, date: null, note: 'The agency is reviewing your application.'                  },
              { key: 'interview',   label: 'Interview Scheduled',   done: false, active: false, date: null, note: 'You will be scheduled for a video interview.'               },
              { key: 'approved',    label: 'Application Approved',  done: false, active: false, date: null, note: 'Your application has been approved.'                        },
              { key: 'certificate', label: 'Guarantee Letter Issued', done: false, active: false, date: null, note: 'Your Guarantee Letter will be issued.' },
            ],
          })
          tx.update(agencyRef, { 'slots.remaining': remaining - 1 })
        })
      } catch (txErr) {
        if (String(txErr.message) === 'NO_SLOTS') {
          toast.error(t('patient.apply.errSpotsRanOut'))
          setSubmitting(false)
          return
        }
        throw txErr
      }

      // Show success screen inside modal — patient reads at their own pace
      setSubmittedAppId(appId)
      setSubmitted(true)

      // Fire-and-forget notifications — never block or affect success state
      Promise.all([
        getDocs(query(
          collection(db, 'users'),
          where('agencyId', '==', agency.id),
          where('role', '==', 'agency')
        )).then(snap => Promise.all(snap.docs.map(d => notify(d.id, {
          type:  'app_submitted',
          title: 'New application received',
          body:  `${user.name} has submitted an application to ${agency.name}.`,
        })))),
        notify(user.uid, {
          type:  'app_submitted',
          title: 'Application submitted',
          body:  `You successfully applied to ${agency.name}. Application ID: ${appId}.`,
        }),
        getDocs(query(
          collection(db, 'users'),
          where('role', 'in', ['super_admin', 'staff_admin'])
        )).then(snap => Promise.all(snap.docs.map(d => notify(d.id, {
          type:  'app_submitted',
          title: 'New application submitted',
          body:  `${user.name} submitted an application to ${agency.name}. ID: ${appId}.`,
        })))),
      ]).catch(() => {})

    } catch {
      toast.error(t('patient.apply.errFailed'))
      setSubmitting(false)
    }
  }

  // ── Success screen ───────────────────────────────────────────────────────
  if (submitted) return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-8 text-center space-y-4">

          {/* Icon */}
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto">
            <MdCheckCircle size={36} className="text-green-500" />
          </div>

          {/* Heading */}
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">{t('patient.apply.successTitle')}</h2>
            <p className="text-sm text-gray-500">{t('patient.apply.successDesc', { agency: agency.name })}</p>
          </div>

          {/* Application ID */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-4">
            <p className="text-xs text-gray-400 mb-1">{t('patient.apply.successIdLabel')}</p>
            <p className="text-xl font-bold text-gray-900 tracking-wide">{submittedAppId}</p>
            <p className="text-xs text-gray-400 mt-1">{t('patient.apply.successIdNote')}</p>
          </div>

          {/* Next steps */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-5 py-3 text-left space-y-1.5">
            <p className="text-sm font-semibold text-blue-700">{t('patient.apply.nextStepsTitle')}</p>
            <p className="text-sm text-blue-600">1. {t('patient.apply.nextStep1')}</p>
            <p className="text-sm text-blue-600">2. {agency.processingTime
              ? t('patient.apply.nextStep2WithTime', { agency: agency.name, time: agency.processingTime })
              : t('patient.apply.nextStep2', { agency: agency.name })}</p>
            <p className="text-sm text-blue-600">3. {t('patient.apply.nextStep3')}</p>
          </div>

          {/* CTA */}
          <button
            className="btn-primary w-full py-3 text-sm"
            onClick={() => { onClose(); navigate('/patient/status') }}>
            {t('patient.programs.viewMyApp')} →
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{t('patient.apply.title', { agency: agency.name })}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto max-h-[60vh]">
          {/* Agency info */}
          <div className="p-3 bg-gray-50 rounded-xl">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 ${agency.color} rounded-xl text-white font-bold text-sm flex items-center justify-center flex-shrink-0`}>
                {agency.initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">{agency.name}</p>
                <p className="text-xs text-gray-400 flex items-center gap-1">
                  <MdLocationOn size={11} />{agency.location}
                </p>
                <p className="text-xs text-gray-400 flex items-center gap-1">
                  <MdSchedule size={11} /> {t('patient.apply.processing', { time: agency.processingTime })}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs text-gray-400">{t('patient.apply.spotsTodayLabel')}</p>
                <p className={`text-lg font-bold ${isFull ? 'text-red-500' : 'text-green-600'}`}>
                  {slots.remaining}/{slots.total}
                </p>
              </div>
            </div>
            {agency.description && (
              <p className="text-xs text-gray-500 mt-2.5 leading-relaxed line-clamp-3">{agency.description}</p>
            )}
          </div>

          {/* Single highest-priority blocker — duplicate > elsewhere > full.
              Showing two stacked red banners read as two unrelated problems
              when really fixing one moot-ifies the other. */}
          {(() => {
            const blocker = alreadyApplied ? 'duplicate'
                          : activeElsewhere ? 'elsewhere'
                          : isFull ? 'full'
                          : null
            if (!blocker) return null
            const cfg = {
              duplicate: { bg: 'bg-amber-50', border: 'border-amber-200', iconCls: 'text-amber-500', textCls: 'text-amber-700', msg: t('patient.apply.alreadyApplied') },
              elsewhere: { bg: 'bg-red-50',   border: 'border-red-200',   iconCls: 'text-red-500',   textCls: 'text-red-700',   msg: t('patient.apply.activeElsewhere', { agency: activeElsewhere?.agencyName }) },
              full:      { bg: 'bg-red-50',   border: 'border-red-200',   iconCls: 'text-red-500',   textCls: 'text-red-700',   msg: t('patient.apply.noSpotsWarning') },
            }[blocker]
            return (
              <div className={`${cfg.bg} border ${cfg.border} rounded-xl p-3 flex items-start gap-2`}>
                <MdWarning size={16} className={`${cfg.iconCls} flex-shrink-0 mt-0.5`} />
                <p className={`text-xs ${cfg.textCls}`}>{cfg.msg}</p>
              </div>
            )
          })()}

          {/* Requirements checklist */}
          {reqs.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('patient.apply.requirementsTitle')}</p>
              {checksLoading ? (
                <div className="space-y-2">
                  {reqs.map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full bg-gray-100 animate-pulse flex-shrink-0" />
                      <div className="h-3 bg-gray-100 rounded animate-pulse flex-1" />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    {reqStatus.map((r, i) => (
                      <div key={i} className="flex items-center gap-2">
                        {r.verified
                          ? <MdCheckCircle size={15} className="text-green-500 flex-shrink-0" />
                          : r.pending
                            ? <MdHourglassEmpty size={15} className="text-amber-400 flex-shrink-0" />
                            : <MdCancel size={15} className="text-gray-300 flex-shrink-0" />
                        }
                        <span className={`text-sm ${
                          r.verified ? 'text-gray-700'
                          : r.pending ? 'text-amber-700'
                          : 'text-gray-400'}`}>
                          {r.name}
                          {r.verified && <span className="ml-1 text-green-600">{t('patient.apply.reqVerified')}</span>}
                          {r.pending  && <span className="ml-1 text-amber-500">{t('patient.apply.reqPending')}</span>}
                          {r.missing  && <span className="ml-1 text-gray-300">{t('patient.apply.reqMissing')}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                  {missingCount > 0 && (
                    <div className="mt-2 bg-blue-50 border border-blue-100 rounded-lg p-2.5 flex items-start justify-between gap-2">
                      <p className="text-sm text-blue-700">
                        {missingCount === 1
                          ? t('patient.apply.missingOne')
                          : t('patient.apply.missingMany', { count: missingCount })}
                      </p>
                      <button
                        className="flex-shrink-0 text-xs text-blue-600 font-semibold hover:text-blue-800 underline"
                        onClick={() => { onClose(); navigate('/patient/documents') }}>
                        {t('patient.apply.upload')} →
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Declaration checkbox */}
          {!isFull && !alreadyApplied && !activeElsewhere && (
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5 w-4 h-4 accent-brand-500 flex-shrink-0"
                checked={declared}
                onChange={e => setDeclared(e.target.checked)}
              />
              <span className="text-sm text-gray-600 leading-snug">
                {t('patient.apply.declaration')}
              </span>
            </label>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose}>{t('patient.apply.cancel')}</button>
          <button
            className="btn-primary text-sm"
            onClick={handleSubmit}
            disabled={submitting || checksLoading || isFull || alreadyApplied || !!activeElsewhere || !declared}>
            {checksLoading ? t('patient.apply.checking') : submitting ? t('patient.apply.submitting') : `${t('patient.apply.submit')} →`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function MedicalPrograms() {
  const { t }                             = useTranslation()
  const navigate                          = useNavigate()
  const location                          = useLocation()
  const { user }                          = useAuth()
  const [search, setSearch]               = useState('')
  const [selectedType, setSelectedType]   = useState('')
  const [agencies, setAgencies]           = useState([])
  const [loading, setLoading]             = useState(true)
  // applyingToId — modal reads the live agency record from `agencies`, not a
  // captured snapshot, so slot counts stay current while the modal is open.
  const [applyingToId,     setApplyingToId]     = useState(null)
  const [hasCertificate,   setHasCertificate]   = useState(false)
  const [appliedAgencyIds, setAppliedAgencyIds] = useState(new Set())

  useEffect(() => {
    const q = query(collection(db, 'agencies'), where('enabled', '==', true))
    const unsub = onSnapshot(q, snap => {
      setAgencies(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => a.name.localeCompare(b.name))
      )
      setLoading(false)
    })
    return unsub
  }, [])

  // Auto-open apply modal when arriving from Screening with a recommended agency
  useEffect(() => {
    const targetId = location.state?.openAgencyId
    if (!targetId || agencies.length === 0) return
    if (agencies.some(a => a.id === targetId)) setApplyingToId(targetId)
  }, [agencies, location.state?.openAgencyId])

  // Live subscription to the patient's applications — so the "Apply Now"
  // button on each card reflects newly-submitted applications without a
  // page refresh (e.g., after closing the apply modal).
  useEffect(() => {
    if (!user?.uid) return
    const unsub = onSnapshot(
      query(collection(db, 'applications'), where('patientId', '==', user.uid)),
      snap => {
        const docs = snap.docs.map(d => d.data())
        setHasCertificate(docs.some(d => d.status === 'certificate'))
        setAppliedAgencyIds(new Set(
          docs
            .filter(d => !['rejected', 'certificate'].includes(d.status))
            .map(d => d.agencyId)
        ))
      }
    )
    return unsub
  }, [user?.uid])

  const allTypes = [...new Set(agencies.flatMap(a => a.assistanceTypes ?? []))].sort()

  const filtered = agencies.filter(a => {
    if (selectedType && !(a.assistanceTypes ?? []).includes(selectedType)) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      a.name?.toLowerCase().includes(q) ||
      a.description?.toLowerCase().includes(q) ||
      (a.assistanceTypes ?? []).some(typeName => typeName.toLowerCase().includes(q))
    )
  })

  return (
    <Layout breadcrumb={t('patient.programs.breadcrumb')}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">

          <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
            <div>
              <h1 className="page-title">{t('patient.programs.title')}</h1>
              <p className="page-sub">{t('patient.programs.subtitle')}</p>
            </div>
            {location.state?.openAgencyId && (
              <button
                className="btn-secondary text-sm flex items-center gap-1.5 flex-shrink-0"
                onClick={() => navigate('/patient/screening')}>
                ← {t('patient.programs.backToMatches')}
              </button>
            )}
          </div>

          {/* Holding period banner — only for patients with a certificate */}
          {hasCertificate && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2 mb-5">
              <MdHourglassTop size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-700">{t('patient.programs.holdingTitle')}</p>
                <p className="text-xs text-amber-600">{t('patient.programs.holdingDesc')}</p>
              </div>
            </div>
          )}

          {/* All slots full banner */}
          {!loading && agencies.length > 0 && agencies.every(a => (a.slots?.remaining ?? 0) === 0) && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 text-center">
              <p className="text-sm font-semibold text-amber-700">{t('patient.programs.allFullTitle')}</p>
              <p className="text-xs text-amber-600 mt-1">
                {t('patient.programs.allFullDesc')}
              </p>
            </div>
          )}

          {/* Search */}
          <div className="relative mb-3">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input className="input pl-9 pr-10" placeholder={t('patient.programs.searchPlaceholder')}
              value={search} onChange={e => setSearch(e.target.value)} />
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
                <MdClose size={14} />
              </button>
            )}
          </div>

          {/* Type filter chips — right-edge fade hints at scrollable overflow
              when chips exceed viewport width. */}
          {allTypes.length > 0 && (
            <div className="relative mb-5">
              <div className="flex gap-1.5 overflow-x-auto pb-1 pr-8 scrollbar-hide">
                <button
                  onClick={() => setSelectedType('')}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    selectedType === ''
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}>
                  {t('patient.programs.filterAll')}
                </button>
                {allTypes.map(typeName => (
                  <button key={typeName}
                    onClick={() => setSelectedType(prev => prev === typeName ? '' : typeName)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      selectedType === typeName
                        ? 'bg-brand-500 text-white border-brand-500'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}>
                    {typeName}
                  </button>
                ))}
              </div>
              <div className="pointer-events-none absolute right-0 top-0 bottom-1 w-8 bg-gradient-to-l from-gray-50 to-transparent" />
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="card p-5 animate-pulse">
                  <div className="flex gap-3 mb-3">
                    <div className="w-11 h-11 bg-gray-100 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-gray-100 rounded w-3/4" />
                      <div className="h-2 bg-gray-100 rounded w-1/2" />
                    </div>
                  </div>
                  <div className="h-2 bg-gray-100 rounded mb-4" />
                  <div className="space-y-1.5">
                    <div className="h-2 bg-gray-100 rounded" />
                    <div className="h-2 bg-gray-100 rounded w-5/6" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Agency cards */}
          {!loading && filtered.length > 0 && (
            <p className="text-sm text-gray-400 mb-3">
              {t('patient.programs.chooseHint')}
            </p>
          )}
          {!loading && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map(agency => {
                const slots  = agency.slots ?? { total: 0, remaining: 0 }
                const status = SLOT_STATUS(slots.remaining, slots.total)
                const pct    = slots.total > 0
                  ? Math.round((slots.remaining / slots.total) * 100) : 0
                const isFull     = slots.remaining === 0
                const hasApplied    = appliedAgencyIds.has(agency.id)
        const isBlocked     = !hasApplied && appliedAgencyIds.size > 0
                const types      = agency.assistanceTypes ?? []

                return (
                  <div key={agency.id} className={`card p-5 hover:shadow-md transition-shadow flex flex-col ${isFull ? 'opacity-70' : ''}`}>
                    {/* Header */}
                    <div className="flex items-start gap-3 mb-3">
                      <div className={`flex-shrink-0 w-11 h-11 ${agency.color} rounded-xl text-white font-bold text-sm flex items-center justify-center`}>
                        {agency.initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-800">{agency.name}</h3>
                        <div className="flex items-center gap-1 mt-0.5">
                          <MdLocationOn size={12} className="text-gray-400 flex-shrink-0" />
                          <p className="text-xs text-gray-400 truncate">{agency.location}</p>
                        </div>
                      </div>
                    </div>

                    {/* Slot bar */}
                    <div className="w-full h-2 bg-gray-100 rounded-full mb-1">
                      <div className={`h-2 rounded-full ${status.bar}`} style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-gray-400 mb-3">{t('patient.programs.spotsAvailableToday', { remaining: slots.remaining, total: slots.total })}</p>

                    {/* Description */}
                    <p className="text-sm text-gray-500 mb-3 leading-relaxed line-clamp-3">{agency.description}</p>

                    {/* Assistance types */}
                    {types.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {types.slice(0, 4).map((typeName, i) => (
                          <span key={i} className="badge badge-blue text-xs">{typeName}</span>
                        ))}
                        {types.length > 4 && (
                          <span className="badge badge-blue text-xs">{t('patient.programs.moreTypes', { count: types.length - 4 })}</span>
                        )}
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-3 border-t border-gray-50 mt-auto">
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        <MdSchedule size={13} />
                        {agency.processingTime}
                      </div>
                      {hasApplied ? (
                        <span className="flex items-center gap-1 text-xs text-green-600 border border-green-200 bg-green-50 px-2.5 py-1 rounded-lg font-medium">
                          <MdCheckCircle size={12} /> {t('patient.programs.applied')}
                        </span>
                      ) : isBlocked ? (
                        <button
                          className="flex items-center gap-1 text-xs text-brand-600 border border-brand-200 bg-brand-50 px-2.5 py-1 rounded-lg font-medium hover:bg-brand-100 transition-colors"
                          onClick={() => navigate('/patient/status')}>
                          {t('patient.programs.viewMyApp')} →
                        </button>
                      ) : isFull ? (
                        <button className="btn-secondary text-xs opacity-60 cursor-not-allowed" disabled>
                          {t('patient.programs.noSpotsToday')}
                        </button>
                      ) : (
                        <button className="btn-primary text-sm"
                          onClick={() => setApplyingToId(agency.id)}>
                          {t('patient.programs.applyNow')} →
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}

              {filtered.length === 0 && (
                <div className="col-span-2 card p-10 text-center">
                  <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <MdLocalHospital size={28} className="text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-600 mb-1">
                    {search || selectedType ? t('patient.programs.noneMatchTitle') : t('patient.programs.noneAvailableTitle')}
                  </p>
                  <p className="text-xs text-gray-400">
                    {search || selectedType
                      ? t('patient.programs.noneMatchDesc')
                      : t('patient.programs.noneAvailableDesc')}
                  </p>
                  {selectedType && (
                    <button
                      className="mt-3 text-sm text-brand-500 font-medium hover:underline"
                      onClick={() => setSelectedType('')}>
                      {t('patient.programs.clearFilter')}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

      </div>

      {/* Apply modal — pass the live agency from the agencies snapshot so
          slot counts inside the modal stay current. */}
      {applyingToId && (() => {
        const liveAgency = agencies.find(a => a.id === applyingToId)
        if (!liveAgency) return null
        return (
          <ApplyModal
            agency={liveAgency}
            onClose={() => setApplyingToId(null)}
          />
        )
      })()}
    </Layout>
  )
}
