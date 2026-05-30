import { useState, useEffect } from 'react'
import Layout from '../../components/Layout'
import {
  collection, query, where, onSnapshot, doc, getDocs, updateDoc,
  serverTimestamp, runTransaction, arrayUnion,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import { logAudit } from '../../utils/auditLog'
import { computeFunding } from '../../utils/requests'
import { REQUEST_STATUS_CONFIG, DOC_STATUS_CONFIG } from '../../utils/constants'
import { isIdType } from '../../utils/idOcr'
import { isIntakeComplete } from '../../utils/intakeSheet'
import { getOrCreateConversation } from '../../utils/messages'
import { Link, useNavigate } from 'react-router-dom'
import DocViewerModal from '../../components/DocViewerModal'
import { InterviewModal } from '../../components/agency/ApplicationModals'
import {
  MdClose, MdWarning, MdReceiptLong, MdLocalHospital, MdSend,
  MdPerson, MdAttachFile, MdBlock, MdCheckCircle, MdVisibility, MdDescription,
  MdVideoCall, MdEventRepeat, MdAssignment, MdArrowBack, MdSearch,
} from 'react-icons/md'
import toast from 'react-hot-toast'

const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`

const initials = (name) =>
  (name ?? '').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '—'

const fmtDate = (ts) => {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

const newAppId = () => {
  const year   = new Date().getFullYear()
  const random = Math.random().toString(36).slice(2, 5).toUpperCase()
  return `APP-${year}-${String(Date.now()).slice(-6)}${random}`
}

// Stage scaffold matching the patient apply flow so the endorsed slice renders
// identically in the agency Inbox / patient TrackStatus. CRMC has already
// verified docs at endorsement, so 'submitted' + 'docs' are marked done and
// the agency picks it up at 'reviewing'.
const sliceStages = () => ([
  { key: 'submitted',   label: 'Application Submitted',   done: true,  active: false, date: new Date().toLocaleDateString(), note: 'Endorsed to the agency by CRMC.' },
  { key: 'docs',        label: 'Document Verification',   done: true,  active: false, date: null, note: 'Documents verified by CRMC before endorsement.' },
  { key: 'reviewing',   label: 'Under Agency Review',     done: false, active: true,  date: null, note: 'The agency is reviewing this endorsed request.' },
  { key: 'interview',   label: 'Interview Scheduled',     done: false, active: false, date: null, note: 'You may be scheduled for a video interview.' },
  { key: 'approved',    label: 'Application Approved',     done: false, active: false, date: null, note: 'The agency has approved its share.' },
  { key: 'certificate', label: 'Guarantee Letter Issued', done: false, active: false, date: null, note: 'The agency issues its Guarantee Letter.' },
])

// ── Endorse modal ──────────────────────────────────────────────────────────

function EndorseModal({ request, slices, agencies, onClose }) {
  const { user } = useAuth()
  const { committed, headroom } = computeFunding(request.amountNeeded, slices)
  // Outstanding (reserved-but-not-approved) is derived from the live slices,
  // so headroom = needed − committed − outstanding. No denormalized tally on
  // the request, which keeps the agency's approval write within the fields
  // its Firestore rule permits.
  const liveHeadroom = headroom

  const [agencyId, setAgencyId] = useState('')
  const [amount,   setAmount]   = useState(String(liveHeadroom || ''))
  const [saving,   setSaving]   = useState(false)

  // Agencies already holding a slice in this request can't be picked twice.
  const usedIds = new Set(slices.map(s => s.agencyId))
  const eligible = agencies
    .filter(a => !usedIds.has(a.id) && (a.slots?.remaining ?? 0) > 0)
    .map(a => ({
      ...a,
      matches: (a.assistanceTypes ?? []).includes(request.assistanceType),
    }))
    .sort((a, b) => (b.matches ? 1 : 0) - (a.matches ? 1 : 0) || a.name.localeCompare(b.name))

  const agency = agencies.find(a => a.id === agencyId)
  const amt    = Number(amount) || 0

  const handleEndorse = async () => {
    if (saving) return
    if (!agency)              { toast.error('Select an agency to endorse to.'); return }
    if (amt <= 0)             { toast.error('Enter an amount greater than zero.'); return }
    if (amt > liveHeadroom)   { toast.error(`Amount exceeds the remaining balance (${peso(liveHeadroom)}).`); return }

    setSaving(true)
    try {
      await runTransaction(db, async (tx) => {
        const agencyRef = doc(db, 'agencies', agency.id)
        const reqRef    = doc(db, 'requests', request.id)
        const aSnap = await tx.get(agencyRef)
        const rSnap = await tx.get(reqRef)
        if (!aSnap.exists() || !rSnap.exists()) throw new Error('GONE')
        const remaining = aSnap.data()?.slots?.remaining ?? 0
        if (remaining <= 0) throw new Error('NO_SLOTS')

        const r = rSnap.data()
        const committedSoFar = (r.amountCommitted ?? 0)
        // Backstop cap: never endorse past (needed − committed). The modal
        // already applies the tighter slices-aware headroom; this transaction
        // check guards against two concurrent endorsements over-committing.
        const room = (r.amountNeeded ?? 0) - committedSoFar
        if (amt > room) throw new Error('OVER_BALANCE')

        const sliceRef = doc(collection(db, 'applications'))
        tx.set(sliceRef, {
          appId:             newAppId(),
          requestId:         request.id,
          amountRequested:   amt,
          amountApproved:    0,
          patientId:         r.patientId,
          patientName:       r.patientName ?? '',
          patientContact:    r.patientContact ?? '',
          patientAddress:    r.patientAddress ?? '',
          patientHospitalId: r.patientHospitalId ?? null,
          agencyId:          agency.id,
          agencyName:        agency.name,
          agencyColor:       agency.color ?? 'bg-gray-500',
          agencyInitials:    agency.initials ?? agency.name?.slice(0, 2).toUpperCase(),
          assistanceType:    r.assistanceType ?? '',
          // 'endorsed' = awaiting the patient to review the coverage plan and
          // Proceed. The agency only sees / acts on it once the patient
          // proceeds (slice -> reviewing).
          status:            'endorsed',
          submittedAt:       serverTimestamp(),
          updatedAt:         serverTimestamp(),
          attachedDocuments: r.attachedDocuments ?? [],
          endorsedById:      user.uid,
          endorsedBy:        user.name ?? 'CRMC',
          endorsedAt:        serverTimestamp(),
          stages:            sliceStages(),
        })

        tx.update(reqRef, {
          agencyIds: arrayUnion(agency.id),
          status:    'endorsed',
          updatedAt: serverTimestamp(),
        })
        tx.update(agencyRef, { 'slots.remaining': remaining - 1 })
      })

      logAudit(user, {
        action: 'request_endorsed', targetType: 'request', targetId: request.id,
        targetName: request.requestId,
        details: `Endorsed ${peso(amt)} to ${agency.name}`,
      })

      // Notify the patient to review the coverage plan and proceed. The
      // agency is only notified when the patient proceeds (accepts the plan).
      notify(request.patientId, {
        type:  'app_advanced',
        title: 'Your request was endorsed',
        body:  `CRMC endorsed ${peso(amt)} of your request to ${agency.name}. Review your coverage plan and proceed to submit it.`,
      }).catch(() => {})

      toast.success(`Endorsed ${peso(amt)} to ${agency.name}.`)
      onClose()
    } catch (err) {
      const m = String(err.message)
      if (m === 'NO_SLOTS')         toast.error('That agency has no slots remaining today.')
      else if (m === 'OVER_BALANCE') toast.error('Amount exceeds the remaining balance.')
      else if (m === 'GONE')         toast.error('Request or agency no longer exists.')
      else { console.error('[endorse]', err); toast.error('Failed to endorse. Please try again.') }
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-end sm:items-center justify-center sm:p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Endorse to an agency</h2>
            <p className="text-xs text-gray-400 mt-0.5">{request.patientName} · {request.requestId}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-3 gap-2 text-center">
            <div><p className="text-xs text-gray-400">Needed</p><p className="text-sm font-semibold text-gray-800">{peso(request.amountNeeded)}</p></div>
            <div><p className="text-xs text-gray-400">Secured</p><p className="text-sm font-semibold text-green-600">{peso(committed)}</p></div>
            <div><p className="text-xs text-gray-400">Endorsable</p><p className="text-sm font-semibold text-brand-600">{peso(liveHeadroom)}</p></div>
          </div>

          {liveHeadroom <= 0 ? (
            <div className="bg-green-50 border border-green-100 rounded-xl p-3 text-sm text-green-700 flex items-start gap-2">
              <MdCheckCircle size={16} className="flex-shrink-0 mt-0.5" />
              The full amount is already committed or endorsed. Nothing left to endorse.
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Agency <span className="text-red-400">*</span></label>
                <select className={`input ${!agencyId ? 'text-gray-400' : ''}`} value={agencyId} onChange={e => setAgencyId(e.target.value)}>
                  <option value="">Select an agency</option>
                  {eligible.map(a => {
                    const rem = Math.max(0, (a.budget?.allocated ?? 0) - (a.budget?.committed ?? 0))
                    const budgetTxt = (a.budget?.allocated ?? 0) > 0 ? ` · ${peso(rem)} budget` : ''
                    return (
                      <option key={a.id} value={a.id}>
                        {a.name}{a.matches ? ' ✓' : ''} · {a.slots?.remaining ?? 0} slots{budgetTxt}
                      </option>
                    )
                  })}
                </select>
                {eligible.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">No eligible agencies (need open slots and not already endorsed).</p>
                )}
                {agency && (() => {
                  const alloc = agency.budget?.allocated ?? 0
                  const rem   = Math.max(0, alloc - (agency.budget?.committed ?? 0))
                  return (
                    <p className="text-xs text-gray-500 mt-1">
                      {agency.slots?.remaining ?? 0} slots open · {alloc > 0 ? `${peso(rem)} budget remaining` : 'No budget cap set'}
                      {alloc > 0 && amt > rem && <span className="text-amber-600"> — amount exceeds this agency's remaining budget</span>}
                    </p>
                  )
                })()}
                {agency && !agency.assistanceTypes?.includes(request.assistanceType) && (
                  <p className="text-xs text-amber-600 mt-1 flex items-start gap-1">
                    <MdWarning size={12} className="flex-shrink-0 mt-0.5" />
                    This agency doesn't list "{request.assistanceType}" — endorse only if appropriate.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Amount to cover <span className="text-red-400">*</span></label>
                <input type="number" min="0" max={liveHeadroom} inputMode="numeric" className="input"
                  value={amount} onChange={e => setAmount(e.target.value)} />
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-gray-400">Max {peso(liveHeadroom)} (remaining balance)</p>
                  <button type="button" className="text-xs text-brand-600 font-medium hover:underline"
                    onClick={() => setAmount(String(liveHeadroom))}>Use full balance</button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-5 pb-4 pt-2 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm flex items-center gap-1.5" onClick={handleEndorse}
            disabled={saving || liveHeadroom <= 0 || !agencyId || amt <= 0}>
            <MdSend size={14} /> {saving ? 'Endorsing…' : 'Endorse'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Request detail modal ─────────────────────────────────────────────────────

function RequestDetail({ request, agencies, onClose }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [slices, setSlices] = useState([])
  const [messagingPatient, setMessagingPatient] = useState(false)
  const [patientDocs, setPatientDocs] = useState([])
  const [viewingDoc, setViewingDoc] = useState(null)
  const [showEndorse, setShowEndorse] = useState(false)
  const [showInterview, setShowInterview] = useState(false)
  const [outcomeNotes, setOutcomeNotes] = useState('')
  const [busy, setBusy] = useState(false)

  // Open (or create) a conversation with the patient and jump to Messages.
  // Used for the stale-endorsement nudge so CRMC can poke the patient without
  // hunting through the conversation list.
  const handleMessagePatient = async (subjectHint) => {
    if (messagingPatient) return
    setMessagingPatient(true)
    try {
      const convId = await getOrCreateConversation(user.uid, request.patientId, {
        names:   { [user.uid]: user.name, [request.patientId]: request.patientName },
        roles:   { [user.uid]: user.role, [request.patientId]: 'patient' },
        subject: subjectHint ?? `Re: Request ${request.requestId}`,
      })
      navigate(`/admin/messages?conv=${convId}`)
    } catch {
      toast.error('Could not open conversation. Please try again.')
    } finally {
      setMessagingPatient(false)
    }
  }

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'applications'), where('requestId', '==', request.id)),
      snap => setSlices(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    )
    return unsub
  }, [request.id])

  // Live patient documents — drives the verification panel's current status.
  useEffect(() => {
    if (!request.patientId) return
    const unsub = onSnapshot(
      query(collection(db, 'documents'), where('patientId', '==', request.patientId)),
      snap => setPatientDocs(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    )
    return unsub
  }, [request.patientId])

  const funding = computeFunding(request.amountNeeded, slices)
  const cfg = REQUEST_STATUS_CONFIG[request.status] ?? REQUEST_STATUS_CONFIG.submitted
  const terminal = ['fully_funded', 'closed', 'rejected'].includes(request.status)

  // The documents attached to this request, with their live status/OCR merged
  // in (falls back to the request snapshot if a live doc isn't found).
  const docById = Object.fromEntries(patientDocs.map(d => [d.id, d]))
  const reqDocs = (request.attachedDocuments ?? []).map(a => ({
    ...a, ...(docById[a.documentId] ?? {}), id: a.documentId,
  }))
  const allVerified = reqDocs.length > 0 && reqDocs.every(d => d.status === 'verified')
  const intakeComplete = isIntakeComplete(request.intakeSheet)
  // The guided stepper gate: endorsement is only allowed after every document
  // is verified AND the assessment is done (interview outcome recorded + the
  // Unified Intake Sheet completed).
  const canEndorse = allVerified && !!request.interviewOutcome && intakeComplete

  // Verify / reject a document. First action also moves the request out of
  // 'submitted' into 'under_review'. Rejection notifies the patient to re-upload.
  const reviewDoc = async (docItem, newStatus) => {
    setBusy(true)
    try {
      await updateDoc(doc(db, 'documents', docItem.id), {
        status: newStatus, reviewedBy: user.name ?? 'CRMC', reviewedAt: serverTimestamp(),
      })
      const updatedAttached = (request.attachedDocuments ?? []).map(a =>
        a.documentId === docItem.id ? { ...a, status: newStatus } : a)
      await updateDoc(doc(db, 'requests', request.id), {
        attachedDocuments: updatedAttached,
        ...(request.status === 'submitted' ? { status: 'under_review' } : {}),
        updatedAt: serverTimestamp(),
      })
      logAudit(user, {
        action: newStatus === 'verified' ? 'doc_verified' : 'doc_rejected',
        targetType: 'document', targetId: docItem.id, targetName: docItem.name,
        details: `Request ${request.requestId}`,
      })
      if (newStatus === 'rejected') {
        await notify(request.patientId, {
          type:  'doc_rejected',
          title: 'A document needs attention',
          body:  `CRMC marked your "${docItem.name}" document for correction. Please re-upload it.`,
        }).catch(() => {})
      }
      toast.success(newStatus === 'verified' ? 'Document verified.' : 'Document marked for re-upload.')
    } catch (err) {
      console.error('[Requests] doc review error:', err)
      toast.error('Failed to update document.')
    } finally { setBusy(false) }
  }

  // ② Assessment — schedule the single CRMC interview on the request, and
  // record its outcome. Scheduling advances the request to 'assessment'.
  const scheduleInterview = async (form) => {
    setBusy(true)
    try {
      await updateDoc(doc(db, 'requests', request.id), {
        interviewDate: form.date,
        interviewTime: form.time,
        meetLink:      form.link,
        conductedBy:   form.conductedBy.trim(),
        interviewOutcome: null,
        status:        'assessment',
        updatedAt:     serverTimestamp(),
      })
      logAudit(user, { action: 'interview_scheduled', targetType: 'request', targetId: request.id, targetName: request.requestId, details: `${form.date} ${form.time}` })
      await notify(request.patientId, {
        type:  'interview_sched',
        title: 'Assessment interview scheduled',
        body:  `CRMC scheduled your assessment interview on ${form.date} at ${form.time}. Join via the Google Meet link in your dashboard.`,
      }).catch(() => {})
      toast.success('Interview scheduled.')
      setShowInterview(false)
    } catch { toast.error('Failed to schedule interview.') }
    finally { setBusy(false) }
  }

  const recordOutcome = async (outcome) => {
    setBusy(true)
    try {
      await updateDoc(doc(db, 'requests', request.id), {
        interviewOutcome: outcome,
        interviewNotes:   outcomeNotes.trim() || null,
        updatedAt:        serverTimestamp(),
      })
      logAudit(user, { action: 'interview_completed', targetType: 'request', targetId: request.id, targetName: request.requestId, details: `Outcome: ${outcome}` })
      toast.success('Interview outcome recorded.')
    } catch { toast.error('Failed to record outcome.') }
    finally { setBusy(false) }
  }

  const setRequestStatus = async (status, { reason } = {}) => {
    setBusy(true)
    try {
      await runTransaction(db, async (tx) => {
        const reqRef = doc(db, 'requests', request.id)
        tx.update(reqRef, {
          status,
          ...(reason ? { closeReason: reason } : {}),
          updatedAt: serverTimestamp(),
        })
      })
      logAudit(user, {
        action: status === 'rejected' ? 'request_rejected' : 'request_closed',
        targetType: 'request', targetId: request.id, targetName: request.requestId,
        details: reason ?? status,
      })
      await notify(request.patientId, {
        type:  'app_advanced',
        title: status === 'rejected' ? 'Request not approved' : 'Request closed',
        body:  reason || (status === 'rejected'
          ? 'Your assistance request was not approved.'
          : 'Your assistance request was closed.'),
      }).catch(() => {})
      toast.success(status === 'rejected' ? 'Request rejected.' : 'Request closed.')
      onClose()
    } catch { toast.error('Failed to update request.') }
    finally { setBusy(false) }
  }

  return (
    <div>
      {/* Sub-header — back to the list + request summary (stays inside the
          app shell so the CRMC nav/top bar remain available). */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onClose} className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-brand-600 flex-shrink-0">
            <MdArrowBack size={16} /> Requests
          </button>
          <span className="text-gray-300">/</span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 truncate">{request.patientName}</h2>
            <p className="text-xs text-gray-400">{request.requestId} · {request.assistanceType}</p>
          </div>
        </div>
        <span className={`badge text-xs flex-shrink-0 ${cfg.badge}`}>{cfg.label}</span>
      </div>

      {/* Single-column review, left-aligned to match the sub-header.
          Documents open in a large viewer. */}
      <div className="max-w-4xl px-4 sm:px-6 py-5 space-y-4">
          {/* Summary — amount needed, funding progress, request meta */}
          <div className="card p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500">Amount needed <span className="text-gray-400">(verify vs. billing statement)</span></p>
              <p className="text-xl font-bold text-brand-700 whitespace-nowrap">{peso(request.amountNeeded)}</p>
            </div>

            <div>
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>{peso(funding.committed)} secured · {peso(funding.outstanding)} pending</span>
                <span>{peso(funding.balance)} remaining</span>
              </div>
              <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-green-400 rounded-full transition-all" style={{ width: `${funding.pct}%` }} />
              </div>
            </div>

            <div className="pt-3 border-t border-gray-50 space-y-1.5 text-xs text-gray-500">
              {request.description && (
                <p><span className="text-gray-400">Description: </span><span className="text-gray-600">{request.description}</span></p>
              )}
              <p className="flex items-center gap-1.5"><MdPerson size={13} className="text-gray-400 flex-shrink-0" /> {request.patientContact || 'No contact'} · {request.patientAddress || 'No address'}</p>
              <p className="flex items-center gap-1.5"><MdAttachFile size={13} className="text-gray-400 flex-shrink-0" /> submitted {fmtDate(request.submittedAt)}</p>
            </div>
          </div>

          {/* Filed by a representative — verify the rep's ID + selfie (below) */}
          {request.filedBy && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-800">
              <p className="font-semibold flex items-center gap-1.5"><MdPerson size={13} /> Filed by a representative</p>
              <p className="mt-0.5">{request.filedBy.name} · {request.filedBy.relationship}</p>
              <p className="text-amber-700/80 mt-0.5">Verify the representative's ID and selfie in the documents below.</p>
            </div>
          )}

          {/* ① Document verification */}
          <div className="card p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
                Verify documents
              </h3>
              {reqDocs.length > 0 && (
                <span className={`badge text-xs ${allVerified ? 'badge-green' : 'badge-amber'}`}>
                  {reqDocs.filter(d => d.status === 'verified').length}/{reqDocs.length} verified
                </span>
              )}
            </div>
            {reqDocs.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No documents attached.</p>
            ) : (
              <div className="space-y-2">
                {reqDocs.map(d => {
                  const dcfg = DOC_STATUS_CONFIG[d.status] ?? DOC_STATUS_CONFIG.pending
                  const showOcr = isIdType(d.documentTypeName ?? d.name) && (d.ocrMatch != null || d.ocrText)
                  return (
                    <div key={d.id} className="p-2.5 rounded-lg border border-gray-100">
                      <div className="flex items-center gap-2">
                        <MdDescription size={16} className="text-gray-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-700 truncate">{d.documentTypeName || d.name}</p>
                        </div>
                        <span className={`badge text-xs flex-shrink-0 ${dcfg.badge}`}>{dcfg.label}</span>
                        <button title="View" className="text-gray-400 hover:text-brand-600 flex-shrink-0"
                          onClick={() => !d._missing && setViewingDoc(d)}>
                          <MdVisibility size={16} />
                        </button>
                      </div>
                      {showOcr && (
                        <p className={`text-xs mt-1 pl-6 ${d.ocrMatch === true ? 'text-green-600' : d.ocrMatch === false ? 'text-amber-600' : 'text-gray-400'}`}>
                          {d.ocrMatch === true ? '✓ OCR: ID name matches the account'
                            : d.ocrMatch === false ? '⚠ OCR: name not auto-matched — verify manually'
                            : 'OCR: could not auto-read — verify manually'}
                        </p>
                      )}
                      {d.status !== 'verified' && (
                        <div className="flex gap-2 mt-2 pl-6">
                          <button className="text-xs font-medium text-green-600 hover:text-green-700 flex items-center gap-1 disabled:opacity-50"
                            disabled={busy} onClick={() => reviewDoc(d, 'verified')}>
                            <MdCheckCircle size={14} /> Verify
                          </button>
                          <button className="text-xs font-medium text-red-500 hover:text-red-600 flex items-center gap-1 disabled:opacity-50"
                            disabled={busy} onClick={() => reviewDoc(d, 'rejected')}>
                            <MdBlock size={14} /> Reject
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ② Interview & assessment */}
          <div className="card p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center flex-shrink-0">2</span>
                Interview &amp; assessment
              </h3>
              {request.interviewOutcome && (
                <span className="badge badge-green text-xs">Outcome recorded</span>
              )}
            </div>
            {/* Unified Intake Sheet — the structured case assessment */}
            <div className="flex items-center gap-2 p-2.5 rounded-lg border border-gray-100 mb-2">
              <MdAssignment size={16} className="text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700 truncate">Unified Intake Sheet</p>
              </div>
              <span className={`badge text-xs flex-shrink-0 ${intakeComplete ? 'badge-green' : 'badge-amber'}`}>
                {intakeComplete ? 'Complete' : 'Incomplete'}
              </span>
              <Link to={`/admin/requests/${request.id}/intake`}
                className="text-xs font-medium text-brand-600 hover:text-brand-700 flex-shrink-0">
                Open
              </Link>
            </div>
            {!request.interviewDate ? (
              <div className="p-3 rounded-lg border border-gray-100">
                {!allVerified
                  ? <p className="text-xs text-gray-400 italic">Verify all documents first, then schedule the assessment interview.</p>
                  : <p className="text-xs text-gray-500 mb-2">Documents verified. Schedule the assessment interview.</p>}
                <button className="btn-primary text-sm flex items-center gap-1.5 mt-1" disabled={!allVerified || busy}
                  onClick={() => setShowInterview(true)}>
                  <MdVideoCall size={14} /> Schedule interview
                </button>
              </div>
            ) : (
              <div className="p-3 rounded-lg border border-gray-100 space-y-2">
                <div className="text-xs text-gray-600 space-y-1">
                  <p><span className="text-gray-400">When:</span> {request.interviewDate} at {request.interviewTime}</p>
                  {request.conductedBy && <p><span className="text-gray-400">Conducted by:</span> {request.conductedBy}</p>}
                  {request.meetLink && <p className="truncate"><span className="text-gray-400">Meet:</span> <a href={request.meetLink} target="_blank" rel="noopener noreferrer" className="text-brand-500 hover:underline break-all">{request.meetLink}</a></p>}
                </div>
                {request.interviewOutcome ? (
                  <p className="text-xs text-gray-600"><span className="text-gray-400">Outcome:</span> <span className="font-medium">{request.interviewOutcome}</span>{request.interviewNotes ? ` — ${request.interviewNotes}` : ''}</p>
                ) : (
                  <div className="space-y-2">
                    <textarea className="input resize-none text-sm" rows={2} placeholder="Assessment notes (optional)…"
                      value={outcomeNotes} onChange={e => setOutcomeNotes(e.target.value)} maxLength={300} />
                    <div className="flex gap-2 flex-wrap">
                      <button className="text-xs font-medium text-green-600 hover:text-green-700 flex items-center gap-1 disabled:opacity-50"
                        disabled={busy} onClick={() => recordOutcome('completed')}>
                        <MdCheckCircle size={14} /> Completed
                      </button>
                      <button className="text-xs font-medium text-red-500 hover:text-red-600 flex items-center gap-1 disabled:opacity-50"
                        disabled={busy} onClick={() => recordOutcome('no_show')}>
                        <MdBlock size={14} /> No-show
                      </button>
                      <button className="text-xs font-medium text-amber-600 hover:text-amber-700 flex items-center gap-1 disabled:opacity-50"
                        disabled={busy} onClick={() => setShowInterview(true)}>
                        <MdEventRepeat size={14} /> Reschedule
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ③ Endorse — slices */}
          <div className="card p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2 mb-3">
              <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center flex-shrink-0">3</span>
              Endorsed agencies
            </h3>
            {slices.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Not yet endorsed to any agency.</p>
            ) : (
              <div className="space-y-2">
                {slices.map(s => {
                  // A slice stays in status 'endorsed' until the patient
                  // accepts the coverage plan (Proceed) and the slice flips
                  // to 'reviewing' on the agency side. If they sit on it,
                  // surface a nudge so CRMC can poke them.
                  const isEndorsed = s.status === 'endorsed'
                  const daysSinceEndorsed = isEndorsed && s.endorsedAt
                    ? Math.floor((Date.now() - (s.endorsedAt.toDate ? s.endorsedAt.toDate() : new Date(s.endorsedAt)).getTime()) / 86400000)
                    : null
                  const stale = daysSinceEndorsed != null && daysSinceEndorsed >= 3
                  return (
                    <div key={s.id} className={`flex items-start gap-3 p-2.5 rounded-lg border ${stale ? 'bg-amber-50 border-amber-200' : 'border-gray-100'}`}>
                      <div className={`w-8 h-8 ${s.agencyColor ?? 'bg-gray-400'} rounded-lg text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        {s.agencyInitials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{s.agencyName}</p>
                        <p className="text-xs text-gray-400">Asked {peso(s.amountRequested)}{s.amountApproved > 0 ? ` · approved ${peso(s.amountApproved)}` : ''}</p>
                        {stale && (
                          <div className="text-xs text-amber-700 mt-0.5">
                            <p>Awaiting patient acceptance · {daysSinceEndorsed}d.</p>
                            <button
                              type="button"
                              onClick={() => handleMessagePatient(`Reminder: please accept the endorsement to ${s.agencyName}`)}
                              disabled={messagingPatient}
                              className="mt-1 font-medium underline underline-offset-2 hover:text-amber-800 disabled:opacity-50">
                              Message patient →
                            </button>
                          </div>
                        )}
                      </div>
                      <span className={`badge text-xs flex-shrink-0 ${stale ? 'badge-amber' : 'badge-gray'}`}>
                        {stale ? 'Awaiting patient' : s.status}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Actions */}
          {!terminal && (
            <div className="card p-4">
              {!canEndorse && (
                <p className="text-xs text-amber-600 mb-2 flex items-center gap-1">
                  <MdWarning size={12} className="flex-shrink-0" />
                  Verify all documents, complete the intake sheet, and record the interview outcome before endorsing.
                </p>
              )}
              <div className="flex flex-wrap gap-2 justify-end">
                <button className="btn-secondary text-sm flex items-center gap-1.5 text-red-500"
                  disabled={busy}
                  onClick={() => { const r = window.prompt('Reason for rejecting this request? (shown to patient)'); if (r !== null) setRequestStatus('rejected', { reason: r || undefined }) }}>
                  <MdBlock size={14} /> Reject
                </button>
                {funding.committed > 0 && (
                  <button className="btn-secondary text-sm" disabled={busy}
                    onClick={() => { if (window.confirm('Close this request? No further endorsements. The patient keeps any issued Guarantee Letters.')) setRequestStatus('closed') }}>
                    Close (partial)
                  </button>
                )}
                <button className="btn-primary text-sm flex items-center gap-1.5" onClick={() => setShowEndorse(true)} disabled={busy || !canEndorse}>
                  <MdSend size={14} /> Endorse
                </button>
              </div>
            </div>
          )}
      </div>

      {viewingDoc && (
        <DocViewerModal docMeta={viewingDoc} onClose={() => setViewingDoc(null)} />
      )}
      {showEndorse && (
        <EndorseModal request={request} slices={slices} agencies={agencies} onClose={() => setShowEndorse(false)} />
      )}
      {showInterview && (
        <InterviewModal app={request} agency={null} onConfirm={scheduleInterview} onClose={() => setShowInterview(false)} />
      )}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function Requests() {
  const [requests, setRequests] = useState([])
  const [agencies, setAgencies] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState(null)
  const [search,   setSearch]   = useState('')
  const [filter,   setFilter]   = useState('all')

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'requests'), snap => {
      setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.submittedAt?.seconds ?? 0) - (a.submittedAt?.seconds ?? 0)))
      setLoading(false)
    }, () => setLoading(false))
    const u2 = onSnapshot(query(collection(db, 'agencies'), where('enabled', '==', true)),
      snap => setAgencies(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return () => { u1(); u2() }
  }, [])

  // Keep the open detail in sync with live request updates
  const selectedLive = selected ? requests.find(r => r.id === selected.id) ?? selected : null

  const GROUP = {
    needs:    ['submitted', 'under_review', 'assessment', 'verifying'],
    progress: ['endorsed', 'partially_funded', 'endorsing'],
    done:     ['fully_funded', 'closed', 'rejected'],
  }
  const counts = {
    all:      requests.length,
    needs:    requests.filter(r => GROUP.needs.includes(r.status)).length,
    progress: requests.filter(r => GROUP.progress.includes(r.status)).length,
    done:     requests.filter(r => GROUP.done.includes(r.status)).length,
  }
  const filtered = requests.filter(r => {
    if (filter !== 'all' && !GROUP[filter].includes(r.status)) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (r.patientName ?? '').toLowerCase().includes(q)
      || (r.requestId ?? '').toLowerCase().includes(q)
      || (r.assistanceType ?? '').toLowerCase().includes(q)
  })

  // Coarse pipeline stage for an at-a-glance chip (distinct from the status badge).
  const stageChip = (r) => {
    if (r.status === 'fully_funded')                          return { label: 'Funded',     cls: 'bg-green-100 text-green-700' }
    if (['closed', 'rejected'].includes(r.status))            return { label: 'Closed',     cls: 'bg-gray-100 text-gray-500' }
    if (GROUP.progress.includes(r.status))                    return { label: 'Endorsing',  cls: 'bg-purple-100 text-purple-700' }
    if (r.status === 'assessment')                            return { label: 'Assessment', cls: 'bg-amber-100 text-amber-700' }
    return { label: 'Verify docs', cls: 'bg-blue-100 text-blue-700' }
  }

  const FILTERS = [
    ['all', 'All'], ['needs', 'Needs action'], ['progress', 'In progress'], ['done', 'Completed'],
  ]

  if (selectedLive) {
    return (
      <Layout breadcrumb="Assistance Requests">
        <RequestDetail request={selectedLive} agencies={agencies} onClose={() => setSelected(null)} />
      </Layout>
    )
  }

  return (
    <Layout breadcrumb="Assistance Requests">
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <div className="mb-5">
          <h1 className="page-title flex items-center gap-2"><MdReceiptLong className="text-brand-500" size={22} /> Assistance Requests</h1>
          <p className="page-sub">Review patient requests, verify the bill, and endorse them to agencies toward zero balance.</p>
        </div>

        {/* Toolbar: search + status filter */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input className="input pl-9" placeholder="Search patient, request ID, or type…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-1 overflow-x-auto">
            {FILTERS.map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key)}
                className={`flex-shrink-0 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  filter === key ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                {label} <span className={filter === key ? 'text-white/70' : 'text-gray-300'}>({counts[key]})</span>
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="card p-4 space-y-2">
            {[1,2,3,4].map(i => <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : requests.length === 0 ? (
          <div className="card p-10 text-center">
            <MdLocalHospital size={32} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-600 mb-1">No assistance requests yet</p>
            <p className="text-xs text-gray-400">Patient requests will appear here for endorsement.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-10 text-center">
            <p className="text-sm text-gray-400">No requests match your search or filter.</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="card overflow-x-auto hidden sm:block">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Patient</th><th>Funding</th><th>Stage</th><th>Submitted</th><th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => {
                    const st          = stageChip(r)
                    const needsAction = GROUP.needs.includes(r.status)
                    const needed      = Number(r.amountNeeded) || 0
                    const secured     = Number(r.amountCommitted) || 0
                    const pct         = needed > 0 ? Math.min(100, Math.round((secured / needed) * 100)) : 0
                    return (
                      <tr key={r.id} className="cursor-pointer group" onClick={() => setSelected(r)}>
                        <td className={needsAction ? 'border-l-2 border-brand-400' : 'border-l-2 border-transparent'}>
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-brand-50 text-brand-600 border-2 border-brand-200 flex items-center justify-center text-xs font-bold flex-shrink-0">
                              {initials(r.patientName)}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-gray-800 truncate">{r.patientName}{r.filedBy && <span className="ml-1 text-xs text-amber-600">(rep)</span>}</p>
                              <p className="text-xs text-gray-400 truncate">{r.requestId} · {r.assistanceType}</p>
                            </div>
                          </div>
                        </td>
                        <td>
                          <p className="font-medium text-gray-800 whitespace-nowrap">{peso(needed)}</p>
                          <div className="w-28 h-1.5 bg-gray-100 rounded-full overflow-hidden my-1">
                            <div className="h-full bg-green-400 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <p className="text-xs text-gray-400 whitespace-nowrap">{peso(secured)} secured</p>
                        </td>
                        <td><span className={`inline-block whitespace-nowrap text-xs font-semibold px-2.5 py-0.5 rounded-full ${st.cls}`}>{st.label}</span></td>
                        <td className="text-xs text-gray-400 whitespace-nowrap">{fmtDate(r.submittedAt)}</td>
                        <td className="text-right"><span className="text-xs font-medium text-brand-600 group-hover:text-brand-700 whitespace-nowrap">Review →</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="grid grid-cols-1 gap-3 sm:hidden">
              {filtered.map(r => {
                const cfg = REQUEST_STATUS_CONFIG[r.status] ?? REQUEST_STATUS_CONFIG.submitted
                const st  = stageChip(r)
                return (
                  <button key={r.id} onClick={() => setSelected(r)} className="card p-4 text-left hover:shadow-md transition-all w-full">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm font-semibold text-gray-800 truncate">{r.patientName}{r.filedBy && <span className="ml-1 text-xs text-amber-600">(rep)</span>}</p>
                      <span className={`badge text-xs flex-shrink-0 ${cfg.badge}`}>{cfg.label}</span>
                    </div>
                    <p className="text-xs text-gray-400 mb-2">{r.requestId} · {r.assistanceType}</p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">Needs <span className="font-semibold text-gray-700">{peso(r.amountNeeded)}</span> · Secured <span className="font-semibold text-green-600">{peso(r.amountCommitted ?? 0)}</span></span>
                      <span className={`inline-block whitespace-nowrap text-xs font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
