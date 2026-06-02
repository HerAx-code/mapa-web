import { useState, useEffect, useMemo } from 'react'
import Layout from '../../components/Layout'
import {
  collection, query, where, onSnapshot, doc, getDoc, getDocs, updateDoc,
  serverTimestamp, runTransaction, arrayUnion, writeBatch,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import { logAudit } from '../../utils/auditLog'
import { computeFunding } from '../../utils/requests'
import { isIdType } from '../../utils/idOcr'
import { isIntakeComplete } from '../../utils/intakeSheet'
import { getOrCreateConversation } from '../../utils/messages'
import { tsToDate } from '../../utils/dates'
import { Link, useNavigate } from 'react-router-dom'
import DocViewerModal from '../../components/DocViewerModal'
import ConfirmModal from '../../components/ConfirmModal'
import StatusBadge from '../../components/ui/StatusBadge'
import InterviewModal from '../../components/InterviewModal'
import {
  MdClose, MdWarning, MdReceiptLong, MdLocalHospital, MdSend, MdCheck,
  MdPerson, MdAttachFile, MdBlock, MdCheckCircle, MdVisibility, MdDescription,
  MdVideoCall, MdEventRepeat, MdAssignment, MdArrowBack, MdSearch, MdRefresh,
} from 'react-icons/md'
import toast from 'react-hot-toast'

const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`

const initials = (name) =>
  (name ?? '').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '—'

const fmtDate = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
}

const newAppId = () => {
  const year   = new Date().getFullYear()
  const random = Math.random().toString(36).slice(2, 5).toUpperCase()
  return `APP-${year}-${String(Date.now()).slice(-6)}${random}`
}

// Patient/agency surfaces derive the slice stepper from `app.status` directly
// (see TrackStatus buildStages and the slice-specific 4-stage stepper). The
// `stages` array previously written here was dead data.

// ── Endorse modal ──────────────────────────────────────────────────────────

function EndorseModal({ request, slices, agencies, onClose }) {
  const { user } = useAuth()
  const { committed, headroom } = computeFunding(request.amountNeeded, slices)

  // Pure-selection model: CRMC nominates which agencies should look at this
  // case. No per-agency amounts. Each agency does its own case assessment
  // and decides their portion, capped by their per-applicant policy, their
  // budget headroom, and the live coverage of sibling slices visible on
  // their Application Detail page.
  //
  // Why no amounts here: CRMC's expertise is "who fits this patient" (slot
  // availability, assistance-type match, recent track record). The "how
  // much" question is the agency's case-by-case judgment, informed by
  // policy ceilings CRMC doesn't always know.
  const [selected, setSelected] = useState(() => new Set())
  const [notes,    setNotes]    = useState('')
  const [saving,   setSaving]   = useState(false)

  // R13: pre-endorse document existence check. The request snapshots
  // `attachedDocuments` at submission, but those Firestore docs can disappear
  // later (manual cleanup, account soft-delete, schema migrations). If we
  // endorse with stale refs, R8 keeps the transaction healthy but the agency
  // receives a slice with documents they can't actually open. Better to
  // surface the bad state here so CRMC can ask the patient to re-upload
  // before referring the case.
  const attachedIds = (request.attachedDocuments ?? [])
    .map(a => a?.documentId)
    .filter(Boolean)
  const [docCheck, setDocCheck] = useState({ loading: attachedIds.length > 0, missing: [] })

  useEffect(() => {
    let alive = true
    if (attachedIds.length === 0) {
      setDocCheck({ loading: false, missing: [] })
      return
    }
    ;(async () => {
      const results = await Promise.allSettled(
        attachedIds.map(id => getDoc(doc(db, 'documents', id)))
      )
      if (!alive) return
      const missing = []
      results.forEach((r, i) => {
        const id   = attachedIds[i]
        const name = request.attachedDocuments?.[i]?.name || id
        if (r.status === 'fulfilled' && !r.value.exists()) {
          missing.push({ id, name })
        }
        // Rejected reads (permission, network) aren't counted as missing —
        // we don't want to falsely accuse a doc that just wasn't readable.
      })
      setDocCheck({ loading: false, missing })
    })()
    return () => { alive = false }
    // attachedIds is derived from request.attachedDocuments; re-run only if
    // the request changes (modal re-opened on a different request).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id])

  // Agencies already holding a slice in this request can't be picked again;
  // sort matching-type agencies first, then alphabetically.
  const usedIds = new Set(slices.map(s => s.agencyId))
  const eligible = agencies
    .filter(a => !usedIds.has(a.id) && (a.slots?.remaining ?? 0) > 0)
    .map(a => ({
      ...a,
      matches: (a.assistanceTypes ?? []).includes(request.assistanceType),
    }))
    .sort((a, b) => (b.matches ? 1 : 0) - (a.matches ? 1 : 0) || a.name.localeCompare(b.name))

  const selectedCount = selected.size
  const canSubmit     = !saving && selectedCount > 0 && headroom > 0

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const clear = () => setSelected(new Set())

  const handleEndorse = async () => {
    if (!canSubmit) return
    setSaving(true)
    try {
      const selectedIds = [...selected]
      const notesValue  = notes.trim() || null
      // Slice's amountRequested = the full request total. Each agency may
      // approve up to that, but should coordinate with sibling slices
      // (visible to them on ApplicationDetail) so the patient isn't
      // over-funded. Real Philippine practice: agencies do their own case
      // assessment and approve what their policy allows; over-commitment
      // is rare at this scale and resolved manually.
      const sliceAmount = Number(request.amountNeeded) || 0

      // Captured inside the transaction, drained AFTER it commits via
      // best-effort per-doc updates. See R8 fix below for why this can't
      // live inside the runTransaction itself.
      const attachedDocsToStamp = []

      await runTransaction(db, async (tx) => {
        const reqRef = doc(db, 'requests', request.id)

        // ── All reads first ──
        const rSnap = await tx.get(reqRef)
        if (!rSnap.exists()) throw new Error('GONE')
        const agencyRefs  = selectedIds.map(id => doc(db, 'agencies', id))
        const agencySnaps = await Promise.all(agencyRefs.map(ref => tx.get(ref)))

        for (let i = 0; i < selectedIds.length; i++) {
          const snp = agencySnaps[i]
          if (!snp.exists()) throw new Error(`GONE:${selectedIds[i]}`)
          const remaining = snp.data()?.slots?.remaining ?? 0
          if (remaining <= 0) throw new Error(`NO_SLOTS:${selectedIds[i]}`)
        }

        const r = rSnap.data()

        // ── Writes ──
        tx.update(reqRef, {
          agencyIds: arrayUnion(...selectedIds),
          status:    'endorsed',
          updatedAt: serverTimestamp(),
        })

        for (let i = 0; i < selectedIds.length; i++) {
          const id        = selectedIds[i]
          const aData     = agencySnaps[i].data()
          const remaining = aData?.slots?.remaining ?? 0
          const sliceRef  = doc(collection(db, 'applications'))
          tx.set(sliceRef, {
            appId:             newAppId(),
            requestId:         request.id,
            amountRequested:   sliceAmount,
            amountApproved:    0,
            patientId:         r.patientId,
            patientName:       r.patientName ?? '',
            patientContact:    r.patientContact ?? '',
            patientAddress:    r.patientAddress ?? '',
            patientHospitalId: r.patientHospitalId ?? null,
            agencyId:          id,
            agencyName:        aData.name,
            agencyColor:       aData.color ?? 'bg-gray-500',
            agencyInitials:    aData.initials ?? aData.name?.slice(0, 2).toUpperCase(),
            assistanceType:    r.assistanceType ?? '',
            // 'endorsed' = awaiting the patient to review the coverage
            // plan and Proceed. The agency only sees / acts on it once the
            // patient proceeds (slice -> reviewing).
            status:            'endorsed',
            submittedAt:       serverTimestamp(),
            updatedAt:         serverTimestamp(),
            attachedDocuments: r.attachedDocuments ?? [],
            endorsedById:      user.uid,
            endorsedBy:        user.name ?? 'CRMC',
            endorsedAt:        serverTimestamp(),
            // Optional free-text note from CRMC, shown in the agency's
            // ApproveModal so the operator sees the referral context.
            crmcNotes:         notesValue,
          })
          tx.update(doc(db, 'agencies', id), {
            'slots.remaining': remaining - 1,
          })
        }

        // R8 fix (2026-06-03): the document agencyIds stamps used to live
        // INSIDE the transaction with tx.update(). Firestore's
        // transactional update requires every targeted doc to exist, so
        // a single stale `attachedDocuments` reference (patient deleted
        // a doc since request submission, document never made it past
        // upload retry, prod data cleanup, etc.) would fail the ENTIRE
        // endorsement with "No document to update" -- no slice created,
        // no slot decrement, nothing. The stamp is best-effort metadata
        // for the agency read rule; the slice's own agencyId field is
        // already authoritative for "this agency owns this slice." So
        // move the stamps to a post-transaction step where we can
        // tolerate missing docs.
        attachedDocsToStamp.push(...(r.attachedDocuments ?? [])
          .map(a => a?.documentId)
          .filter(Boolean))
      })

      // Best-effort post-step: stamp agencyIds[] on each attached
      // document. Per-doc try/catch so a missing reference (Firestore
      // returns 'not-found') just logs + skips instead of breaking the
      // run. The endorsement itself has already committed at this point.
      for (const docId of attachedDocsToStamp) {
        try {
          await updateDoc(doc(db, 'documents', docId), {
            agencyIds: arrayUnion(...selectedIds),
          })
        } catch (err) {
          if (err?.code === 'not-found') {
            console.warn('[endorse] document missing, skipping agencyIds stamp:', docId)
          } else {
            console.error('[endorse] document stamp failed:', docId, err)
          }
        }
      }

      // ── Post-transaction: audit + patient notification + UI ──
      const names = selectedIds
        .map(id => eligible.find(x => x.id === id)?.name ?? id)
        .join(', ')

      logAudit(user, {
        action: 'request_endorsed', targetType: 'request', targetId: request.id,
        targetName: request.requestId,
        details: `Endorsed to ${selectedCount} agenc${selectedCount === 1 ? 'y' : 'ies'}: ${names}`
          + (notesValue ? ` · note: ${notesValue}` : ''),
      })

      notify(request.patientId, {
        type:  'app_advanced',
        title: 'Your request was endorsed',
        body:  `CRMC referred your request to ${selectedCount} agenc${selectedCount === 1 ? 'y' : 'ies'} (${names}). Each will assess your case. Review your coverage plan and proceed.`,
      }).catch(() => {})

      toast.success(`Endorsed to ${selectedCount} agenc${selectedCount === 1 ? 'y' : 'ies'}.`)
      onClose()
    } catch (err) {
      const m = String(err.message)
      if (m.startsWith('NO_SLOTS:')) {
        const id = m.split(':')[1]
        const a  = eligible.find(x => x.id === id)
        toast.error(`${a?.name ?? 'An agency'} just ran out of slots. Unselect it and retry.`)
      } else if (m === 'GONE' || m.startsWith('GONE:')) {
        toast.error('Request or agency no longer exists.')
      } else {
        console.error('[endorse-select]', err)
        toast.error('Failed to endorse. Please try again.')
      }
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-end sm:items-center justify-center sm:p-4"
      onClick={e => e.target === e.currentTarget && !saving && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Endorse to agencies</h2>
            <p className="text-xs text-gray-400 mt-0.5">{request.patientName} · {request.requestId}</p>
          </div>
          <button onClick={onClose} disabled={saving}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"><MdClose size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Funding summary */}
          <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-3 gap-2 text-center">
            <div><p className="text-xs text-gray-400">Needed</p><p className="text-sm font-semibold text-gray-800">{peso(request.amountNeeded)}</p></div>
            <div><p className="text-xs text-gray-400">Secured</p><p className="text-sm font-semibold text-green-600">{peso(committed)}</p></div>
            <div><p className="text-xs text-gray-400">Endorsable</p><p className="text-sm font-semibold text-brand-600">{peso(headroom)}</p></div>
          </div>

          {/* R13: missing-document warning. Banner color escalates with severity. */}
          {!docCheck.loading && docCheck.missing.length > 0 && (
            <div
              role="alert"
              className={`rounded-xl border p-3 text-sm flex items-start gap-2 ${
                docCheck.missing.length === attachedIds.length
                  ? 'bg-red-50 border-red-200 text-red-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              <MdWarning size={18} className="flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-medium">
                  {docCheck.missing.length === attachedIds.length
                    ? 'All attached documents are missing'
                    : `${docCheck.missing.length} of ${attachedIds.length} attached document${attachedIds.length === 1 ? '' : 's'} missing`}
                </p>
                <p className="text-xs mt-1 leading-relaxed">
                  The receiving agenc{docCheck.missing.length === 1 ? 'y' : 'ies'} won't be able to open {docCheck.missing.length === attachedIds.length ? 'any' : 'these'} document{docCheck.missing.length === 1 ? '' : 's'}.
                  Consider asking the patient to re-upload before endorsing.
                </p>
                <details className="mt-1.5">
                  <summary className="text-xs cursor-pointer underline-offset-2 hover:underline">
                    Show missing ({docCheck.missing.length})
                  </summary>
                  <ul className="mt-1.5 ml-1 text-xs space-y-0.5 list-disc list-inside">
                    {docCheck.missing.map(d => (
                      <li key={d.id} className="break-words">{d.name}</li>
                    ))}
                  </ul>
                </details>
              </div>
            </div>
          )}

          {headroom <= 0 ? (
            <div className="bg-green-50 border border-green-100 rounded-xl p-3 text-sm text-green-700 flex items-start gap-2">
              <MdCheckCircle size={16} className="flex-shrink-0 mt-0.5" />
              The full amount is already committed or endorsed. Nothing left to endorse.
            </div>
          ) : eligible.length === 0 ? (
            <p className="text-xs text-amber-600">No eligible agencies (need open slots and not already endorsed for this request).</p>
          ) : (
            <>
              {/* Header + helpers */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs text-gray-500">
                  {selectedCount === 0
                    ? <>Select agencies to refer this case to.</>
                    : <>Endorsing to <span className="font-bold text-gray-900">{selectedCount}</span> {selectedCount === 1 ? 'agency' : 'agencies'} for <span className="font-bold text-gray-900">{peso(headroom)}</span> needed.</>}
                </p>
                {selectedCount > 0 && (
                  <button type="button" className="text-xs text-gray-500 font-medium hover:underline" onClick={clear}>
                    Clear
                  </button>
                )}
              </div>

              {/* Agency list — click-to-toggle. Each row's visible state
                  (background + check mark) reflects whether it's selected. */}
              <div className="space-y-2">
                {eligible.map(a => {
                  const isSelected = selected.has(a.id)
                  const alloc      = a.budget?.allocated ?? 0
                  const rem        = Math.max(0, alloc - (a.budget?.committed ?? 0))
                  const budgetTxt  = alloc > 0 ? `${peso(rem)} budget` : 'no budget cap'
                  const perCap     = Number(a.maxPerApplicant) || 0
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => !saving && toggle(a.id)}
                      disabled={saving}
                      className={`w-full text-left rounded-xl border p-3 transition-colors ${
                        isSelected
                          ? 'bg-brand-50 border-brand-300'
                          : 'border-gray-200 hover:border-gray-300'
                      } disabled:opacity-60`}>
                      <div className="flex items-start gap-3">
                        <div className={`w-9 h-9 ${a.color ?? 'bg-gray-400'} rounded-lg text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}>
                          {a.initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-1.5 flex-wrap">
                            <p className="text-sm font-medium text-gray-800 truncate">{a.name}</p>
                            {a.matches && <span className="text-[10px] text-green-700 bg-green-100 px-1.5 py-0.5 rounded font-medium">Best fit</span>}
                            {!a.matches && (
                              <span className="text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded font-medium" title={`Does not list "${request.assistanceType}"`}>
                                Type mismatch
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400">
                            {a.slots?.remaining ?? 0} slots · {budgetTxt}
                            {perCap > 0 && <> · max {peso(perCap)}/applicant</>}
                          </p>
                        </div>
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          isSelected
                            ? 'bg-brand-500 border-brand-500 text-white'
                            : 'border-gray-300 bg-white'
                        }`}>
                          {isSelected && <MdCheck size={14} />}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Optional notes — shown to agencies in their ApproveModal */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Notes for the agencies <span className="text-gray-400 font-normal">— optional</span>
                </label>
                <textarea
                  className="input resize-none text-sm"
                  rows={2}
                  maxLength={400}
                  placeholder="e.g. urgent surgery scheduled Friday; family already raised ₱5K out of pocket"
                  value={notes}
                  disabled={saving}
                  onChange={e => setNotes(e.target.value)}
                />
                <p className="text-xs text-gray-400 mt-0.5">
                  Shown to each agency's coordinator when they open the Approve dialog. Doesn't enforce anything — just communicates context.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="px-5 pb-4 pt-2 flex gap-2 justify-end border-t border-gray-50 sticky bottom-0 bg-white">
          <button className="btn-secondary text-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary text-sm flex items-center gap-1.5" onClick={handleEndorse}
            disabled={!canSubmit}>
            <MdSend size={14} /> {saving
              ? 'Endorsing…'
              : selectedCount > 0
                ? `Endorse to ${selectedCount} ${selectedCount === 1 ? 'agency' : 'agencies'}`
                : 'Endorse'}
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
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [showCloseModal, setShowCloseModal]   = useState(false)
  // Which document is being rejected (drives the doc-reject ConfirmModal). The
  // patient gets the reason in the in-app notification + email so they know
  // what to fix on the re-upload.
  const [rejectingDoc, setRejectingDoc]       = useState(null)
  // Which document is being reset to Pending (un-verify or un-reject). Wrapped
  // in a confirm step so the operator doesn't fat-finger their way out of a
  // legitimate decision -- this action exists for accident recovery, not for
  // routine flow.
  const [unverifyingDoc, setUnverifyingDoc]   = useState(null)
  const [outcomeNotes, setOutcomeNotes] = useState('')
  const [busy, setBusy] = useState(false)
  // Per-doc OCR-text expander state. When a doc's OCR verdict is "no match"
  // or "could not auto-read", the verifier needs to see WHAT OCR actually
  // read to judge whether the failure is an OCR misread, a patient-side
  // name mistype, or a genuinely wrong ID. Set of document ids that are
  // currently expanded.
  const [ocrExpanded, setOcrExpanded] = useState(() => new Set())
  const toggleOcrExpanded = (docId) => setOcrExpanded(prev => {
    const next = new Set(prev)
    next.has(docId) ? next.delete(docId) : next.add(docId)
    return next
  })

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

  // Verify / reject / un-verify a document. First verify or reject also
  // moves the request out of 'submitted' into 'under_review'. Rejection
  // notifies the patient to re-upload and includes the operator's reason
  // so the patient knows exactly what to fix. 'pending' is the un-verify
  // (operator correction) path -- clears reviewer/reason and skips the
  // patient notification (they were never told about the prior decision).
  const reviewDoc = async (docItem, newStatus, reason = null) => {
    setBusy(true)
    try {
      const cleanReason = (reason ?? '').trim() || null
      const isPending = newStatus === 'pending'
      await updateDoc(doc(db, 'documents', docItem.id), {
        status: newStatus,
        reviewedBy: isPending ? null : (user.name ?? 'CRMC'),
        reviewedAt: isPending ? null : serverTimestamp(),
        // Persist the rejection reason so the doc viewer / audit trail
        // can surface it. Clear it on re-verify or un-verify.
        rejectionReason: newStatus === 'rejected' ? cleanReason : null,
      })
      const updatedAttached = (request.attachedDocuments ?? []).map(a =>
        a.documentId === docItem.id ? { ...a, status: newStatus } : a)
      await updateDoc(doc(db, 'requests', request.id), {
        attachedDocuments: updatedAttached,
        ...(request.status === 'submitted' && !isPending ? { status: 'under_review' } : {}),
        updatedAt: serverTimestamp(),
      })
      logAudit(user, {
        action: newStatus === 'verified' ? 'doc_verified'
              : newStatus === 'rejected' ? 'doc_rejected'
              : 'doc_unverified',
        targetType: 'document', targetId: docItem.id, targetName: docItem.name,
        details: `Request ${request.requestId}` + (cleanReason ? ` · reason: ${cleanReason}` : ''),
      })
      if (newStatus === 'rejected') {
        await notify(request.patientId, {
          type:  'doc_rejected',
          title: 'A document needs attention',
          body:  `CRMC marked your "${docItem.name}" document for correction. Please re-upload it.`
            + (cleanReason ? ` Reason: ${cleanReason}` : ''),
        }).catch(() => {})
      }
      toast.success(
        newStatus === 'verified' ? 'Document verified.'
        : newStatus === 'rejected' ? 'Document marked for re-upload.'
        : 'Document reset to Pending.'
      )
    } catch (err) {
      console.error('[Requests] doc review error:', err)
      toast.error('Failed to update document.')
    } finally { setBusy(false) }
  }

  // Bulk-verify every pending doc on this request in a single Firestore batch.
  // Saves clicks on the common case where the operator has read all the docs
  // and they all look fine. Only the safe (verified) direction is bulked --
  // rejection stays per-doc because it requires a reason and notifies the
  // patient, both of which need individual judgment.
  const bulkVerifyPending = async (pendingDocs) => {
    if (!pendingDocs?.length) return
    setBusy(true)
    try {
      const batch = writeBatch(db)
      const now = serverTimestamp()
      const reviewer = user.name ?? 'CRMC'
      pendingDocs.forEach(d => {
        batch.update(doc(db, 'documents', d.id), {
          status: 'verified',
          reviewedBy: reviewer,
          reviewedAt: now,
          rejectionReason: null,
        })
      })
      const pendingIds = new Set(pendingDocs.map(d => d.id))
      const updatedAttached = (request.attachedDocuments ?? []).map(a =>
        pendingIds.has(a.documentId) ? { ...a, status: 'verified' } : a)
      batch.update(doc(db, 'requests', request.id), {
        attachedDocuments: updatedAttached,
        ...(request.status === 'submitted' ? { status: 'under_review' } : {}),
        updatedAt: now,
      })
      await batch.commit()
      // Audit entries fan out after the batch commits -- logAudit writes are
      // best-effort and shouldn't block or roll back a successful bulk verify.
      pendingDocs.forEach(d => {
        logAudit(user, {
          action: 'doc_verified',
          targetType: 'document', targetId: d.id, targetName: d.name,
          details: `Request ${request.requestId} · bulk verify`,
        })
      })
      toast.success(`Verified ${pendingDocs.length} document${pendingDocs.length === 1 ? '' : 's'}.`)
    } catch (err) {
      console.error('[Requests] bulk verify error:', err)
      toast.error('Failed to bulk verify documents.')
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
    } catch (err) { console.error(err); toast.error('Failed to schedule interview.') }
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
    } catch (err) { console.error(err); toast.error('Failed to record outcome.') }
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
    } catch (err) { console.error(err); toast.error('Failed to update request.') }
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
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Always-on Message Patient affordance -- the stale-endorsement
              nudge below only fires once a slice has been endorsed and the
              patient has sat on it. Operators need to reach the patient
              earlier too (doc clarifications, intake follow-ups). */}
          <button onClick={() => handleMessagePatient()} disabled={messagingPatient}
            title="Message patient"
            className="btn-secondary text-xs py-1.5 px-2.5 flex items-center gap-1.5 disabled:opacity-50">
            <MdSend size={13} /> Message
          </button>
          <StatusBadge status={request.status} kind="request" />
        </div>
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
                <p><span className="text-gray-400">Description: </span><span className="text-gray-600 whitespace-pre-wrap">{request.description}</span></p>
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
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
                Verify documents
              </h3>
              <div className="flex items-center gap-2">
                {(() => {
                  const pendingDocs = reqDocs.filter(d => d.status === 'pending' && !d._missing)
                  if (pendingDocs.length < 2) return null
                  return (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => bulkVerifyPending(pendingDocs)}
                      className="text-xs font-medium text-green-700 hover:text-green-800 inline-flex items-center gap-1 disabled:opacity-50"
                      title="Mark every Pending document on this request as Verified">
                      <MdCheckCircle size={14} /> Verify all pending ({pendingDocs.length})
                    </button>
                  )
                })()}
                {reqDocs.length > 0 && (
                  <span className={`badge text-xs ${allVerified ? 'badge-green' : 'badge-amber'}`}>
                    {reqDocs.filter(d => d.status === 'verified').length}/{reqDocs.length} verified
                  </span>
                )}
              </div>
            </div>
            {reqDocs.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No documents attached.</p>
            ) : (
              <div className="space-y-2">
                {reqDocs.map(d => {
                  const showOcr = isIdType(d.documentTypeName ?? d.name) && (d.ocrMatch != null || d.ocrText)
                  const reviewed = (d.status === 'verified' || d.status === 'rejected') && d.reviewedAt
                  return (
                    <div key={d.id} className="p-2.5 rounded-lg border border-gray-100">
                      <div className="flex items-center gap-2">
                        <MdDescription size={16} className="text-gray-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-700 truncate">{d.documentTypeName || d.name}</p>
                          {reviewed && (
                            <p className="text-xs text-gray-400 truncate">
                              {d.status === 'verified' ? 'Verified' : 'Rejected'} by {d.reviewedBy ?? 'CRMC'} · {fmtDate(d.reviewedAt)}
                            </p>
                          )}
                        </div>
                        <StatusBadge status={d.status ?? 'pending'} kind="doc" className="flex-shrink-0" />
                        <button title="View" className="text-gray-400 hover:text-brand-600 flex-shrink-0"
                          onClick={() => !d._missing && setViewingDoc(d)}>
                          <MdVisibility size={16} />
                        </button>
                      </div>
                      {showOcr && (
                        <div className="mt-1 pl-6">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`text-xs ${d.ocrMatch === true ? 'text-green-600' : d.ocrMatch === false ? 'text-amber-600' : 'text-gray-400'}`}>
                              {d.ocrMatch === true ? '✓ OCR: ID name matches the account'
                                : d.ocrMatch === false ? '⚠ OCR: name not auto-matched — verify manually'
                                : 'OCR: could not auto-read — verify manually'}
                            </p>
                            {/* Show-text toggle helps the verifier judge a no-match
                                verdict. Without seeing what OCR read, "no match"
                                is opaque -- could be misread, mistyped at
                                registration, or a wrong ID. */}
                            {d.ocrText && (
                              <button type="button"
                                onClick={() => toggleOcrExpanded(d.id)}
                                className="text-xs text-brand-500 hover:text-brand-600 font-medium underline underline-offset-2">
                                {ocrExpanded.has(d.id) ? 'Hide OCR text' : 'See what OCR read'}
                              </button>
                            )}
                          </div>
                          {ocrExpanded.has(d.id) && d.ocrText && (
                            <pre className="mt-1.5 max-h-40 overflow-auto bg-gray-50 border border-gray-100 rounded-lg p-2 text-xs text-gray-600 font-mono whitespace-pre-wrap break-words">
                              {d.ocrText}
                            </pre>
                          )}
                        </div>
                      )}
                      <div className="flex gap-2 mt-2 pl-6 flex-wrap">
                        {d.status !== 'verified' && (
                          <button className="text-xs font-medium text-green-600 hover:text-green-700 flex items-center gap-1 disabled:opacity-50"
                            disabled={busy} onClick={() => reviewDoc(d, 'verified')}>
                            <MdCheckCircle size={14} /> Verify
                          </button>
                        )}
                        {d.status !== 'verified' && d.status !== 'rejected' && (
                          <button className="text-xs font-medium text-red-500 hover:text-red-600 flex items-center gap-1 disabled:opacity-50"
                            disabled={busy} onClick={() => setRejectingDoc(d)}>
                            <MdBlock size={14} /> Reject
                          </button>
                        )}
                        {(d.status === 'verified' || d.status === 'rejected') && (
                          <button className="text-xs font-medium text-gray-500 hover:text-gray-700 flex items-center gap-1 disabled:opacity-50"
                            disabled={busy} onClick={() => setUnverifyingDoc(d)}
                            title="Mark this document as Pending review again">
                            <MdRefresh size={14} /> Reset to Pending
                          </button>
                        )}
                      </div>
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
                  <div className="text-xs text-gray-600">
                    <span className="text-gray-400">Outcome:</span> <span className="font-medium">{request.interviewOutcome}</span>
                    {request.interviewNotes && (
                      <p className="text-gray-600 whitespace-pre-wrap mt-0.5">{request.interviewNotes}</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <textarea className="input resize-none text-sm" rows={2} placeholder="Assessment notes (optional)…"
                      value={outcomeNotes} onChange={e => setOutcomeNotes(e.target.value)} maxLength={300} />
                    {/* Outcome buttons promoted from text-link styling --
                        Completed gates endorsement, No-show notifies the
                        patient. Both deserve real button affordance, not the
                        same visual weight as a "View Details" inline link.
                        Layout: Completed primary on the left (most common,
                        positive outcome), No-show as destructive secondary,
                        Reschedule as plain secondary. */}
                    <div className="flex gap-2 flex-wrap">
                      <button
                        disabled={busy}
                        onClick={() => recordOutcome('completed')}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 px-3 py-2 rounded-lg disabled:opacity-50 transition-colors">
                        <MdCheckCircle size={14} /> Completed
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => recordOutcome('no_show')}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 bg-white border border-red-200 hover:bg-red-50 px-3 py-2 rounded-lg disabled:opacity-50 transition-colors">
                        <MdBlock size={14} /> No-show
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => setShowInterview(true)}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg disabled:opacity-50 transition-colors">
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
                  const endorsedDate = isEndorsed ? tsToDate(s.endorsedAt) : null
                  const daysSinceEndorsed = endorsedDate
                    ? Math.floor((Date.now() - endorsedDate.getTime()) / 86400000)
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
                      {stale
                        ? <span className="badge text-xs flex-shrink-0 badge-amber">Awaiting patient</span>
                        : <StatusBadge status={s.status} kind="app" className="flex-shrink-0" />}
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
                  onClick={() => setShowRejectModal(true)}>
                  <MdBlock size={14} /> Reject
                </button>
                {funding.committed > 0 && (
                  <button className="btn-secondary text-sm" disabled={busy}
                    onClick={() => setShowCloseModal(true)}>
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

      <ConfirmModal
        open={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        onConfirm={async (reason) => {
          await setRequestStatus('rejected', { reason: reason || undefined })
          setShowRejectModal(false)
        }}
        title="Reject this request?"
        body="The patient will see the reason below. Use this only when the request can't move forward — e.g., the bill or the indigency situation doesn't meet criteria."
        tone="danger"
        confirmLabel="Reject Request"
        confirmLabelBusy="Rejecting…"
        withReason
        reasonPlaceholder="Reason (shown to patient)"
        reasonMaxLength={500}
      />

      <ConfirmModal
        open={showCloseModal}
        onClose={() => setShowCloseModal(false)}
        onConfirm={async () => {
          await setRequestStatus('closed')
          setShowCloseModal(false)
        }}
        title="Close this request?"
        body="No further endorsements can be made. The patient keeps any Guarantee Letters that were already issued. Use this when partial coverage is the final outcome."
        tone="warning"
        confirmLabel="Close Request"
        confirmLabelBusy="Closing…"
      />

      <ConfirmModal
        open={!!rejectingDoc}
        onClose={() => setRejectingDoc(null)}
        onConfirm={async (reason) => {
          if (rejectingDoc) await reviewDoc(rejectingDoc, 'rejected', reason)
          setRejectingDoc(null)
        }}
        title={rejectingDoc ? `Reject "${rejectingDoc.documentTypeName || rejectingDoc.name}"?` : 'Reject document?'}
        body="The patient will see your reason in the in-app notification and email, and can re-upload the document immediately."
        tone="danger"
        confirmLabel="Reject Document"
        confirmLabelBusy="Rejecting…"
        withReason
        reasonPlaceholder="e.g. ID photo is blurry — please re-take in good lighting"
        reasonMaxLength={300}
      />

      <ConfirmModal
        open={!!unverifyingDoc}
        onClose={() => setUnverifyingDoc(null)}
        onConfirm={async () => {
          if (unverifyingDoc) await reviewDoc(unverifyingDoc, 'pending')
          setUnverifyingDoc(null)
        }}
        title={unverifyingDoc ? `Reset "${unverifyingDoc.documentTypeName || unverifyingDoc.name}" to Pending?` : 'Reset document?'}
        body="Clears the verifier name and timestamp so the document is back in the unreviewed queue. The patient is not notified -- this action is meant for accident recovery (Verify or Reject clicked in error)."
        tone="warning"
        confirmLabel="Reset to Pending"
        confirmLabelBusy="Resetting…"
      />
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function Requests() {
  const [requests, setRequests] = useState([])
  const [agencies, setAgencies] = useState([])
  const [allSlices, setAllSlices] = useState([])
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
      snap => setAgencies(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => { console.error('[Requests] agencies snapshot error:', err); setAgencies([]) },
    )
    // Live slices, scoped to statuses that drive coverage warnings or the
    // funding bar (endorsed/reviewing/awaiting_info -> outstanding;
    // approved/certificate -> committed; rejected -> unfunded-balance flag).
    // Terminal slices that no longer contribute are filtered out so the
    // listener cost stays bounded as the dataset grows. Admin rule on
    // /applications/{id} allows isAdmin() -- see firestore.rules.
    const u3 = onSnapshot(
      query(collection(db, 'applications'), where('status', 'in',
        ['endorsed', 'reviewing', 'awaiting_info', 'approved', 'certificate', 'rejected'])),
      snap => setAllSlices(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => setAllSlices([]),
    )
    return () => { u1(); u2(); u3() }
  }, [])

  // Mirror trigger for the daily slot reset. The primary mechanism in the
  // pilot is the lazy check on agency/Dashboard.jsx, but if a CRMC operator
  // arrives before any agency user does, they'd see yesterday's remaining
  // counts when endorsing. This fires the same reset from the CRMC side so
  // the critical-path (Requests page) is guaranteed to see today's slots.
  //
  // Once the scheduled Cloud Function is deployable (project on Blaze), it
  // becomes the primary and both lazy paths are belt-and-suspenders.
  useEffect(() => {
    const ensureSlotReset = async () => {
      try {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
        const snap  = await getDocs(query(collection(db, 'agencies'), where('enabled', '==', true)))
        const batch = writeBatch(db)
        let resetCount = 0
        snap.docs.forEach(d => {
          const data = d.data()
          if (data.lastResetDate !== today && (data.slots?.total ?? 0) > 0) {
            batch.update(d.ref, {
              'slots.remaining': data.slots.total,
              lastResetDate:     today,
            })
            resetCount++
          }
        })
        if (resetCount > 0) await batch.commit()
      } catch (err) {
        // Best-effort: if the batch fails (rule denial, network), CRMC will
        // see slightly stale counts but endorsement still works.
        console.error('[Requests] daily slot reset check failed:', err)
      }
    }
    ensureSlotReset()
  }, [])

  // Group slices by requestId so each row in the list can look up its own
  // children without iterating the whole array per render.
  const slicesByRequest = useMemo(() => {
    const map = new Map()
    for (const s of allSlices) {
      if (!s.requestId) continue
      const arr = map.get(s.requestId)
      if (arr) arr.push(s); else map.set(s.requestId, [s])
    }
    return map
  }, [allSlices])

  // Single most-urgent coverage warning per request. Order: rejected with
  // remaining balance (CRMC must re-endorse) > stale endorsement (CRMC must
  // poke the patient). Both signal "CRMC has something to do here."
  const coverageWarning = (r) => {
    const slices = slicesByRequest.get(r.id) ?? []
    if (slices.length === 0) return null
    if (['fully_funded', 'closed'].includes(r.status)) return null
    // Derive from slices, not from r.amountCommitted -- the request doc field
    // can lag slice updates, the slice-derived figure is the source of truth.
    const { balance } = computeFunding(r.amountNeeded, slices)
    const rejected = slices.filter(s => s.status === 'rejected')
    if (rejected.length > 0 && balance > 0) {
      return {
        label: `${rejected.length} rejected · re-endorse`,
        cls:   'bg-red-100 text-red-700',
      }
    }
    const stale = slices.filter(s => {
      if (s.status !== 'endorsed') return false
      const t = tsToDate(s.endorsedAt)
      return t ? Math.floor((Date.now() - t.getTime()) / 86400000) >= 3 : false
    })
    if (stale.length > 0) {
      return {
        label: `${stale.length} awaiting patient`,
        cls:   'bg-amber-100 text-amber-700',
      }
    }
    return null
  }

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
            <button
              onClick={() => { setSearch(''); setFilter('all') }}
              className="mt-3 inline-flex items-center text-sm font-medium text-brand-500 hover:text-brand-600">
              Clear filters
            </button>
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
                    const funding     = computeFunding(needed, slicesByRequest.get(r.id) ?? [])
                    const warning     = coverageWarning(r)
                    // Invariant: status='fully_funded' should imply committed >= needed.
                    // A break in this contract is a data-state symptom (legacy seed
                    // data, manual write, a slice approval rolled back without
                    // adjusting the request status) and worth flagging for an
                    // operator to investigate -- the row otherwise looks like a
                    // successful funding.
                    const dataMismatch = r.status === 'fully_funded' && needed > 0 && funding.committed < needed
                    return (
                      <tr key={r.id} className="cursor-pointer group" onClick={() => setSelected(r)}>
                        <td className={needsAction || warning ? 'border-l-2 border-brand-400' : 'border-l-2 border-transparent'}>
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
                            <div className="h-full bg-green-400 rounded-full" style={{ width: `${funding.pct}%` }} />
                          </div>
                          <p className="text-xs text-gray-400 whitespace-nowrap">{peso(funding.committed)} secured</p>
                        </td>
                        <td>
                          <div className="flex flex-col items-start gap-1">
                            <span className={`inline-block whitespace-nowrap text-xs font-semibold px-2.5 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                            {warning && (
                              <span className={`inline-block whitespace-nowrap text-xs font-medium px-2 py-0.5 rounded ${warning.cls}`}>{warning.label}</span>
                            )}
                            {dataMismatch && (
                              <span
                                className="inline-block whitespace-nowrap text-xs font-medium px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
                                title={`Funded status but only ${peso(funding.committed)} of ${peso(needed)} is actually secured. Likely legacy data — investigate or re-derive.`}>
                                ⚠ data check
                              </span>
                            )}
                          </div>
                        </td>
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
                const st           = stageChip(r)
                const warning      = coverageWarning(r)
                const needed       = Number(r.amountNeeded) || 0
                const funding      = computeFunding(needed, slicesByRequest.get(r.id) ?? [])
                const dataMismatch = r.status === 'fully_funded' && needed > 0 && funding.committed < needed
                return (
                  <button key={r.id} onClick={() => setSelected(r)} className="card p-4 text-left hover:shadow-md transition-all w-full">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm font-semibold text-gray-800 truncate">{r.patientName}{r.filedBy && <span className="ml-1 text-xs text-amber-600">(rep)</span>}</p>
                      <StatusBadge status={r.status} kind="request" className="flex-shrink-0" />
                    </div>
                    <p className="text-xs text-gray-400 mb-2">{r.requestId} · {r.assistanceType}</p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">Needs <span className="font-semibold text-gray-700">{peso(needed)}</span> · Secured <span className="font-semibold text-green-600">{peso(funding.committed)}</span></span>
                      <span className={`inline-block whitespace-nowrap text-xs font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                    </div>
                    {warning && (
                      <div className="mt-2">
                        <span className={`inline-block whitespace-nowrap text-xs font-medium px-2 py-0.5 rounded ${warning.cls}`}>{warning.label}</span>
                      </div>
                    )}
                    {dataMismatch && (
                      <div className="mt-2">
                        <span className="inline-block whitespace-nowrap text-xs font-medium px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                          ⚠ data check — only {peso(funding.committed)} secured
                        </span>
                      </div>
                    )}
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
