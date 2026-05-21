import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { MdSearch, MdLocationOn, MdSchedule, MdCheckCircle, MdClose, MdWarning, MdHourglassEmpty, MdCancel } from 'react-icons/md'
import Layout from '../../components/Layout'
import {
  collection, query, where, onSnapshot, getDocs, getDoc,
  addDoc, updateDoc, doc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import { SLOT_STATUS } from '../../utils/constants'
import toast from 'react-hot-toast'

// ── Apply Modal ───────────────────────────────────────────────────────────

function ApplyModal({ agency, onClose }) {
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
    if (alreadyApplied)  { toast.error('You already have an active application to this agency.'); return }
    if (activeElsewhere) { toast.error(`Complete your application at ${activeElsewhere.agencyName} first.`); return }
    if (isFull)         { toast.error('No slots available for today.'); return }

    setSubmitting(true)
    try {
      // Re-check slots in real time
      const agencySnap = await getDoc(doc(db, 'agencies', agency.id))
      const currentRemaining = agencySnap.data()?.slots?.remaining ?? 0
      if (currentRemaining <= 0) {
        toast.error('Spots just ran out. Please try another agency or come back tomorrow.')
        setSubmitting(false)
        return
      }

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

      // Create application document
      await addDoc(collection(db, 'applications'), {
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

      // Deduct slot
      await updateDoc(doc(db, 'agencies', agency.id), {
        'slots.remaining': currentRemaining - 1,
      })

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
      toast.error('Failed to submit application. Please try again.')
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
            <h2 className="text-lg font-bold text-gray-900 mb-1">Application Submitted!</h2>
            <p className="text-sm text-gray-500">Your application to <strong>{agency.name}</strong> has been received.</p>
          </div>

          {/* Application ID */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-4">
            <p className="text-xs text-gray-400 mb-1">Your Application ID</p>
            <p className="text-xl font-bold text-gray-900 tracking-wide">{submittedAppId}</p>
            <p className="text-xs text-gray-400 mt-1">Keep this ID for your records.</p>
          </div>

          {/* Next steps */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-5 py-3 text-left space-y-1.5">
            <p className="text-sm font-semibold text-blue-700">What happens next?</p>
            <p className="text-sm text-blue-600">1. Your documents will be reviewed by the administrator.</p>
            <p className="text-sm text-blue-600">2. {agency.name} will review your application{agency.processingTime ? ` within ${agency.processingTime}` : ''}.</p>
            <p className="text-sm text-blue-600">3. You will be notified of updates through this portal.</p>
          </div>

          {/* CTA */}
          <button
            className="btn-primary w-full py-3 text-sm"
            onClick={() => { onClose(); navigate('/patient/status') }}>
            View My Application →
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
          <h2 className="text-base font-semibold text-gray-900">Apply to {agency.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto max-h-[60vh]">
          {/* Agency info */}
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
            <div className={`w-12 h-12 ${agency.color} rounded-xl text-white font-bold text-sm flex items-center justify-center flex-shrink-0`}>
              {agency.initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800">{agency.name}</p>
              <p className="text-xs text-gray-400 flex items-center gap-1">
                <MdLocationOn size={11} />{agency.location}
              </p>
              <p className="text-xs text-gray-400 flex items-center gap-1">
                <MdSchedule size={11} /> Processing: {agency.processingTime}
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-gray-400">Spots today</p>
              <p className={`text-lg font-bold ${isFull ? 'text-red-500' : 'text-green-600'}`}>
                {slots.remaining}/{slots.total}
              </p>
            </div>
          </div>

          {/* Already applied to this agency */}
          {alreadyApplied && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
              <MdWarning size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">
                You already have an active application to this agency. You cannot apply again until the current one is resolved.
              </p>
            </div>
          )}

          {/* Active application at a different agency */}
          {!alreadyApplied && activeElsewhere && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
              <MdWarning size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">
                You already have an active application at <strong>{activeElsewhere.agencyName}</strong>.
                Only one application is allowed at a time. Wait for it to be resolved before applying here.
              </p>
            </div>
          )}

          {/* No slots warning */}
          {isFull && !alreadyApplied && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
              <MdWarning size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">No spots available today. Spots reset daily at midnight.</p>
            </div>
          )}

          {/* Requirements checklist */}
          {reqs.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Requirements Checklist</p>
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
                          {r.verified && <span className="ml-1 text-green-600">(verified)</span>}
                          {r.pending  && <span className="ml-1 text-amber-500">(pending review)</span>}
                          {r.missing  && <span className="ml-1 text-gray-300">(not yet uploaded)</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                  {missingCount > 0 && (
                    <div className="mt-2 bg-blue-50 border border-blue-100 rounded-lg p-2.5 flex items-start justify-between gap-2">
                      <p className="text-sm text-blue-700">
                        You have {missingCount} missing document{missingCount !== 1 ? 's' : ''}. You can still apply but your application may be delayed.
                      </p>
                      <button
                        className="flex-shrink-0 text-xs text-blue-600 font-semibold hover:text-blue-800 underline"
                        onClick={() => { onClose(); navigate('/patient/documents') }}>
                        Upload →
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
                I confirm that my information and documents are genuine.
              </span>
            </label>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary text-sm"
            onClick={handleSubmit}
            disabled={submitting || checksLoading || isFull || alreadyApplied || !!activeElsewhere || !declared}>
            {checksLoading ? 'Checking...' : submitting ? 'Submitting...' : 'Submit Application →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function MedicalPrograms() {
  const navigate                          = useNavigate()
  const location                          = useLocation()
  const { user }                          = useAuth()
  const [search, setSearch]               = useState('')
  const [selectedType, setSelectedType]   = useState('')
  const [agencies, setAgencies]           = useState([])
  const [loading, setLoading]             = useState(true)
  const [applyingTo,       setApplyingTo]       = useState(null)
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
    const target = agencies.find(a => a.id === targetId)
    if (target) setApplyingTo(target)
  }, [agencies, location.state?.openAgencyId])

  // Check certificate status + load applied agency IDs in parallel
  useEffect(() => {
    if (!user?.uid) return
    getDocs(query(collection(db, 'applications'), where('patientId', '==', user.uid)))
      .then(snap => {
        const docs = snap.docs.map(d => d.data())
        setHasCertificate(docs.some(d => d.status === 'certificate'))
        setAppliedAgencyIds(new Set(
          docs
            .filter(d => !['rejected', 'certificate'].includes(d.status))
            .map(d => d.agencyId)
        ))
      })
  }, [user?.uid])

  const allTypes = [...new Set(agencies.flatMap(a => a.assistanceTypes ?? []))].sort()

  const filtered = agencies.filter(a => {
    if (selectedType && !(a.assistanceTypes ?? []).includes(selectedType)) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      a.name?.toLowerCase().includes(q) ||
      a.description?.toLowerCase().includes(q) ||
      (a.assistanceTypes ?? []).some(t => t.toLowerCase().includes(q))
    )
  })

  return (
    <Layout breadcrumb="Find Programs">
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">

          <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
            <div>
              <h1 className="page-title">Find Programs</h1>
              <p className="page-sub">Explore and apply for assistance programs available at CRMC. Spots reset daily at midnight.</p>
            </div>
            {location.state?.openAgencyId && (
              <button
                className="btn-secondary text-sm flex items-center gap-1.5 flex-shrink-0"
                onClick={() => navigate('/patient/screening')}>
                ← Back to My Matches
              </button>
            )}
          </div>

          {/* Holding period banner — only for patients with a certificate */}
          {hasCertificate && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2 mb-5">
              <span className="text-amber-500 text-base mt-0.5">⏳</span>
              <div>
                <p className="text-sm font-medium text-amber-700">Holding Period Active on Some Programs</p>
                <p className="text-xs text-amber-600">You received a Guarantee Letter from one or more programs. You can still apply to other programs freely.</p>
              </div>
            </div>
          )}

          {/* All slots full banner */}
          {!loading && agencies.length > 0 && agencies.every(a => (a.slots?.remaining ?? 0) === 0) && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 text-center">
              <p className="text-sm font-semibold text-amber-700">All spots for today are filled</p>
              <p className="text-xs text-amber-600 mt-1">
                Daily spots reset at midnight. Please check back tomorrow morning.
              </p>
            </div>
          )}

          {/* Search */}
          <div className="relative mb-3">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input className="input pl-9" placeholder="Search by name or type, e.g. dialysis..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          {/* Type filter chips */}
          {allTypes.length > 0 && (
            <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1 scrollbar-hide">
              <button
                onClick={() => setSelectedType('')}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  selectedType === ''
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                All
              </button>
              {allTypes.map(t => (
                <button key={t}
                  onClick={() => setSelectedType(prev => prev === t ? '' : t)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    selectedType === t
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}>
                  {t}
                </button>
              ))}
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
              Choose a program based on what it covers and how many spots are available today. Tap <strong>Apply Now</strong> to submit your application.
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
                    <p className="text-xs text-gray-400 mb-3">{slots.remaining} of {slots.total} spots available today</p>

                    {/* Description */}
                    <p className="text-sm text-gray-500 mb-3 leading-relaxed line-clamp-3">{agency.description}</p>

                    {/* Assistance types */}
                    {types.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {types.slice(0, 4).map((t, i) => (
                          <span key={i} className="badge badge-blue text-xs">{t}</span>
                        ))}
                        {types.length > 4 && (
                          <span className="badge badge-blue text-xs">+{types.length - 4} more</span>
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
                          ✓ Applied
                        </span>
                      ) : isBlocked ? (
                        <button
                          className="flex items-center gap-1 text-xs text-brand-600 border border-brand-200 bg-brand-50 px-2.5 py-1 rounded-lg font-medium hover:bg-brand-100 transition-colors"
                          onClick={() => navigate('/patient/status')}>
                          View My Application →
                        </button>
                      ) : isFull ? (
                        <button className="btn-secondary text-xs opacity-60 cursor-not-allowed" disabled>
                          No spots today
                        </button>
                      ) : (
                        <button className="btn-primary text-sm"
                          onClick={() => setApplyingTo(agency)}>
                          Apply Now →
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}

              {filtered.length === 0 && (
                <div className="col-span-2 card p-10 text-center">
                  <p className="text-3xl mb-3">🏥</p>
                  <p className="text-sm font-medium text-gray-600 mb-1">
                    {search || selectedType ? 'No programs match your filter.' : 'No programs available right now.'}
                  </p>
                  <p className="text-xs text-gray-400">
                    {search || selectedType
                      ? 'Try clearing the search or selecting a different type.'
                      : 'All agencies are currently disabled. Please check back later.'}
                  </p>
                  {selectedType && (
                    <button
                      className="mt-3 text-sm text-brand-500 font-medium hover:underline"
                      onClick={() => setSelectedType('')}>
                      Clear filter
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

      </div>

      {/* Apply modal */}
      {applyingTo && (
        <ApplyModal
          agency={applyingTo}
          onClose={() => setApplyingTo(null)}
        />
      )}
    </Layout>
  )
}
