import { useState, useEffect, useMemo } from 'react'
import Layout from '../../components/Layout'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import {
  collection, query, where, orderBy, limit, onSnapshot, doc, getDoc, getDocs, updateDoc,
  serverTimestamp, runTransaction, arrayUnion, writeBatch,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import { logAudit } from '../../utils/auditLog'
import { computeFunding, computeAmountNeeded } from '../../utils/requests'
import { deriveRequestStage } from '../../utils/requestStage'
import { coarseBucketOf, coarseCounts } from '../../utils/queueBuckets'
import { overdueCount, isOverdue, slaState, slaLabel, SLA_HOURS } from '../../utils/sla'
import QueueTabs from '../../components/admin/requests/QueueTabs'
import RequestsTable from '../../components/admin/requests/RequestsTable'
import BulkActionBar from '../../components/admin/requests/BulkActionBar'
import PathToZeroBalance from '../../components/admin/requests/PathToZeroBalance'
import RequestStageRail from '../../components/admin/RequestStageRail'
import VerifyDocsPanel from '../../components/admin/VerifyDocsPanel'
import { getOrCreateConversation } from '../../utils/messages'
import { tsToDate } from '../../utils/dates'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import DocViewerModal from '../../components/DocViewerModal'
import ConfirmModal from '../../components/ConfirmModal'
import StatusBadge from '../../components/ui/StatusBadge'
import InterviewModal from '../../components/InterviewModal'
import CaseTimeline from '../../components/CaseTimeline'
import {
  MdClose, MdWarning, MdReceiptLong, MdLocalHospital, MdSend, MdCheck,
  MdPerson, MdAttachFile, MdBlock, MdCheckCircle,
  MdVideoCall, MdEventRepeat, MdAssignment, MdArrowBack, MdSearch,
  MdGroups, MdThumbDown, MdWarningAmber,
} from 'react-icons/md'
import toast from 'react-hot-toast'

const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`


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
  useEscapeKey(onClose, !saving)

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

      // R34 (§B.26 Item 1.2): watcher subscriptions. Look up every
      // agency_admin + coordinator of the agencies we're endorsing to,
      // and seed them into request.watchers via arrayUnion inside the
      // transaction. Subsequent slice events (approve, reject, patient
      // proceed) fan notifications out to these watchers so each agency
      // learns when siblings act -- ServiceNow Public Sector watcher
      // pattern. Best-effort: a failed lookup just means fewer watchers,
      // not a failed endorsement.
      let watcherUids = []
      try {
        const staffSnap = await getDocs(query(
          collection(db, 'users'),
          where('agencyId', 'in', selectedIds),
          where('role', 'in', ['agency', 'agency_admin']),
        ))
        watcherUids = staffSnap.docs.map(d => d.id)
      } catch (lookupErr) {
        console.warn('[endorse] watcher lookup failed:', lookupErr)
      }

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
        const reqUpdate = {
          agencyIds: arrayUnion(...selectedIds),
          status:    'endorsed',
          updatedAt: serverTimestamp(),
        }
        // R34: only add the field when we actually have UIDs to add.
        // arrayUnion(...[]) is a no-op but cleaner to skip entirely.
        if (watcherUids.length > 0) {
          reqUpdate.watchers = arrayUnion(...watcherUids)
        }
        tx.update(reqRef, reqUpdate)

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
        // Timeline plumbing (§B.26): every cross-agency event on this case
        // is queryable by participating agencies via `where('requestId', ...)`.
        requestId: request.id,
        patientId: request.patientId,
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
  // PhilHealth-first coverage inputs (Order of Charging). Seeded from the
  // request and re-seeded when a different request is opened; local edits stay
  // until saved. See docs/philhealth-first-plan.md.
  const [coverage, setCoverage] = useState({ ph: '', other: '' })
  const [busy, setBusy] = useState(false)
  const [timeline, setTimeline] = useState([])
  const [timelineLoading, setTimelineLoading] = useState(true)
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

  // Re-seed the coverage inputs whenever a different request is opened.
  useEffect(() => {
    setCoverage({
      ph:    request.philhealthCovered != null ? String(request.philhealthCovered) : '',
      other: request.otherCovered      != null ? String(request.otherCovered)      : '',
    })
  }, [request.id]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Activity timeline — auditLog entries scoped to this request (reuses the
  // agency-side CaseTimeline + subscription pattern). Super-admin only:
  // staff_admin has no audit access by design (CLAUDE.md), and the auditLog
  // rule only grants request-scoped reads to super_admin, so the subscription
  // is skipped for other roles rather than firing a denied query.
  useEffect(() => {
    if (user?.role !== 'super_admin') { setTimeline([]); setTimelineLoading(false); return }
    setTimelineLoading(true)
    const unsub = onSnapshot(
      query(collection(db, 'auditLog'), where('requestId', '==', request.id), orderBy('createdAt', 'asc')),
      snap => { setTimeline(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setTimelineLoading(false) },
      (err) => { console.error('[Requests] timeline snapshot error:', err); setTimelineLoading(false) },
    )
    return unsub
  }, [request.id, user?.role])

  const funding = computeFunding(request.amountNeeded, slices)
  const terminal = ['fully_funded', 'closed', 'rejected'].includes(request.status)
  // PhilHealth-first coverage: the bill base falls back to amountNeeded for
  // legacy requests with no totalBill. Coverage is editable only before
  // endorsement (slices freeze amountRequested at endorse time).
  const billBase       = Number(request.totalBill ?? request.amountNeeded) || 0
  const previewNeeded  = computeAmountNeeded({
    totalBill:         billBase,
    philhealthCovered: Number(coverage.ph)    || 0,
    otherCovered:      Number(coverage.other) || 0,
  })
  const coverageEditable = ['submitted', 'under_review', 'assessment'].includes(request.status)

  // The documents attached to this request, with their live status/OCR merged
  // in (falls back to the request snapshot if a live doc isn't found).
  const docById = Object.fromEntries(patientDocs.map(d => [d.id, d]))
  const reqDocs = (request.attachedDocuments ?? []).map(a => ({
    ...a, ...(docById[a.documentId] ?? {}), id: a.documentId,
  }))
  // Phase 0: the verify → assess → interview → endorse gate now comes from the
  // shared requestStage model (unit-tested to mirror the old inline logic
  // exactly), so the queue chips, the coming stage rail, and this endorse gate
  // stay in lock-step. Variable names preserved so the JSX below is unchanged.
  const stage = deriveRequestStage(request, reqDocs)
  const allVerified    = stage.docsVerified
  const intakeComplete = stage.intakeComplete
  const canEndorse     = stage.canEndorse

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
        details: `${docItem.name}` + (cleanReason ? ` · reason: ${cleanReason}` : ''),
        // requestId/patientId so the entry appears in the request Activity
        // timeline (matches the bulk-verify path, which already sets these).
        requestId: request.id, patientId: request.patientId,
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
          requestId: request.id,
          patientId: request.patientId,
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
      logAudit(user, { action: 'interview_scheduled', targetType: 'request', targetId: request.id, targetName: request.requestId, details: `${form.date} ${form.time}`, requestId: request.id, patientId: request.patientId })
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
      logAudit(user, { action: 'interview_completed', targetType: 'request', targetId: request.id, targetName: request.requestId, details: `Outcome: ${outcome}`, requestId: request.id, patientId: request.patientId })
      toast.success('Interview outcome recorded.')
    } catch (err) { console.error(err); toast.error('Failed to record outcome.') }
    finally { setBusy(false) }
  }

  // PhilHealth-first: record the coverage applied before endorsement and
  // recompute the residual (amountNeeded) the agencies co-fund. Gated to
  // pre-endorsement in the UI because the endorse transaction freezes
  // amountRequested = amountNeeded onto each slice (see EndorseModal); editing
  // it afterwards would desync the slices. See docs/philhealth-first-plan.md.
  const saveCoverage = async () => {
    setBusy(true)
    try {
      const philhealthCovered = Number(coverage.ph)    || 0
      const otherCovered      = Number(coverage.other) || 0
      const totalBill         = Number(request.totalBill ?? request.amountNeeded) || 0
      const amountNeeded      = computeAmountNeeded({ totalBill, philhealthCovered, otherCovered })
      await updateDoc(doc(db, 'requests', request.id), {
        totalBill, philhealthCovered, otherCovered, amountNeeded,
        updatedAt: serverTimestamp(),
      })
      logAudit(user, {
        action: 'coverage_updated', targetType: 'request', targetId: request.id,
        targetName: request.requestId,
        details: `PhilHealth ${peso(philhealthCovered)} + other ${peso(otherCovered)} on bill ${peso(totalBill)} → needed ${peso(amountNeeded)}`,
        requestId: request.id, patientId: request.patientId,
      })
      toast.success('Coverage saved.')
    } catch (err) { console.error(err); toast.error('Failed to save coverage.') }
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
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-gray-100 sticky top-0 bg-white z-30">
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

      {/* Two-column review workspace: the documents → interview → endorse flow
          fills a wide work column; the money summary, path-to-zero, and stage
          rail pin to a sticky context rail on the right (desktop) / stack on
          top (mobile). Uses the full width instead of a narrow centred column. */}
      <div className="px-4 sm:px-6 py-5">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">

          {/* Context rail — at-a-glance money + progress. order-1 on mobile
              (shown first), pushed right and pinned on desktop. */}
          <aside className="space-y-4 order-1 lg:order-2 lg:sticky lg:top-[68px]">
          {/* Summary — amount needed, funding progress, request meta */}
          <div className="card p-4 sm:p-5 space-y-4">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">Amount needed</p>
                <p className="mt-1 text-3xl font-bold tracking-tight text-brand-700 tabular-nums leading-none">{peso(request.amountNeeded)}</p>
                <p className="mt-1.5 text-[11px] text-gray-400">Verify against the billing statement</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`text-2xl font-semibold tabular-nums leading-none ${funding.balance > 0 ? 'text-gray-900' : 'text-green-600'}`}>{peso(funding.balance)}</p>
                <p className="mt-1.5 text-[11px] text-gray-400">{funding.balance > 0 ? 'still to raise' : 'fully covered'}</p>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>{peso(funding.committed)} secured · {peso(funding.outstanding)} pending</span>
                <span className="tabular-nums">{funding.pct}% covered</span>
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
              {/* Case facts (MP detail): who's handling it + how it sits against
                  the 48-hour SLA — read-only, derived from submittedAt. */}
              <p className="flex items-center gap-1.5">
                <MdAssignment size={13} className="text-gray-400 flex-shrink-0" />
                Officer: <span className={request.assignee ? 'text-gray-700 font-medium' : 'text-amber-700 font-medium'}>{request.assignee ?? 'Unassigned'}</span>
                {!terminal && (() => {
                  const sla = slaState(request)
                  return <span className={`ml-1 ${sla === 'overdue' ? 'text-red-600' : sla === 'due_soon' ? 'text-amber-600' : 'text-gray-400'}`}>· {slaLabel(sla)} ({SLA_HOURS}h SLA)</span>
                })()}
              </p>
            </div>
          </div>

          {/* Path to zero balance — consolidated funding-source breakdown
              (coverage-first → agency slices), read-only. */}
          <PathToZeroBalance request={request} slices={slices} agencies={agencies} funding={funding} />

          {/* Stage rail — at-a-glance verify → assess → interview → endorse
              progress (redesign Phase 1), driven by the requestStage model. */}
          <RequestStageRail stage={stage} />
          </aside>

          {/* Work column — the operator's flow: verify → assess → endorse. */}
          <div className="space-y-4 min-w-0 order-2 lg:order-1">

          {/* Filed by a representative — verify the rep's ID + selfie (below) */}
          {request.filedBy && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-800">
              <p className="font-semibold flex items-center gap-1.5"><MdPerson size={13} /> Filed by a representative</p>
              <p className="mt-0.5">{request.filedBy.name} · {request.filedBy.relationship}</p>
              <p className="text-amber-700/80 mt-0.5">Verify the representative's ID and selfie in the documents below.</p>
            </div>
          )}

          {/* ① Verify documents — extracted to VerifyDocsPanel (Phase 0). */}
          <VerifyDocsPanel
            reqDocs={reqDocs} busy={busy} allVerified={allVerified} ocrExpanded={ocrExpanded}
            onBulkVerify={bulkVerifyPending} onReviewDoc={reviewDoc} onView={setViewingDoc}
            onReject={setRejectingDoc} onUnverify={setUnverifyingDoc} onToggleOcr={toggleOcrExpanded}
          />

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
            {/* Coverage applied first (Order of Charging, JAO 2020-0001):
                PhilHealth reduces the bill, then any other prior aid; the
                remaining balance is what CRMC endorses to funding agencies. */}
            <div className="p-3 rounded-lg border border-gray-100 mb-2 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-700">Coverage applied first</p>
                <span className="text-xs text-gray-400">Bill {peso(billBase)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs text-gray-500">PhilHealth (₱)</span>
                  <input type="number" min="0" inputMode="numeric" className="input" placeholder="0"
                    disabled={!coverageEditable || busy}
                    value={coverage.ph} onChange={e => setCoverage(c => ({ ...c, ph: e.target.value }))} />
                </label>
                <label className="block">
                  <span className="text-xs text-gray-500">Other aid (₱)</span>
                  <input type="number" min="0" inputMode="numeric" className="input" placeholder="0"
                    disabled={!coverageEditable || busy}
                    value={coverage.other} onChange={e => setCoverage(c => ({ ...c, other: e.target.value }))} />
                </label>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-gray-500">Remaining to agencies:{' '}
                  <span className="font-semibold text-gray-800">{peso(previewNeeded)}</span></p>
                {coverageEditable
                  ? <button className="btn-secondary text-xs py-1.5" disabled={busy} onClick={saveCoverage}>Save coverage</button>
                  : <span className="text-xs text-gray-400 italic">Locked after endorsement</span>}
              </div>
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
              {!canEndorse && stage.blockers.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-amber-700 mb-1.5 flex items-center gap-1">
                    <MdWarning size={12} className="flex-shrink-0" />
                    Before endorsing, finish {stage.blockers.length} step{stage.blockers.length > 1 ? 's' : ''}:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {stage.blockers.map(b => (
                      <span key={b.key}
                        className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800">
                        {b.label} <span className="text-amber-600/80">· {b.detail}</span>
                      </span>
                    ))}
                  </div>
                </div>
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

          {/* Activity timeline — audit-logged case history (super-admin only;
              staff_admin has no audit access by design). */}
          {user?.role === 'super_admin' && (
            <CaseTimeline events={timeline} loading={timelineLoading} />
          )}
          </div>{/* /work column */}
        </div>{/* /grid */}
      </div>{/* /workspace */}

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
  const { user } = useAuth()
  const [requests, setRequests] = useState([])
  const [agencies, setAgencies] = useState([])
  const [allSlices, setAllSlices] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState(null)
  const [searchParams] = useSearchParams()
  // Seed from ?q= so the ⌘K palette's "Requests matching …" lands pre-filtered.
  const [search,   setSearch]   = useState(() => searchParams.get('q') ?? '')
  const [filter,   setFilter]   = useState('needs_action')
  const [sort,     setSort]     = useState('waiting')
  const [category, setCategory] = useState('all')
  const [assignee, setAssignee] = useState('all')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [page,     setPage]     = useState(0)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  // R36 (§B.27): live pending referral suggestions from agencies. Surfaced
  // as an amber banner above the requests table so CRMC sees the
  // bottom-up coordination signal without leaving this page.
  const [pendingSuggestions, setPendingSuggestions] = useState([])
  const [actingOn, setActingOn] = useState(null)

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
    //
    // Phase 0.5 (post-review hardening): hard cap at 500 docs. At pilot
    // scale this is invisible; at production scale it caps the read
    // damage if the dataset grows. If the table ever shows exactly 500
    // rows in production, that's the signal to add real pagination
    // (Phase 3.4 in docs/recovery-and-hardening-plan.md).
    const u3 = onSnapshot(
      query(collection(db, 'applications'),
        where('status', 'in',
          ['endorsed', 'reviewing', 'awaiting_info', 'approved', 'certificate', 'rejected']),
        limit(500)),
      snap => setAllSlices(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => setAllSlices([]),
    )
    // R36: pending referral suggestions. Bonterra-style closed-loop --
    // CRMC sees agency-side bottom-up signals here, decides accept/decline.
    const u4 = onSnapshot(
      query(collection(db, 'referralSuggestions'),
            where('status', '==', 'pending'),
            orderBy('createdAt', 'desc')),
      snap => setPendingSuggestions(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => { console.error('[Requests] suggestions snapshot error:', err) },
    )
    return () => { u1(); u2(); u3(); u4() }
  }, [])

  // R36: respond to a referral suggestion. Accept -> opens the request's
  // EndorseModal for the operator to actually do the endorsement; doesn't
  // auto-endorse (CRMC retains final judgment). Decline -> writes a
  // decline reason that the suggesting agency can see.
  const handleAcceptSuggestion = async (s) => {
    if (actingOn) return
    setActingOn(s.id)
    try {
      await updateDoc(doc(db, 'referralSuggestions', s.id), {
        status:      'accepted',
        respondedAt: serverTimestamp(),
        respondedBy: user.uid,
      })
      // Navigate to the request and open it so CRMC can endorse.
      const req = requests.find(r => r.id === s.requestId)
      if (req) {
        setSelected(req)
        toast.success(`Suggestion accepted. Endorse the case to ${s.toAgencyName} from the modal.`)
      } else {
        toast.success('Suggestion accepted. Find the request to endorse.')
      }
    } catch (err) {
      console.error('[Requests] accept suggestion failed:', err)
      toast.error('Could not accept suggestion. Try again.')
    } finally {
      setActingOn(null)
    }
  }

  const handleDeclineSuggestion = async (s) => {
    if (actingOn) return
    const reason = window.prompt(
      `Decline reason (visible to ${s.fromUserName} at ${s.fromAgencyId}):`,
      ''
    )
    if (!reason || !reason.trim()) return
    setActingOn(s.id)
    try {
      await updateDoc(doc(db, 'referralSuggestions', s.id), {
        status:        'declined',
        declineReason: reason.trim(),
        respondedAt:   serverTimestamp(),
        respondedBy:   user.uid,
      })
      toast.success('Suggestion declined. Suggesting agency will see your reason.')
    } catch (err) {
      console.error('[Requests] decline suggestion failed:', err)
      toast.error('Could not decline suggestion. Try again.')
    } finally {
      setActingOn(null)
    }
  }

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

  // Top-level categorization is the coarse action set (queueBuckets); each row
  // still shows its fine stage chip. counts drive the tab badges; overdue drives
  // the SLA strip; categories populate the filter dropdown.
  const counts = useMemo(() => coarseCounts(requests), [requests])
  const overdue = useMemo(() => overdueCount(requests), [requests])
  const categories = useMemo(
    () => Array.from(new Set(requests.map(r => r.assistanceType).filter(Boolean))).sort(),
    [requests])
  const assignees = useMemo(
    () => Array.from(new Set(requests.map(r => r.assignee).filter(Boolean))).sort(),
    [requests])

  // Filter by tab + category + past-SLA + search, then sort. Sort keys mirror
  // the table's sortable headers: 'waiting' (oldest first — most urgent),
  // 'balance' (largest unfunded first), 'coverage' (least-covered first).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = requests.filter(r => {
      if (filter !== 'all' && coarseBucketOf(r) !== filter) return false
      if (category !== 'all' && r.assistanceType !== category) return false
      if (assignee !== 'all' && (r.assignee ?? 'Unassigned') !== assignee) return false
      if (overdueOnly && !isOverdue(r)) return false
      if (!q) return true
      return (r.patientName ?? '').toLowerCase().includes(q)
        || (r.requestId ?? '').toLowerCase().includes(q)
        || (r.assistanceType ?? '').toLowerCase().includes(q)
    })
    // Precompute funding once per request so the sort comparator doesn't call
    // computeFunding O(n log n) times.
    const fundMap = new Map(list.map(r => [r.id, computeFunding(Number(r.amountNeeded) || 0, slicesByRequest.get(r.id) ?? [])]))
    // submittedAt → epoch-ms across Timestamp / { seconds } / Date / ISO shapes
    // (matches the robust conversion used for the SLA + waiting labels).
    const subMs = (r) => {
      const t = r?.submittedAt
      if (!t) return 0
      if (typeof t.toDate === 'function') return t.toDate().getTime()
      if (typeof t.seconds === 'number') return t.seconds * 1000
      const d = new Date(t); return Number.isNaN(d.getTime()) ? 0 : d.getTime()
    }
    const arr = [...list]
    if (sort === 'balance')       arr.sort((a, b) => fundMap.get(b.id).balance - fundMap.get(a.id).balance)
    else if (sort === 'coverage') arr.sort((a, b) => fundMap.get(a.id).pct - fundMap.get(b.id).pct)
    else /* waiting */            arr.sort((a, b) => subMs(a) - subMs(b))
    return arr
  }, [requests, filter, category, assignee, overdueOnly, search, sort, slicesByRequest])

  // Pagination. Reset to page 0 whenever the filtered set changes.
  const PAGE_SIZE = 12
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage  = Math.min(page, pageCount - 1)
  const visible   = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
  useEffect(() => { setPage(0); setSelectedIds(new Set()) }, [filter, category, assignee, overdueOnly, search, sort])

  // ── Selection + bulk actions ──────────────────────────────────────────────
  const toggleRow = (id) => setSelectedIds(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const toggleAllVisible = () => setSelectedIds(s => {
    const allSel = visible.length > 0 && visible.every(r => s.has(r.id))
    return allSel ? new Set() : new Set(visible.map(r => r.id))
  })
  const clearSelection = () => setSelectedIds(new Set())
  const selectedRequests = () => requests.filter(r => selectedIds.has(r.id))

  // Assign selected requests to the current operator. Writes only the
  // (non-money) assignee fields on the request; admins may update any field.
  const assignToMe = async () => {
    const rows = selectedRequests(); if (!rows.length) return
    setBulkBusy(true)
    try {
      await Promise.all(rows.map(r => updateDoc(doc(db, 'requests', r.id), {
        assignee: user.name ?? 'CRMC', assigneeUid: user.uid, updatedAt: serverTimestamp(),
      })))
      rows.forEach(r => logAudit(user, {
        action: 'request_assigned', targetType: 'request', targetId: r.id, targetName: r.requestId,
        details: `Assigned to ${user.name ?? 'CRMC'}`, requestId: r.id, patientId: r.patientId,
      }))
      toast.success(`Assigned ${rows.length} request${rows.length === 1 ? '' : 's'} to you.`)
      clearSelection()
    } catch (err) { console.error('[Requests] assign error:', err); toast.error('Failed to assign.') }
    finally { setBulkBusy(false) }
  }

  // Notify the selected patients that CRMC needs more documents (uses notify()).
  const requestDocuments = async () => {
    const rows = selectedRequests(); if (!rows.length) return
    setBulkBusy(true)
    try {
      await Promise.all(rows.map(r => notify(r.patientId, {
        type: 'docs_requested', title: 'CRMC needs more documents',
        body: `CRMC has requested additional documents for your request ${r.requestId}. Please review your requirements and upload what's missing.`,
      }).catch(() => {})))
      // All admin actions must call logAudit() (CLAUDE.md).
      rows.forEach(r => logAudit(user, {
        action: 'docs_requested', targetType: 'request', targetId: r.id, targetName: r.requestId,
        details: 'Requested additional documents from the patient',
        requestId: r.id, patientId: r.patientId,
      }))
      toast.success(`Requested documents on ${rows.length} request${rows.length === 1 ? '' : 's'}.`)
      clearSelection()
    } catch (err) { console.error('[Requests] request-docs error:', err); toast.error('Failed to send request.') }
    finally { setBulkBusy(false) }
  }

  // Endorse cannot batch — it needs per-request agencies + amounts. Open the
  // first selected request so CRMC endorses through the EndorseModal.
  const bulkEndorse = () => {
    const rows = selectedRequests(); if (!rows.length) return
    if (rows.length > 1) toast('Endorse one request at a time — opening the first.', { icon: '↗' })
    setSelected(rows[0]); clearSelection()
  }

  if (selectedLive) {
    return (
      <Layout breadcrumb="Assistance Requests">
        <RequestDetail request={selectedLive} agencies={agencies} onClose={() => setSelected(null)} />
      </Layout>
    )
  }

  return (
    <Layout breadcrumb="Assistance Requests">
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">
        <div className="mb-5">
          <p className="eyebrow">CRMC gateway</p>
          <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Requests</h1>
          <p className="text-sm text-gray-500 mt-1">
            <span className="tabular-nums font-medium text-gray-700">{counts.all}</span> request{counts.all === 1 ? '' : 's'} at CRMC
            {' · '}
            <span className="tabular-nums font-medium text-gray-700">{counts.needs_action}</span> waiting on your team
          </p>
        </div>

        {/* R36: agency suggestions queue. Amber banner surfaces bottom-up
            referral signals from agency staff. Each suggestion is an
            information channel into the network broker (CRMC) -- accepting
            does NOT auto-endorse, only acknowledges; CRMC still decides
            and endorses through the normal flow. */}
        {pendingSuggestions.length > 0 && (
          <div className="mb-4 border border-amber-200 bg-amber-50/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <MdGroups className="text-amber-600" size={18} />
              <h2 className="text-sm font-semibold text-amber-900">
                Agency suggestions ({pendingSuggestions.length})
              </h2>
              <span className="text-xs text-amber-700/70">
                — agencies recommending another partner be brought onto a case
              </span>
            </div>
            <div className="space-y-2">
              {pendingSuggestions.map(s => (
                <div key={s.id} className="bg-white rounded-lg border border-amber-100 p-3">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900">
                        <span className="font-medium">{s.fromUserName}</span>
                        <span className="text-gray-500"> at </span>
                        <span className="font-medium">{agencies.find(a => a.id === s.fromAgencyId)?.name ?? s.fromAgencyId}</span>
                        <span className="text-gray-500"> suggests endorsing </span>
                        <span className="font-medium">{s.patientName}</span>
                        <span className="text-gray-500"> to </span>
                        <span className="font-medium">{s.toAgencyName}</span>
                      </p>
                      <p className="text-xs text-gray-600 mt-1 italic">"{s.reason}"</p>
                      <div className="flex flex-wrap gap-3 text-xs text-gray-500 mt-1.5">
                        {s.recommendedAmount && (
                          <span>Recommended ₱{Number(s.recommendedAmount).toLocaleString()}</span>
                        )}
                        <span className={`px-1.5 py-0.5 rounded font-medium ${
                          s.urgency === 'high' ? 'bg-red-50 text-red-700' :
                          s.urgency === 'medium' ? 'bg-amber-50 text-amber-700' :
                          'bg-gray-50 text-gray-600'
                        }`}>{s.urgency} urgency</span>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleAcceptSuggestion(s)}
                        disabled={actingOn === s.id}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white flex items-center gap-1"
                      >
                        <MdCheck size={14} /> Accept
                      </button>
                      <button
                        onClick={() => handleDeclineSuggestion(s)}
                        disabled={actingOn === s.id}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 text-gray-700 flex items-center gap-1"
                      >
                        <MdThumbDown size={12} /> Decline
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SLA alert strip — breached requests can't be cleared for discharge. */}
        {overdue > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <MdWarningAmber className="text-red-600 flex-shrink-0" size={18} />
            <p className="min-w-0 flex-1 text-sm text-red-900">
              <span className="font-semibold">{overdue} request{overdue === 1 ? '' : 's'} past the {SLA_HOURS}-hour SLA.</span>{' '}
              Patients can't be cleared for discharge until a decision is recorded.
            </p>
            <button
              type="button"
              onClick={() => { setFilter('all'); setOverdueOnly(true) }}
              className="flex-shrink-0 rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 transition-colors">
              Review them
            </button>
          </div>
        )}

        {/* Categorization tabs */}
        <div className="mb-3 overflow-x-auto">
          <QueueTabs active={filter} counts={counts} onChange={setFilter} />
        </div>

        {/* Filter bar */}
        <div className="card px-3 py-2.5 mb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input className="input pl-9 py-1.5" placeholder="Request ID, patient, or type…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select aria-label="Filter by category" value={category} onChange={e => setCategory(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white py-1.5 pl-2.5 pr-7 text-sm text-gray-700 hover:border-gray-300 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
            <option value="all">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select aria-label="Filter by officer" value={assignee} onChange={e => setAssignee(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white py-1.5 pl-2.5 pr-7 text-sm text-gray-700 hover:border-gray-300 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
            <option value="all">Any officer</option>
            <option value="Unassigned">Unassigned</option>
            {assignees.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button type="button" aria-pressed={overdueOnly} onClick={() => setOverdueOnly(v => !v)}
            className={`rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
              overdueOnly ? 'border-red-300 bg-red-50 font-medium text-red-800' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'
            }`}>
            Past SLA
          </button>
          <div className="ml-auto flex items-center gap-2">
            <span className="tabular-nums hidden text-xs text-gray-500 sm:block">{filtered.length} shown</span>
            <select aria-label="Sort requests" value={sort} onChange={e => setSort(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white py-1.5 pl-2.5 pr-7 text-sm text-gray-700 hover:border-gray-300 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
              <option value="waiting">Longest waiting</option>
              <option value="balance">Largest balance</option>
              <option value="coverage">Least covered</option>
            </select>
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
              onClick={() => { setSearch(''); setFilter('all'); setCategory('all'); setAssignee('all'); setOverdueOnly(false) }}
              className="mt-3 inline-flex items-center text-sm font-medium text-brand-500 hover:text-brand-600">
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <RequestsTable
              requests={visible}
              slicesByRequest={slicesByRequest}
              sort={sort}
              onSort={setSort}
              onOpen={setSelected}
              coverageWarning={coverageWarning}
              selected={selectedIds}
              onToggle={toggleRow}
              onToggleAll={toggleAllVisible}
            />
            {filtered.length > PAGE_SIZE && (
              <div className="flex flex-wrap items-center justify-between gap-2 mt-3 px-1">
                <p className="tabular-nums text-xs text-gray-500">
                  Showing {safePage * PAGE_SIZE + 1}–{safePage * PAGE_SIZE + visible.length} of {filtered.length}
                </p>
                <div className="flex items-center gap-1">
                  <button type="button" disabled={safePage === 0} onClick={() => setPage(p => Math.max(0, p - 1))}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40">
                    Previous
                  </button>
                  <span className="tabular-nums px-2 text-xs text-gray-500">Page {safePage + 1} of {pageCount}</span>
                  <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40">
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <BulkActionBar
        count={selectedIds.size}
        busy={bulkBusy}
        onAssignMe={assignToMe}
        onRequestDocs={requestDocuments}
        onEndorse={bulkEndorse}
        onClear={clearSelection}
      />
    </Layout>
  )
}
