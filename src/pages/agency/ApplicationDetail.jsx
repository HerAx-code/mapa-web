import Layout from '../../components/Layout'
import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import {
  collection, query, where, orderBy, onSnapshot,
  doc, updateDoc, getDoc, getDocs, serverTimestamp,
  writeBatch, increment, runTransaction, Timestamp, FieldPath,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { ORG } from '../../config/org'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import { logAudit } from '../../utils/auditLog'
import { getOrCreateConversation } from '../../utils/messages'
import { isGLExpired, isGLExpiringSoon, glDaysRemaining, glExpiresAtFor } from '../../utils/constants'
import { tsToDate, fmtDate } from '../../utils/dates'
import { computeFunding, deriveRequestFinancials, syncedRequestStatus, isRequestClosedByGateway } from '../../utils/requests'
import { careSettingLabel } from '../../utils/outpatient'
import { approvalMarkId, approvalCooldownBlock, repeatLimitOf, OVERRIDE_REASON_MIN } from '../../utils/approvalCooldown'
import StatusBadge from '../../components/ui/StatusBadge'
import {
  MdArrowBack, MdArrowForward, MdMessage, MdCheckCircle, MdCancel,
  MdDescription, MdAssignment, MdAttachMoney, MdVideoCall,
  MdNote, MdAdd, MdWarning,
  MdPrint, MdUpload, MdInfo, MdReceipt, MdHistory,
  MdHourglassEmpty, MdPlayArrow, MdGroups,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import { isIntakeComplete, requiredFieldsStatus } from '../../utils/intakeSheet'
import { classificationSummary } from '../../utils/classificationReuse'
import { openSignedScan } from '../../utils/signedScan'
import SignedGLUploadModal from '../../components/SignedGLUploadModal'
import GLDocumentPanel from '../../components/GLDocumentPanel'
import DocViewerModal from '../../components/DocViewerModal'
import ConfirmModal from '../../components/ConfirmModal'
import { RejectModal, ApproveModal, RequestInfoModal } from '../../components/agency/ApplicationModals'
import ReauthModal from '../../components/ReauthModal'
import { useStepUpAuth } from '../../hooks/useStepUpAuth'
import CaseTimeline from '../../components/CaseTimeline'
import SuggestEndorsementModal from '../../components/agency/SuggestEndorsementModal'
// Phase 2.1: helpers / stepper / primaryActions extracted to siblings
// under ./applicationDetail/ so this page can focus on state +
// transactions + rendering. Behavior unchanged from the inlined versions.
import {
  peso, daysSince, formatDate,
  SECTION_DEFS, VARIANT_CLS, TONE_CLS,
} from './applicationDetail/helpers'
import CompactStepper from './applicationDetail/CompactStepper'
import { getPrimaryActions } from './applicationDetail/primaryActions'
import { buildTimelineStages } from './applicationDetail/helpers'
import { useHospitalBranding } from '../../hooks/useHospitals'

// Phase 2.1 split removed: peso, daysSince, formatDate, SECTION_DEFS,
// VARIANT_CLS, TONE_CLS, CompactStepper, getPrimaryActions, and
// buildTimelineStages — all live under ./applicationDetail/ now. The
// original inline definitions (~280 lines) are gone from this file.

// ── Main page ─────────────────────────────────────────────────────────────

export default function ApplicationDetail() {
  const { id }         = useParams()
  const navigate       = useNavigate()
  const { user }       = useAuth()
  const [searchParams] = useSearchParams()
  const queueFilter    = searchParams.get('queue') ?? 'all'

  const [app, setApp]                       = useState(null)
  // Which hospital endorsed this case (the request's hospital) — shown in the
  // header so the agency always knows where the request came from.
  const caseHospital                         = useHospitalBranding(app?.tenantId)
  const [appLoading, setAppLoading]         = useState(true)
  const [request, setRequest]               = useState(null)
  const [siblings, setSiblings]             = useState([])
  // Activity Timeline events (§B.26) — auditLog entries scoped to this
  // slice's parent request. Visible to every co-funding agency.
  const [timeline, setTimeline]             = useState([])
  const [timelineLoading, setTimelineLoading] = useState(true)
  const [agency, setAgency]                 = useState(null)
  const [queueIds, setQueueIds]             = useState([])
  const [patientDocs, setPatientDocs]       = useState([])
  const [patientProfile, setPatientProfile] = useState(null)
  const [signedScan, setSignedScan]         = useState(null)

  const [section, setSection]               = useState('overview')
  const [showReject, setShowReject]           = useState(false)
  const [showApprove, setShowApprove]         = useState(false)
  const [showUpload, setShowUpload]           = useState(false)
  const [showRequestInfo, setShowRequestInfo] = useState(false)
  // R36: agency-side "Suggest another agency" modal (Bonterra warm-handoff
  // pattern). Only opened on co-funded slices; gated by role check in render.
  const [showSuggest, setShowSuggest]         = useState(false)
  // Confirm-modal flags for the four GL-lifecycle actions that used to
  // fire window.confirm. The actual action runs from the modal's onConfirm.
  const [showConfirmRedeem, setShowConfirmRedeem]       = useState(false)
  // Phase 1: the amount the provider actually billed (≤ approved).
  const [redeemAmount, setRedeemAmount]                 = useState('')
  const [showConfirmUnmark, setShowConfirmUnmark]       = useState(false)
  const [showConfirmExpire, setShowConfirmExpire]       = useState(false)
  const [showConfirmReverse, setShowConfirmReverse]     = useState(false)
  const [viewingDoc, setViewingDoc]         = useState(null)
  // Step-up re-auth before the money actions (GL-issuing approval + reversal).
  const { requireReauth, reauthProps } = useStepUpAuth()
  const [updating, setUpdating]             = useState(false)
  const [newNote, setNewNote]               = useState('')
  const [savingNote, setSavingNote]         = useState(false)

  // Subscriptions
  useEffect(() => {
    if (!id) return
    const unsub = onSnapshot(doc(db, 'applications', id), snap => {
      if (!snap.exists()) {
        toast.error('Application not found.')
        navigate('/agency/inbox')
        return
      }
      setApp({ id: snap.id, ...snap.data() })
      setAppLoading(false)
    }, () => { setAppLoading(false); toast.error('Failed to load application.') })
    return unsub
  }, [id, navigate])

  useEffect(() => {
    if (!user?.agencyId) return
    const unsub = onSnapshot(doc(db, 'agencies', user.agencyId),
      snap => snap.exists() && setAgency({ id: snap.id, ...snap.data() }),
      (err) => console.error('[ApplicationDetail] agency snapshot error:', err),
    )
    return unsub
  }, [user?.agencyId])

  useEffect(() => {
    if (!user?.agencyId) return
    const base = [where('agencyId', '==', user.agencyId)]
    const statuses = {
      all:           null,
      pending:       ['pending'],
      reviewing:     ['reviewing'],
      awaiting_info: ['awaiting_info'],
      interview:     ['interview'],
      approved:      ['approved', 'certificate'],
      rejected:      ['rejected'],
    }[queueFilter]
    const constraints = statuses ? [...base, where('status', 'in', statuses)] : base
    const unsub = onSnapshot(query(collection(db, 'applications'), ...constraints), snap => {
      const items = snap.docs
        .map(d => ({ id: d.id, submittedAt: d.data().submittedAt }))
        .sort((a, b) => (b.submittedAt?.seconds ?? 0) - (a.submittedAt?.seconds ?? 0))
      setQueueIds(items.map(i => i.id))
    }, (err) => console.error('[ApplicationDetail] queue snapshot error:', err))
    return unsub
  }, [user?.agencyId, queueFilter])

  useEffect(() => {
    if (!app?.patientId || !user?.agencyId) return
    // Live subscription so the agency sees patient re-uploads while the
    // application is in 'awaiting_info' without a page reload.
    //
    // R9 fix (2026-06-03): the original query was
    //   where('patientId', '==', app.patientId)
    // but the documents.read rule only grants agency reads when
    // `userAgencyId() in resource.data.agencyIds`. For a LIST query
    // Firestore evaluates the rule against the query's constraints,
    // not the individual matched docs -- if the query is broader than
    // the rule allows, the whole snapshot fails with "permission
    // denied" rather than returning a subset. Surfaced in the field
    // when an agency opened a slice with documents that hadn't yet
    // been stamped with their agencyId.
    //
    // The fix is to narrow the query to documents this agency can
    // actually read -- by definition the ones with their agencyId
    // stamped on agencyIds[] (which the endorse transaction does).
    // We keep the patientId filter as a client-side narrow (the array-
    // contains gate already restricts to slices endorsed to us, and
    // the docs collection is small per agency).
    const unsub = onSnapshot(
      query(
        collection(db, 'documents'),
        where('agencyIds', 'array-contains', user.agencyId),
      ),
      (snap) => {
        const all = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(d => d.patientId === app.patientId)
        if (app.attachedDocuments?.length > 0) {
          const byId = Object.fromEntries(all.map(d => [d.id, d]))
          setPatientDocs(app.attachedDocuments.map(attached => {
            const live = byId[attached.documentId]
            return live
              ? { ...live, updatedAfterSubmission: attached.updatedAfterSubmission ?? false }
              : { id: attached.documentId, name: attached.name, status: attached.status, date: attached.date, _missing: true }
          }))
        } else {
          setPatientDocs(all)
        }
      },
      (err) => console.error('[ApplicationDetail] patient documents snapshot error:', err),
    )
    // Patient profile is one-shot -- not expected to change mid-review.
    getDoc(doc(db, 'users', app.patientId))
      .then(snap => { if (snap.exists()) setPatientProfile(snap.data()) })
      .catch(() => {})
    return unsub
  }, [app?.patientId, user?.agencyId, app?.attachedDocuments])

  useEffect(() => {
    if (!app?.id) return
    const unsub = onSnapshot(doc(db, 'certificates', app.id), snap => {
      setSignedScan(snap.exists() ? snap.data() : null)
    }, (err) => console.error('[ApplicationDetail] certificate snapshot error:', err))
    return unsub
  }, [app?.id])

  // Co-funding parent request — gives the full bill and the running committed
  // total across every agency. (Rules let an agency read a request it holds a
  // slice in; sibling slices of other agencies are not readable, so the panel
  // shows the aggregate, not a per-agency breakdown.)
  useEffect(() => {
    if (!app?.requestId) { setRequest(null); return }
    const unsub = onSnapshot(doc(db, 'requests', app.requestId),
      snap => setRequest(snap.exists() ? { id: snap.id, ...snap.data() } : null),
      (err) => console.error('[ApplicationDetail] request snapshot error:', err),
    )
    return unsub
  }, [app?.requestId])

  // Sibling slices of the same request — the per-agency co-funding breakdown.
  // The rules allow a co-funding agency to read every slice of a request it
  // holds (its id is in request.agencyIds), so this is live and accurate.
  useEffect(() => {
    if (!app?.requestId) { setSiblings([]); return }
    const unsub = onSnapshot(
      query(collection(db, 'applications'), where('requestId', '==', app.requestId)),
      snap => setSiblings(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => console.error('[ApplicationDetail] siblings snapshot error:', err),
    )
    return unsub
  }, [app?.requestId])

  // Activity Timeline (§B.26): subscribe to every auditLog entry on this
  // case so the coordinator sees a chronological cross-agency feed. The
  // R33 rule allows any co-funding agency to read entries where
  // entry.requestId matches a request whose agencyIds includes this user.
  // For legacy slices that pre-date co-funding (no requestId), skip the
  // query -- there's nothing meaningful to render without a parent
  // request scope.
  useEffect(() => {
    if (!app?.requestId) { setTimeline([]); setTimelineLoading(false); return }
    setTimelineLoading(true)
    const unsub = onSnapshot(
      query(
        collection(db, 'auditLog'),
        where('requestId', '==', app.requestId),
        orderBy('createdAt', 'asc'),
      ),
      snap => {
        setTimeline(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setTimelineLoading(false)
      },
      (err) => {
        // Permission denials here mean the agency's slice isn't tied to a
        // request whose agencyIds includes them -- shouldn't happen in
        // normal operation but is logged so the rule layer is debuggable.
        console.error('[ApplicationDetail] timeline snapshot error:', err)
        setTimelineLoading(false)
      },
    )
    return unsub
  }, [app?.requestId])

  const queueIndex = useMemo(() => queueIds.indexOf(id), [queueIds, id])
  const prevId = queueIndex > 0 ? queueIds[queueIndex - 1] : null
  const nextId = queueIndex >= 0 && queueIndex < queueIds.length - 1 ? queueIds[queueIndex + 1] : null
  const goTo   = (targetId) => navigate(`/agency/applications/${targetId}?queue=${queueFilter}`)

  // ── Status update handlers ───────────────────────────────────────────

  const updateStatus = async (newStatus, extra = {}) => {
    if (!app) return false
    setUpdating(true)
    const prevStatus = app.status
    try {
      await updateDoc(doc(db, 'applications', app.id), {
        status:    newStatus,
        updatedAt: serverTimestamp(),
        ...extra,
      })
      // Activity Timeline (§B.26): capture every slice transition so the
      // co-funding case shows a chronological cross-agency feed. Best-effort
      // -- a failed audit write doesn't undo the slice update.
      if (prevStatus !== newStatus) {
        logAudit(user, {
          action:     'slice_advanced',
          targetType: 'application',
          targetId:   app.id,
          targetName: app.patientName,
          details:    `${app.agencyName ?? 'Agency'}: ${prevStatus} → ${newStatus}`,
          requestId:  app.requestId ?? null,
          patientId:  app.patientId,
        })
      }
      return true
    } catch (err) {
      console.error(err)
      toast.error('Failed to update application.')
      return false
    } finally {
      setUpdating(false)
    }
  }

  const handleStartReview = async () => {
    const ok = await updateStatus('reviewing')
    if (!ok) return
    await notify(app.patientId, {
      type:  'app_advanced',
      title: 'Application under review',
      body:  `${user.name} from ${app.agencyName} has started reviewing your application.`,
    })
    toast.success('Application moved to Reviewing.')
  }

  const handleRequestInfo = async (message) => {
    const ok = await updateStatus('awaiting_info', {
      awaitingInfoMessage:     message,
      awaitingInfoRequestedAt: serverTimestamp(),
      awaitingInfoRequestedBy: user.name,
    })
    if (!ok) return
    await notify(app.patientId, {
      type:  'awaiting_info_requested',
      title: 'Information requested by your agency',
      body:  `${app.agencyName} is asking you to: ${message}`,
    })
    if (app.endorsedById) {
      notify(app.endorsedById, {
        type:  'app_advanced',
        title: `${app.agencyName} requested more info from the patient`,
        body:  `${app.patientName}'s endorsed slice paused — agency needs: "${message}".`,
      }).catch(() => {})
    }
    setShowRequestInfo(false)
    toast.success('Patient notified. Application paused from the urgent queue.')
  }

  // Manual resume — coordinator decides the patient has responded enough to
  // move on, or the request was sent in error. Auto-revert (on patient
  // document upload) does the same thing.
  const handleResumeFromAwaiting = async () => {
    const ok = await updateStatus('reviewing', {
      awaitingInfoMessage:     null,
      awaitingInfoRequestedAt: null,
      awaitingInfoRequestedBy: null,
      awaitingInfoResumedAt:   serverTimestamp(),
    })
    if (!ok) return
    toast.success('Application resumed. Back in the active queue.')
  }

  // Interview scheduling/rescheduling lived here pre-co-funding when each
  // agency interviewed its applicants. Removed: the single assessment
  // interview is now on the parent request and conducted by the gateway.

  const handleApprove = async ({ approvedAmount, purposeOfAssistance, payableTo, approvedBy, approvedByUid, repeatOverrideReason = '' }) => {
    setUpdating(true)
    try {
      // ── Repeat limit per agency (Phase 1). The rules require this agency's
      // approval mark in the same write; inside the agency's limit
      // (agencies.repeatLimit, default 30 days) the approval needs a written
      // reason, saved on the slice as repeatOverride. Checked again inside
      // the transaction with fresh data (src/utils/approvalCooldown.js).
      if (!app.requestId) {
        toast.error('This slice is not linked to a request and cannot be approved.')
        return
      }
      const markRef = doc(db, 'approvalMarks', approvalMarkId(user.agencyId, app.patientId))
      const overrideReason = String(repeatOverrideReason ?? '').trim()
      const COOLDOWN_MSG = (b) =>
        `Your agency approved ${b.type ? `${b.type} ` : ''}assistance for this patient ${b.daysAgo} day${b.daysAgo === 1 ? '' : 's'} ago, ` +
        `on another request (your limit is ${b.days} days). Give a reason of at least ${OVERRIDE_REASON_MIN} characters to approve anyway.`

      // ── Transactional approve + budget commit.
      // Closes the read-then-write race where two parallel approvals could
      // both pass the client-side budget check and both increment committed,
      // pushing the agency over allocated. The transaction re-reads the
      // live agency doc; if remaining budget no longer covers the amount,
      // we abort with an explicit message so the coordinator can retry.
      const agencyRef = doc(db, 'agencies', user.agencyId)
      const appRef    = doc(db, 'applications', app.id)

      // Co-funding: if this application is a slice of a parent request, the
      // approval also advances the request's secured total toward zero
      // balance. Read it inside the transaction (all reads before writes).
      const reqRef = app.requestId ? doc(db, 'requests', app.requestId) : null

      await runTransaction(db, async (tx) => {
        const agencySnap = await tx.get(agencyRef)
        const reqSnap    = reqRef ? await tx.get(reqRef) : null
        const markSnap   = await tx.get(markRef)
        // Logic review: no commitment on a request the hospital rejected/closed.
        if (reqSnap?.exists() && isRequestClosedByGateway(reqSnap.data().status)) throw new Error('REQUEST_CLOSED')
        const data       = agencySnap.exists() ? agencySnap.data() : {}
        const markData   = markSnap.exists() ? markSnap.data() : null
        const assistanceType = reqSnap?.exists() ? (reqSnap.data().assistanceType ?? '') : ''
        const block = approvalCooldownBlock(markData, app.requestId, Date.now(), repeatLimitOf(data), assistanceType)
        if (block && overrideReason.length < OVERRIDE_REASON_MIN) throw new Error(`COOLDOWN:${COOLDOWN_MSG(block)}`)
        const allocated  = data.budget?.allocated ?? 0
        const committed  = data.budget?.committed ?? 0
        const remaining  = Math.max(0, allocated - committed)

        // Only enforce the budget gate when the agency actually has a
        // budget allocated. Agencies with allocated=0 are unfunded; we
        // record the approval as data but don't track against budget.
        if (allocated > 0 && approvedAmount > remaining) {
          throw new Error(
            `BUDGET_INSUFFICIENT:Only ₱${remaining.toLocaleString()} remaining ` +
            `(another approval may have just landed). Lower the amount or contact an administrator.`
          )
        }

        tx.update(appRef, {
          status:              'approved',
          approvedAmount,
          // Record the approved figure on the slice so the parent request's
          // funding tally and the coordination board reflect what this agency
          // actually committed (may be less than the endorsed amountRequested).
          amountApproved:      approvedAmount,
          purposeOfAssistance,
          payableTo,
          approvedBy,
          // Link the actor by UID so future filtering / click-through can
          // resolve them reliably even if their display name changes.
          approvedByUid:       approvedByUid ?? null,
          approvedAt:          serverTimestamp(),
          glStatus:            'issued',
          // Valid 10 days from issuance (owner decision 2026-11-16); stored
          // per letter so older letters keep the 30 days printed on them.
          glExpiresAt:         Timestamp.fromMillis(glExpiresAtFor(Date.now())),
          glRedeemedAt:        null,
          redeemedAmount:      null,
          // Inside the agency's repeat limit: the recorded exception.
          repeatOverride:      block
            ? { reason: overrideReason, byUid: user.uid, byName: user.name ?? '', at: serverTimestamp() }
            : null,
          updatedAt:           serverTimestamp(),
        })
        if (allocated > 0) {
          tx.update(agencyRef, {
            'budget.committed': increment(approvedAmount),
          })
        }

        // Approval mark (required by the rules in this same write). byType
        // keeps the last approval per assistance type for per-type limits;
        // other types' entries are carried over unchanged.
        tx.set(markRef, {
          agencyId:       user.agencyId,
          patientId:      app.patientId,
          requestId:      app.requestId,
          sliceId:        app.id,
          lastApprovedAt: serverTimestamp(),
          ...(assistanceType || markData?.byType ? {
            byType: {
              ...(markData?.byType ?? {}),
              ...(assistanceType ? { [assistanceType]: { at: serverTimestamp(), requestId: app.requestId } } : {}),
            },
          } : {}),
        })

        // Co-funding: advance the parent request. amountCommitted grows by the
        // approved amount; the request becomes fully_funded once the secured
        // total reaches the net need, else partially_funded. (The rule limits
        // agency writes here to amountCommitted/status/updatedAt.)
        if (reqSnap?.exists()) {
          const r            = reqSnap.data()
          const need         = r.amountNeeded ?? 0
          const newCommitted = (r.amountCommitted ?? 0) + approvedAmount
          // Phase 2A: outpatient = one charge slip, funded only up to its amount.
          if (r.careSetting === 'outpatient' && newCommitted > need) {
            throw new Error(`OUTPATIENT_CAP:This outpatient charge is ₱${need.toLocaleString()} and other agencies already cover ₱${(r.amountCommitted ?? 0).toLocaleString()}. Approve at most ₱${Math.max(0, need - (r.amountCommitted ?? 0)).toLocaleString()}.`)
          }
          // approvedAmount is always > 0 here (ApproveModal validates), so
          // newCommitted > 0 is guaranteed -- the request can only move into
          // 'fully_funded' or 'partially_funded'. The previous 'endorsing'
          // fallback was unreachable.
          const newStatus = (need > 0 && newCommitted >= need)
            ? 'fully_funded'
            : 'partially_funded'
          tx.update(reqRef, {
            amountCommitted: newCommitted,
            status:          syncedRequestStatus(r.status, newStatus),
            updatedAt:       serverTimestamp(),
          })
        }
      })

      // Activity Timeline (§B.26): approval is a major case event; every
      // sibling agency should see this in the Case Timeline.
      logAudit(user, {
        action:     'app_approved',
        targetType: 'application',
        targetId:   app.id,
        targetName: app.patientName,
        details:    `${app.agencyName ?? 'Agency'} approved ₱${approvedAmount.toLocaleString()}${purposeOfAssistance?.length ? ` (${purposeOfAssistance.join(', ')})` : ''}${String(repeatOverrideReason ?? '').trim() ? ` · inside the repeat limit: ${String(repeatOverrideReason).trim()}` : ''}`,
        requestId:  app.requestId ?? null,
        patientId:  app.patientId,
      })

      await notify(app.patientId, {
        type:  'interview_approved',
        title: 'Application approved',
        body:  `Your application to ${app.agencyName} is approved for ₱${approvedAmount.toLocaleString()} (${purposeOfAssistance.join(', ')}). A Guarantee Letter will be issued shortly.`,
        // Good news + actionable → also SMS. Minimal text, NO amount (RA-10173).
        sms:     true,
        smsText: `MAPA: Good news — your assistance application to ${app.agencyName} was approved. Open the MAPA app for details.`,
      })
      if (app.endorsedById) {
        const partial = approvedAmount < (app.amountRequested ?? 0)
        notify(app.endorsedById, {
          type:  'app_advanced',
          title: `${app.agencyName} approved ${app.patientName}'s slice`,
          body:  partial
            ? `Approved ₱${approvedAmount.toLocaleString()} (less than the ₱${Number(app.amountRequested).toLocaleString()} endorsed). You may need to top up coverage from another agency.`
            : `Approved the full endorsed ₱${approvedAmount.toLocaleString()}. Guarantee Letter pending issuance.`,
        }).catch(() => {})
      }

      // R34 (§B.26 Item 1.2): fan out to sibling-agency watchers so they
      // learn about the approval in real time. Excludes the actor (own
      // approver, who already saw the success toast) and excludes the
      // endorsedById admin (already notified above). Best-effort -- a
      // failed fan-out doesn't undo the approval.
      const watchers = request?.watchers ?? []
      const watcherTargets = watchers.filter(uid =>
        uid !== user.uid && uid !== app.endorsedById)
      if (watcherTargets.length > 0) {
        Promise.allSettled(watcherTargets.map(uid => notify(uid, {
          type:  'app_advanced',
          title: `Sibling agency approved on a shared case`,
          body:  `${app.agencyName ?? 'An agency'} approved ₱${approvedAmount.toLocaleString()} for ${app.patientName ?? 'patient'}. Open the case to see updated coverage.`,
        }))).catch(() => {})
      }

      setShowApprove(false)
      toast.success('Application approved. Guarantee Letter pending issuance.')
    } catch (err) {
      console.error('[ApplicationDetail] approve error:', err?.code, err?.message, err)
      // Surface the explicit budget message; Firestore wraps thrown errors
      // from inside runTransaction in err.message.
      if (String(err?.message).includes('REQUEST_CLOSED')) {
        toast.error('The hospital has closed this request — it can no longer be approved.', { duration: 8000 })
      } else if (typeof err?.message === 'string' && err.message.startsWith('OUTPATIENT_CAP:')) {
        toast.error(err.message.replace('OUTPATIENT_CAP:', ''), { duration: 8000 })
      } else if (typeof err?.message === 'string' && err.message.startsWith('COOLDOWN:')) {
        toast.error(err.message.replace('COOLDOWN:', ''), { duration: 8000 })
      } else if (typeof err?.message === 'string' && err.message.startsWith('BUDGET_INSUFFICIENT:')) {
        toast.error(err.message.replace('BUDGET_INSUFFICIENT:', ''), { duration: 8000 })
      } else if (err?.code === 'permission-denied' || err?.message?.includes('permission')) {
        // Most common cause: agency user is trying to approve an application
        // that belongs to a different agency (agencyId mismatch). Could also
        // be the 30-day cooldown (approvalMarks) refusing the approval.
        toast.error(
          `Permission denied. ${app.agencyId !== user?.agencyId
            ? `This application belongs to a different agency (${app.agencyName}). You're signed in as ${user?.name}.`
            : 'Your account may not have approve permission. Contact your agency admin.'}`,
          { duration: 10000 }
        )
      } else if (err?.code === 'failed-precondition' || err?.code === 'aborted') {
        toast.error('Another approval just landed for this patient. Refresh and check the application status.', { duration: 8000 })
      } else {
        toast.error(`Failed to approve application. ${err?.code ? `(${err.code})` : ''}`)
      }
    } finally {
      setUpdating(false)
    }
  }

  const handleReject = async (reason) => {
    const ok = await updateStatus('rejected', { rejectionReason: reason })
    if (!ok) return

    // R4 fix: same family as R3 -- the rejection moves a slice out of
    // OUTSTANDING_SLICE_STATUSES, which changes the request's derived
    // financials. If this was the last outstanding slice, the parent
    // should drop from 'endorsed' to 'submitted'. Without the re-sync,
    // admin/Requests keeps showing the parent as 'Endorsing' forever
    // even though no agency is processing.
    //
    // The rejection itself doesn't affect committed (slice was never
    // approved), so agency.budget.committed stays untouched -- only the
    // parent's status needs updating.
    if (app.requestId) {
      try {
        await runTransaction(db, async (tx) => {
          const reqRef = doc(db, 'requests', app.requestId)
          const reqSnap = await tx.get(reqRef)
          if (!reqSnap.exists()) return
          const sibSnap = await getDocs(query(
            collection(db, 'applications'),
            where('requestId', '==', app.requestId),
          ))
          // Substitute the rejected status for THIS slice
          const siblings = sibSnap.docs.map(d => {
            const data = { id: d.id, ...d.data() }
            if (d.id === app.id) return { ...data, status: 'rejected' }
            return data
          })
          const need = reqSnap.data().amountNeeded ?? 0
          const next = deriveRequestFinancials(siblings, need)
          tx.update(reqRef, {
            amountCommitted: next.amountCommitted,
            status:          syncedRequestStatus(reqSnap.data().status, next.status),
            updatedAt:       serverTimestamp(),
          })
        })
      } catch (err) {
        console.error('[ApplicationDetail] parent re-sync after reject failed:', err)
      }
    }

    const submittedDate = app.submittedAt?.toDate?.()
    const isToday = submittedDate &&
      submittedDate.toDateString() === new Date().toDateString()
    if (isToday) {
      try {
        const agencyRef = doc(db, 'agencies', user.agencyId)
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(agencyRef)
          if (!snap.exists()) return
          // Give the slot back to the hospital it came from (per-hospital
          // slots), else to the agency-wide default.
          const own = app.tenantId ? snap.data()?.hospitalSlots?.[app.tenantId] : null
          if (own) {
            // slotRestoredFor names the hospital for the rules (a coordinator
            // may touch only that hospital's remaining count).
            tx.update(agencyRef, new FieldPath('hospitalSlots', app.tenantId, 'remaining'),
              Math.min((Number(own.remaining) || 0) + 1, Number(own.total) || 0),
              'slotRestoredFor', app.tenantId)
          } else {
            const current = snap.data()?.slots?.remaining ?? 0
            const total   = snap.data()?.slots?.total    ?? 0
            tx.update(agencyRef, { 'slots.remaining': Math.min(current + 1, total) })
          }
        })
      } catch (err) {
        // Slot restore is best-effort — the rejection already committed.
        console.error('[ApplicationDetail] slot restore failed:', err)
      }
    }
    await notify(app.patientId, {
      type:  'doc_rejected',
      title: 'Application rejected',
      body:  `Your application to ${app.agencyName} was not approved. Reason: ${reason}.`,
    })
    if (app.endorsedById) {
      notify(app.endorsedById, {
        type:  'app_advanced',
        title: `${app.agencyName} rejected ${app.patientName}'s slice`,
        body:  `Reason: ${reason}. Re-endorse to another agency to cover the balance.`,
      }).catch(() => {})
    }

    // R34: watcher fan-out -- rejection on a co-funded case means the
    // remaining agencies might need to step up (or expect the gateway to add
    // a new sibling). Higher signal than a pure status flip.
    const rejWatchers = request?.watchers ?? []
    const rejTargets = rejWatchers.filter(uid =>
      uid !== user.uid && uid !== app.endorsedById)
    if (rejTargets.length > 0) {
      Promise.allSettled(rejTargets.map(uid => notify(uid, {
        type:  'app_advanced',
        title: `Sibling agency rejected on a shared case`,
        body:  `${app.agencyName ?? 'An agency'} rejected ${app.patientName ?? 'patient'}'s slice. ${ORG.gatewayName} may re-endorse to another agency or this case may need additional coverage.`,
      }))).catch(() => {})
    }

    setShowReject(false)
    toast.error('Application rejected. Patient has been notified.')
  }

  // ── GL handlers ──────────────────────────────────────────────────────

  const handlePrintGL = () => {
    // Same-tab navigation. The viewer has its own 'Back to application' link
    // and triggers the browser print dialog from its own Print button, so
    // there's no reason to spawn a new tab (which trips popup blockers and
    // breaks the back button on mobile).
    navigate(`/agency/applications/${app.id}/gl`)
  }

  // Each of the GL lifecycle actions below now opens an in-app ConfirmModal
  // (see render at the end of the page). The actual mutation lives in a
  // performX function that the modal's onConfirm invokes.
  const handleRedeemGL = () => { setRedeemAmount(String(Number(app.approvedAmount) || '')); setShowConfirmRedeem(true) }
  const performRedeemGL = async () => {
    // Phase 1 (2026-11-16): settle on what the provider actually billed. The
    // whole approved amount leaves "committed"; only the actual amount counts
    // as disbursed, so the unused part returns to the agency's budget.
    const amount = Number(app.approvedAmount) || 0
    const actual = Number(redeemAmount)
    if (redeemAmount === '' || !Number.isFinite(actual) || actual < 0 || actual > amount) {
      toast.error(`Enter the amount billed, from ₱0 up to the approved ₱${amount.toLocaleString()}.`)
      return
    }
    setUpdating(true)
    try {
      const batch = writeBatch(db)
      batch.update(doc(db, 'applications', app.id), {
        glStatus:       'redeemed',
        glRedeemedAt:   serverTimestamp(),
        redeemedAmount: actual,
        // A letter used before the agency clicked Mark as Issued was issued.
        ...(app.status === 'approved' ? { status: 'certificate' } : {}),
        updatedAt:      serverTimestamp(),
      })
      if (amount > 0 && (agency?.budget?.allocated ?? 0) > 0) {
        batch.update(doc(db, 'agencies', user.agencyId), {
          'budget.committed': increment(-amount),
          'budget.disbursed': increment(actual),
        })
      }
      await batch.commit()
      logAudit(user, { action: 'gl_redeemed', targetType: 'application', targetId: app.id, targetName: app.patientName, details: `₱${actual.toLocaleString()} of ₱${amount.toLocaleString()} billed by ${app.payableTo}${actual < amount ? ` · ₱${(amount - actual).toLocaleString()} returned to budget` : ''}`, requestId: app.requestId ?? null, patientId: app.patientId })
      toast.success('GL marked as redeemed.')
      setShowConfirmRedeem(false)
    } catch (err) { console.error(err); toast.error('Failed to mark GL redeemed.') }
    finally { setUpdating(false) }
  }

  // Reverses a mistaken Mark Redeemed: moves the amount back from disbursed to
  // committed and flips glStatus back to 'issued'. Use only to correct errors
  // (e.g. the provider hadn't actually billed back yet). Audit-logged.
  const handleUnmarkRedeemed = () => setShowConfirmUnmark(true)
  const performUnmarkRedeemed = async () => {
    setUpdating(true)
    try {
      const amount = Number(app.approvedAmount) || 0
      // Letters redeemed before Phase 1 have no redeemedAmount: they were
      // settled at the full approved amount.
      const actual = app.redeemedAmount != null ? Number(app.redeemedAmount) : amount
      const batch = writeBatch(db)
      batch.update(doc(db, 'applications', app.id), {
        glStatus:       'issued',
        glRedeemedAt:   null,
        redeemedAmount: null,
        updatedAt:      serverTimestamp(),
      })
      if (amount > 0 && (agency?.budget?.allocated ?? 0) > 0) {
        batch.update(doc(db, 'agencies', user.agencyId), {
          'budget.committed': increment(amount),
          'budget.disbursed': increment(-actual),
        })
      }
      await batch.commit()
      logAudit(user, { action: 'gl_unmark_redeemed', targetType: 'application', targetId: app.id, targetName: app.patientName, details: `₱${amount.toLocaleString()} returned to committed (redemption reversed)`, requestId: app.requestId ?? null, patientId: app.patientId })
      toast.success('Redemption reversed. Amount returned to committed.')
      setShowConfirmUnmark(false)
    } catch (err) { console.error(err); toast.error('Failed to reverse redemption.') }
    finally { setUpdating(false) }
  }

  const handleExpireGL = () => setShowConfirmExpire(true)
  const performExpireGL = async () => {
    setUpdating(true)
    try {
      const amount = Number(app.approvedAmount) || 0

      // R3 fix: the previous version was a writeBatch that only updated the
      // slice + the agency budget. The parent request's `amountCommitted`
      // and `status` fields went stale on every expiry (the L11 'data
      // check' chip surfaced this). Promote to a runTransaction so we can
      // safely re-read all sibling slices and re-derive parent financials.
      await runTransaction(db, async (tx) => {
        const appRef = doc(db, 'applications', app.id)
        const appSnap = await tx.get(appRef)
        if (!appSnap.exists()) throw new Error('GONE')

        // If we have a parent request, read the request + all sibling slices.
        let reqRef = null, reqSnap = null, siblings = []
        if (app.requestId) {
          reqRef  = doc(db, 'requests', app.requestId)
          reqSnap = await tx.get(reqRef)
          const sibSnap = await getDocs(query(
            collection(db, 'applications'),
            where('requestId', '==', app.requestId),
          ))
          // Substitute the post-transition state for THIS slice so the
          // derivation reflects the about-to-commit world. Same slice
          // status (`certificate`) but glStatus flips to 'expired', which
          // computeFunding now excludes from committed.
          siblings = sibSnap.docs.map(d => {
            const data = { id: d.id, ...d.data() }
            if (d.id === app.id) return { ...data, glStatus: 'expired' }
            return data
          })
        }

        // Slice write
        tx.update(appRef, {
          glStatus:    'expired',
          glExpiredAt: serverTimestamp(),
          updatedAt:   serverTimestamp(),
        })

        // Agency budget release
        if (amount > 0 && (agency?.budget?.allocated ?? 0) > 0) {
          tx.update(doc(db, 'agencies', user.agencyId), {
            'budget.committed': increment(-amount),
          })
        }

        // Parent re-sync
        if (reqRef && reqSnap?.exists()) {
          const need = reqSnap.data().amountNeeded ?? 0
          const next = deriveRequestFinancials(siblings, need)
          tx.update(reqRef, {
            amountCommitted: next.amountCommitted,
            status:          syncedRequestStatus(reqSnap.data().status, next.status),
            updatedAt:       serverTimestamp(),
          })
        }
      })

      logAudit(user, { action: 'gl_expired', targetType: 'application', targetId: app.id, targetName: app.patientName, details: `₱${amount.toLocaleString()} released back to budget`, requestId: app.requestId ?? null, patientId: app.patientId })
      toast.success('GL marked as expired. Budget released.')
      setShowConfirmExpire(false)
    } catch (err) { console.error(err); toast.error('Failed to mark GL expired.') }
    finally { setUpdating(false) }
  }

  const handleReverseApproval = () => setShowConfirmReverse(true)
  const performReverseApproval = async () => {
    setUpdating(true)
    try {
      const amount = Number(app.approvedAmount) || 0

      // The 30-day cooldown keeps running from the original approval: the
      // agency's approval mark (approvalMarks) is left untouched. cooldownUntilAt
      // stays on the slice as a record (Funds reads it).
      const original = app.approvedAt?.toDate ? app.approvedAt.toDate() : (app.approvedAt ? new Date(app.approvedAt) : null)
      const cooldownUntil = original
        ? Timestamp.fromDate(new Date(original.getTime() + APPROVAL_COOLDOWN_DAYS * 86400000))
        : null

      // R3 fix (companion to performExpireGL): re-sync the parent
      // request after a reversal. Promoted from writeBatch to
      // runTransaction so we can read sibling slices + the request
      // atomically and re-derive amountCommitted + status. Without
      // this, the parent stays at 'fully_funded' with the old
      // committed total long after the reversed slice has stopped
      // counting.

      await runTransaction(db, async (tx) => {
        const appRef = doc(db, 'applications', app.id)
        const appSnap = await tx.get(appRef)
        if (!appSnap.exists()) throw new Error('GONE')

        let reqRef = null, reqSnap = null, siblings = []
        if (app.requestId) {
          reqRef  = doc(db, 'requests', app.requestId)
          reqSnap = await tx.get(reqRef)
          const sibSnap = await getDocs(query(
            collection(db, 'applications'),
            where('requestId', '==', app.requestId),
          ))
          // Substitute the post-transition state for THIS slice. After
          // reversal status flips from 'approved' / 'certificate' back
          // to 'reviewing', which is in OUTSTANDING_SLICE_STATUSES (not
          // committed).
          siblings = sibSnap.docs.map(d => {
            const data = { id: d.id, ...d.data() }
            if (d.id === app.id) {
              return { ...data, status: 'reviewing', glStatus: null }
            }
            return data
          })
        }

        // Slice write -- preserves approvedAmount + the other approval-
        // context fields as historical record (status=='reviewing' +
        // approvedAt==null is the authoritative 'not currently approved'
        // signal; every consumer of approvedAmount also checks status).
        tx.update(appRef, {
          status:              'reviewing',
          approvedAt:          null,
          glStatus:            null,
          glExpiresAt:         null,
          glRedeemedAt:        null,
          cooldownUntilAt:     cooldownUntil,
          reversedAt:          serverTimestamp(),
          reversedBy:          user.name,
          reversedByUid:       user.uid,
          reversalReason:      `Reversed by ${user.name} on ${fmtDate(new Date())}`,
          updatedAt:           serverTimestamp(),
        })

        // Agency budget release
        if (amount > 0 && (agency?.budget?.allocated ?? 0) > 0) {
          tx.update(doc(db, 'agencies', user.agencyId), {
            'budget.committed': increment(-amount),
          })
        }

        // Parent re-sync
        if (reqRef && reqSnap?.exists()) {
          const need = reqSnap.data().amountNeeded ?? 0
          const next = deriveRequestFinancials(siblings, need)
          tx.update(reqRef, {
            amountCommitted: next.amountCommitted,
            status:          syncedRequestStatus(reqSnap.data().status, next.status),
            updatedAt:       serverTimestamp(),
          })
        }
      })
      await notify(app.patientId, {
        type:  'app_advanced',
        title: 'Approval reversed',
        body:  `Your approved application to ${app.agencyName} has been returned to review. The agency may contact you with details.`,
      })
      if (app.endorsedById) {
        notify(app.endorsedById, {
          type:  'app_advanced',
          title: `${app.agencyName} reversed an approval`,
          body:  `${app.patientName}'s slice is back to review. The previously-secured amount is no longer guaranteed.`,
        }).catch(() => {})
      }
      logAudit(user, { action: 'approval_reversed', targetType: 'application', targetId: app.id, targetName: app.patientName, details: `₱${amount.toLocaleString()} released. Cooldown preserved until ${cooldownUntil?.toDate?.()?.toLocaleDateString?.() ?? 'n/a'}.`, requestId: app.requestId ?? null, patientId: app.patientId })
      toast.success('Approval reversed. Budget released. Cooldown preserved.')
      setShowConfirmReverse(false)
    } catch (err) { console.error(err); toast.error('Failed to reverse approval.') }
    finally { setUpdating(false) }
  }

  const handleMessagePatient = async () => {
    try {
      const convId = await getOrCreateConversation(user.uid, app.patientId, {
        names:   { [user.uid]: user.name, [app.patientId]: app.patientName },
        roles:   { [user.uid]: 'agency', [app.patientId]: 'patient' },
        subject: `Re: Application ${app.appId || app.id.slice(0, 8)}`,
      })
      navigate(`/agency/messages?conv=${convId}`)
    } catch {
      toast.error('Could not open conversation. Please try again.')
    }
  }

  // Direct ping to the gateway coordinator who endorsed this slice — closes the
  // agency -> the gateway ad-hoc-question loop without making the agency hunt for
  // the right admin in their messages list.
  const handleMessageGateway = async () => {
    if (!app?.endorsedById) return
    try {
      const convId = await getOrCreateConversation(user.uid, app.endorsedById, {
        names:   { [user.uid]: user.name, [app.endorsedById]: app.endorsedBy ?? ORG.gatewayName },
        roles:   { [user.uid]: user.role ?? 'agency', [app.endorsedById]: 'admin' },
        subject: `Re: Endorsed ${app.appId || app.id.slice(0, 8)} · ${app.patientName}`,
      })
      navigate(`/agency/messages?conv=${convId}`)
    } catch {
      toast.error('Could not open conversation. Please try again.')
    }
  }

  const handleAddNote = async () => {
    if (!newNote.trim()) return
    setSavingNote(true)
    try {
      const note = {
        text:      newNote.trim(),
        author:    user.name,
        authorUid: user.uid,
        createdAt: new Date().toISOString(),
      }
      const existingNotes = Array.isArray(app.caseNotes) ? app.caseNotes : []
      await updateDoc(doc(db, 'applications', app.id), {
        caseNotes: [...existingNotes, note],
        updatedAt: serverTimestamp(),
      })
      setNewNote('')
      toast.success('Case note added.')
    } catch { toast.error('Failed to save note.') }
    finally { setSavingNote(false) }
  }

  // ── Loading state ────────────────────────────────────────────────────

  if (appLoading || !app) return (
    <Layout breadcrumb="Application">
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="card p-5 animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-48 mb-3" />
            <div className="h-3 bg-gray-100 rounded w-64" />
          </div>
        ))}
      </div>
    </Layout>
  )

  // ── Derived values ───────────────────────────────────────────────────

  // Under the co-funding redesign, the assessment is single-sourced on the
  // parent request. Prefer request.intakeSheet (live data gateway owns); fall
  // back to app.intakeSheet for legacy pre-redesign slices.
  const effectiveIntake = request?.intakeSheet ?? app.intakeSheet
  const intakeReady     = isIntakeComplete(effectiveIntake)
  const expired         = isGLExpired(app)
  // Pre-expiry triage: still valid but the validity window closes soon.
  // Drives the amber header chip + a dedicated hint state in
  // getPrimaryActions so the coordinator's CTA reflects the urgency
  // before the GL actually lapses (and the budget has to be released).
  const expiringSoon    = isGLExpiringSoon(app)
  const isApproved      = ['approved', 'certificate'].includes(app.status)
  const intakeStatus    = requiredFieldsStatus({ ...(effectiveIntake ?? {}), completedBy: effectiveIntake?.completedBy ?? user.name }, user.name)
  const intakeDone    = intakeStatus.filter(r => r.done).length
  const intakeTotal   = intakeStatus.length

  // tsToDate() guards against legacy/seed data where submittedAt was stored
  // as a JS Date or ISO string instead of a Firestore Timestamp.
  const submittedDate = tsToDate(app.submittedAt)
  const days = submittedDate ? Math.floor((Date.now() - submittedDate.getTime()) / 86400000) : null
  const dayColor = days >= 7 ? 'text-red-500' : days >= 3 ? 'text-amber-600' : 'text-gray-500'

  // Visible sections
  const visibleSections = SECTION_DEFS.filter(s =>
    s.always || (s.forStatus && s.forStatus.includes(app.status))
  )

  // Section meta (counts, status chips)
  const sectionMeta = {
    overview:  null,
    intake:    intakeReady ? '✓' : `${intakeDone}/${intakeTotal}`,
    documents: patientDocs.length || null,
    gl:        app.glStatus ?? null,
    timeline:  (app.caseNotes ?? []).length || null,
  }

  // Primary actions for the hero
  const primary = getPrimaryActions({
    app,
    intakeReady,
    expired,
    expiringSoon,
    signedScan,
    navigate,
    handlers: {
      handleStartReview,
      handlePrintGL,
      handleRedeemGL,
      handleExpireGL,
      handleReverseApproval,
      handleResumeFromAwaiting,
      setShowApprove,
      setShowReject,
      setShowUpload,
      setShowRequestInfo,
    },
  })

  // Make sure the selected section is still valid (e.g., status changed)
  if (!visibleSections.find(s => s.id === section)) {
    setTimeout(() => setSection('overview'), 0)
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <Layout breadcrumb={`Application · ${app.patientName}`}>
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">

        {/* ── Thin nav strip ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <Link to={`/agency/inbox${queueFilter !== 'all' ? `?status=${queueFilter}` : ''}`}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600 font-medium">
            <MdArrowBack size={16} /> Back to Inbox
          </Link>
          {app.tenantId && caseHospital?.facilityName && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700"
              title="The hospital that assessed and endorsed this case">
              From {caseHospital.facilityName}
            </span>
          )}
          <div className="flex items-center gap-2">
            {queueIds.length > 0 && (
              <>
                <button disabled={!prevId} onClick={() => prevId && goTo(prevId)}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Previous in queue">
                  <MdArrowBack size={16} />
                </button>
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  {queueIndex >= 0 ? `${queueIndex + 1} of ${queueIds.length}` : '—'}
                </span>
                <button disabled={!nextId} onClick={() => nextId && goTo(nextId)}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Next in queue">
                  <MdArrowForward size={16} />
                </button>
              </>
            )}
            <button onClick={handleMessagePatient}
              className="btn-secondary text-sm flex items-center gap-1.5 ml-1">
              <MdMessage size={14} /> Message Patient
            </button>
            {app.endorsedById && (
              <button onClick={handleMessageGateway}
                className="btn-secondary text-sm flex items-center gap-1.5"
                title={`Message ${app.endorsedBy ?? ORG.gatewayName} (endorsing coordinator)`}>
                <MdMessage size={14} /> Message {ORG.gatewayName}
              </button>
            )}
          </div>
        </div>

        {/* ── Hero ── */}
        <div className="card p-5 mb-5">
          {/* Identity */}
          <div className="flex items-start gap-4 mb-4">
            <div className="w-12 h-12 rounded-full bg-brand-50 text-brand-600 text-base font-bold flex items-center justify-center flex-shrink-0">
              {app.patientName?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h1 className="text-lg font-bold text-gray-900">{app.patientName}</h1>
                <StatusBadge status={app.status} />
                {isApproved && app.glStatus && (
                  <span className={`badge text-xs ${
                    app.glStatus === 'redeemed' ? 'badge-green'
                    : app.glStatus === 'expired' ? 'bg-orange-100 text-orange-700'
                    : expired ? 'bg-orange-100 text-orange-700'
                    : expiringSoon ? 'bg-amber-100 text-amber-700'
                    : 'badge-blue'
                  }`}>
                    GL {expired && app.glStatus === 'issued'
                      ? 'expired'
                      : expiringSoon && app.glStatus === 'issued'
                        ? `expires in ${glDaysRemaining(app)}d`
                        : app.glStatus}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">
                <span className="font-mono">{app.appId}</span>
                <span className="mx-1 text-gray-300">·</span>
                {app.agencyName}
                <span className="mx-1 text-gray-300">·</span>
                Submitted {formatDate(app.submittedAt)}
                {app.approvedAt && (
                  <>
                    <span className="mx-1 text-gray-300">·</span>
                    Approved {formatDate(app.approvedAt)}
                  </>
                )}
                {days !== null && !['approved','certificate','rejected'].includes(app.status) && (
                  <>
                    <span className="mx-1 text-gray-300">·</span>
                    <span className={`font-medium ${dayColor}`}>{days === 0 ? 'Today' : `${days}d waiting`}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Compact stepper */}
          <CompactStepper app={app} />

          {/* Next-action banner */}
          {primary.hint && (
            <div className={`mt-4 rounded-xl border px-4 py-3 ${TONE_CLS[primary.tone]}`}>
              <p className="text-sm font-medium mb-2">
                {primary.actions.length > 0 ? <span className="font-semibold">Next: </span> : null}
                {primary.hint}
              </p>
              {primary.actions.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {primary.actions.map((a, i) => (
                    <button key={i} onClick={a.onClick} disabled={updating}
                      className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${VARIANT_CLS[a.variant]}`}>
                      <a.icon size={14} /> {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Two-column ── */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">

          {/* Section nav (1/4) */}
          <aside className="lg:col-span-1">
            <div className="lg:sticky lg:top-4 card p-2">
              {visibleSections.map(s => {
                const active = section === s.id
                const meta = sectionMeta[s.id]
                return (
                  <button key={s.id} onClick={() => setSection(s.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                      active
                        ? 'bg-brand-50 text-brand-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}>
                    <s.icon size={15} className={active ? 'text-brand-500' : 'text-gray-500'} />
                    <span className="flex-1 truncate">{s.label}</span>
                    {meta != null && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        meta === '✓'
                          ? 'bg-green-100 text-green-600'
                          : active ? 'bg-white text-brand-700 border border-brand-200' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {meta}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </aside>

          {/* Section content (3/4) */}
          <div className="lg:col-span-3 space-y-5">

            {/* OVERVIEW */}
            {section === 'overview' && (
              <>
                {/* Activity Timeline (§B.26) — chronological cross-agency
                    event feed for this case. Only rendered for co-funding
                    slices (have a requestId); legacy direct-apply slices
                    don't share a case context across agencies. */}
                {app.requestId && (
                  <CaseTimeline events={timeline} loading={timelineLoading} />
                )}

                {app.requestId && request && siblings.length > 0 && (() => {
                  const need = Number(request.amountNeeded) || 0
                  const { committed, outstanding, headroom, pct } = computeFunding(need, siblings)
                  const ordered = [...siblings].sort((a, b) =>
                    (a.id === app.id ? -1 : 0) - (b.id === app.id ? -1 : 0))
                  return (
                    <div className="card p-5">
                      <div className="flex items-center justify-between mb-3">
                        <p className="eyebrow flex items-center gap-2">
                          <MdAttachMoney size={13} /> Co-funding picture
                        </p>
                        {/* R36: "Suggest another agency" button — Bonterra
                            warm-handoff pattern. Visible only to agency_admin
                            on co-funded slices where there's still headroom
                            (no point suggesting more help if fully funded). */}
                        {user.role === 'agency_admin' && headroom > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowSuggest(true)}
                            className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
                          >
                            <MdGroups size={14} /> Suggest another agency
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500 mb-0.5">Total bill</p>
                          <p className="text-sm font-semibold text-gray-800">{peso(need)}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500 mb-0.5">Committed</p>
                          <p className="text-sm font-semibold text-green-700">{peso(committed)}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500 mb-0.5">In review</p>
                          <p className="text-sm font-semibold text-amber-600">{peso(outstanding)}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500 mb-0.5">Still open</p>
                          <p className="text-sm font-semibold text-gray-800">{peso(headroom)}</p>
                        </div>
                      </div>
                      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-green-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs text-gray-500 mt-2 mb-3">
                        {siblings.length} {siblings.length === 1 ? 'agency' : 'agencies'} on this bill · {pct}% committed toward zero balance
                      </p>
                      <div className="space-y-2">
                        {ordered.map(s => {
                          const secured = ['approved', 'certificate'].includes(s.status)
                          const amt     = secured ? (s.amountApproved ?? s.amountRequested) : s.amountRequested
                          const isMine  = s.id === app.id
                          return (
                            <div key={s.id} className={`flex items-center gap-3 p-2.5 rounded-lg border ${isMine ? 'border-brand-200 bg-brand-50' : 'border-gray-100'}`}>
                              <div className={`w-8 h-8 ${s.agencyColor ?? 'bg-gray-400'} rounded-lg text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}>
                                {s.agencyInitials ?? '—'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-800 truncate">
                                  {s.agencyName ?? 'Agency'}{isMine && <span className="text-brand-500 font-normal"> · You</span>}
                                </p>
                                <p className="text-xs text-gray-500">{peso(amt)}</p>
                              </div>
                              <StatusBadge status={s.status} className="flex-shrink-0" />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}

                <div className="card p-5">
                  <p className="eyebrow mb-3">Patient</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[
                      { label: 'Name',        value: app.patientName },
                      { label: 'Contact',     value: app.patientContact || '—' },
                      { label: 'Address',     value: patientProfile?.address || '—' },
                      { label: 'Access Code', value: app?.patientHospitalId || patientProfile?.hospitalId || '—' },
        { label: 'Care setting', value: careSettingLabel(request ?? app) },
                    ].map((r, i) => (
                      <div key={i} className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-0.5">{r.label}</p>
                        <p className="text-sm font-medium text-gray-800 break-words">{r.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {app.status === 'rejected' && app.rejectionReason && (
                  <div className="card p-5 border-l-4 border-red-300">
                    <p className="text-xs font-semibold text-red-700 uppercase tracking-widest mb-2">Rejection Reason</p>
                    <p className="text-sm text-gray-700 leading-relaxed">{app.rejectionReason}</p>
                  </div>
                )}

                {isApproved && app.approvedAmount != null && (
                  <div className="card p-5">
                    <p className="eyebrow mb-3 flex items-center gap-2">
                      <MdAttachMoney size={13} /> Approved Assistance
                    </p>
                    <p className="text-2xl font-bold text-gray-900 mb-2">₱{Number(app.approvedAmount).toLocaleString()}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      {app.purposeOfAssistance?.length > 0 && (
                        <div className="bg-gray-50 rounded-lg p-2"><p className="text-xs text-gray-500">For</p><p className="text-gray-700">{app.purposeOfAssistance.join(', ')}</p></div>
                      )}
                      {app.payableTo && (
                        <div className="bg-gray-50 rounded-lg p-2"><p className="text-xs text-gray-500">Payable to</p><p className="text-gray-700">{app.payableTo}</p></div>
                      )}
                      {app.approvedBy && (
                        <div className="bg-gray-50 rounded-lg p-2 sm:col-span-2"><p className="text-xs text-gray-500">Approved by</p><p className="text-gray-700">{app.approvedBy} · {formatDate(app.approvedAt)}</p></div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* INTAKE */}
            {section === 'intake' && (
              <div className="card p-5">
                <p className="eyebrow mb-3">Case Assessment <span className="text-gray-300 normal-case font-normal">· owned by {ORG.gatewayName}</span></p>
                <div className="flex items-start gap-3 mb-4">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    intakeReady ? 'bg-green-50' : effectiveIntake ? 'bg-amber-50' : 'bg-gray-100'
                  }`}>
                    <MdAssignment size={18} className={
                      intakeReady ? 'text-green-600' : effectiveIntake ? 'text-amber-600' : 'text-gray-500'
                    } />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800 mb-0.5">
                      {intakeReady ? `Completed by ${effectiveIntake.completedBy}` : `${intakeDone} of ${intakeTotal} required fields filled`}
                    </p>
                    <p className="text-xs text-gray-500">
                      {intakeReady
                        ? `${ORG.gatewayName}'s assessment is complete. Approval unlocked.`
                        : effectiveIntake ? `${ORG.gatewayName}'s assessment is still in progress.` : `${ORG.gatewayName} has not completed the assessment yet.`}
                    </p>
                  </div>
                </div>

                {/* LEGACY record: requests assessed before interview booking was
                    removed (docs/remove-interview-scheduling-plan.md) carry the
                    interview date/conductor/Meet link/outcome. Nothing writes
                    these any more; the panel only shows old cases (1 in
                    production, 2026-11-15). */}
                {request && (request.interviewDate || request.interviewOutcome) && (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-4">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <MdVideoCall size={14} className="text-blue-500 flex-shrink-0" />
                      <p className="text-sm font-medium text-blue-800">{ORG.gatewayName} Assessment Interview</p>
                      {request.interviewOutcome && (
                        <span className={`badge text-xs ml-auto ${
                          request.interviewOutcome === 'completed' ? 'badge-green'
                          : request.interviewOutcome === 'no_show' ? 'badge-red'
                          : 'badge-amber'
                        }`}>
                          {request.interviewOutcome === 'no_show' ? 'No-show' : request.interviewOutcome}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-blue-700 space-y-1">
                      {request.interviewDate && (
                        <p><span className="text-blue-500/70">When:</span> {request.interviewDate}{request.interviewTime ? ` at ${request.interviewTime}` : ''}</p>
                      )}
                      {request.conductedBy && (
                        <p><span className="text-blue-500/70">Conducted by:</span> {request.conductedBy}</p>
                      )}
                      {request.meetLink && (
                        <p className="truncate"><span className="text-blue-500/70">Meet:</span>{' '}
                          <a href={request.meetLink} target="_blank" rel="noopener noreferrer" className="underline break-all">{request.meetLink}</a>
                        </p>
                      )}
                      {request.interviewNotes && (
                        <p className="italic mt-1 bg-white/60 rounded px-2 py-1.5">"{request.interviewNotes}"</p>
                      )}
                    </div>
                  </div>
                )}

                {intakeReady && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs mb-4">
                    <div className="bg-gray-50 rounded-lg p-2"><p className="text-gray-500">Classification</p><p className="font-medium text-gray-800">{classificationSummary(effectiveIntake) || '—'}</p></div>
                    <div className="bg-gray-50 rounded-lg p-2"><p className="text-gray-500">Household Size</p><p className="font-medium text-gray-800">{effectiveIntake.householdSize ?? '—'}</p></div>
                    <div className="bg-gray-50 rounded-lg p-2"><p className="text-gray-500">Monthly Income</p><p className="font-medium text-gray-800">₱{Number(effectiveIntake.monthlyIncome ?? 0).toLocaleString()}</p></div>
                    <div className="bg-gray-50 rounded-lg p-2"><p className="text-gray-500">Estimated Cost</p><p className="font-medium text-gray-800">₱{Number(effectiveIntake.estimatedTotalCost ?? 0).toLocaleString()}</p></div>
                    <div className="bg-gray-50 rounded-lg p-2 sm:col-span-2"><p className="text-gray-500">Diagnosis</p><p className="font-medium text-gray-800">{effectiveIntake.diagnosis || '—'}</p></div>
                    {effectiveIntake.recommendation && (
                      <div className="bg-gray-50 rounded-lg p-2 sm:col-span-2"><p className="text-gray-500">Recommendation</p><p className="text-gray-800 italic">"{effectiveIntake.recommendation}"</p></div>
                    )}
                    {/* The hospital's signed Certificate of Eligibility (2026-11-16). */}
                    {request?.eligibilityCert?.status === 'signed' && (
                      <div className="bg-green-50 rounded-lg p-2 sm:col-span-2 flex items-center justify-between gap-2">
                        <p className="text-green-800">Certificate of Eligibility <span className="font-medium">{request.eligibilityCert.controlNo}</span> · signed copy on file</p>
                        <button className="text-xs font-semibold text-brand-700 hover:underline flex-shrink-0"
                          onClick={async () => {
                            try {
                              const snap = await getDoc(doc(db, 'eligibilityCertificates', request.eligibilityCert.id))
                              if (!snap.exists() || !openSignedScan(snap.data().signed)) toast.error('Could not open the certificate.')
                            } catch { toast.error('Could not open the certificate.') }
                          }}>
                          View
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <button className="btn-primary text-sm flex items-center gap-1.5"
                  onClick={() => navigate(`/agency/applications/${app.id}/intake`)}>
                  <MdAssignment size={14} />
                  View Assessment
                </button>
              </div>
            )}

            {/* DOCUMENTS */}
            {section === 'documents' && (
              <div className="card p-5">
                <p className="eyebrow mb-3">
                  Submitted Documents ({patientDocs.length})
                </p>
                {patientDocs.length === 0 ? (
                  <div className="text-center py-8">
                    <MdDescription size={32} className="text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No documents submitted with this application.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {patientDocs.map(d => (
                      <div key={d.id}>
                      <button
                        disabled={d._missing}
                        onClick={() => !d._missing && setViewingDoc(d)}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${
                          d._missing
                            ? 'bg-gray-50 opacity-60 cursor-not-allowed'
                            : d.updatedAfterSubmission
                              ? 'bg-amber-50 border border-amber-100 hover:bg-amber-100'
                              : 'bg-gray-50 hover:bg-gray-100'
                        }`}>
                        <MdDescription className="text-brand-500" size={18} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{d.documentTypeName || d.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <p className="text-xs text-gray-500">{d.date}</p>
                            {d.updatedAfterSubmission && (
                              <span className="text-xs font-semibold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">
                                Updated after submission
                              </span>
                            )}
                            {d._missing && (
                              <span className="text-xs text-red-400">File no longer available</span>
                            )}
                          </div>
                        </div>
                        <StatusBadge status={d.status ?? 'pending'} kind="doc" className="flex-shrink-0" />
                        {!d._missing && (
                          <span className="text-xs text-brand-500 font-medium flex-shrink-0">View →</span>
                        )}
                      </button>
                      </div>
                    ))}
                    {patientDocs.some(d => d.updatedAfterSubmission || d.status === 'pending') ? (
                      <p className="text-xs text-gray-500 mt-2 italic">{ORG.gatewayName} verified these documents before endorsement; any documents the patient re-uploaded since are pending re-verification.</p>
                    ) : (
                      <p className="text-xs text-gray-500 mt-2 italic">{ORG.gatewayName} verified these documents before endorsing. Click a document to view it.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* GL DOCUMENT */}
            {section === 'gl' && isApproved && (
              <>
                <GLDocumentPanel
                  app={app}
                  canReplace={user?.role === 'agency' || user?.role === 'agency_admin'}
                  onReplace={() => setShowUpload(true)}
                />
                {/* Section-specific actions */}
                <div className="card p-4 flex gap-2 flex-wrap">
                  {/* 2026-11-16: from approval, not only after Mark as Issued — the
                      signed letter can be uploaded (and used) before that step. */}
                  {['approved', 'certificate'].includes(app.status) && app.glStatus === 'issued' && !expired && (
                    <button className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg ${VARIANT_CLS['primary-green']}`}
                      disabled={updating} onClick={handleRedeemGL}>
                      <MdCheckCircle size={14} /> Mark GL Redeemed
                    </button>
                  )}
                  {['approved', 'certificate'].includes(app.status) && app.glStatus === 'issued' && expired && (
                    <button className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg ${VARIANT_CLS['primary-orange']}`}
                      disabled={updating} onClick={handleExpireGL}>
                      <MdWarning size={14} /> Mark GL Expired
                    </button>
                  )}
                  {(app.glStatus === 'issued' || app.glStatus === 'expired') && (
                    <button className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg ${VARIANT_CLS['secondary']}`}
                      disabled={updating} onClick={handleReverseApproval}>
                      <MdCancel size={14} /> Reverse Approval
                    </button>
                  )}
                  {app.status === 'approved' && app.glStatus !== 'redeemed' && app.glStatus !== 'expired' && (
                    <button className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg ${VARIANT_CLS['primary']}`}
                      disabled={updating} onClick={handlePrintGL}>
                      <MdPrint size={14} /> Print Guarantee Letter
                    </button>
                  )}
                  {app.status === 'certificate' && (
                    <button className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg ${VARIANT_CLS['secondary']}`}
                      disabled={updating} onClick={handlePrintGL}>
                      <MdPrint size={14} /> Re-print
                    </button>
                  )}
                  {app.glStatus === 'redeemed' && (
                    <>
                      <p className="text-sm text-green-700 italic flex-1">✓ GL redeemed on {formatDate(app.glRedeemedAt)}{app.redeemedAmount != null && Number(app.redeemedAmount) < Number(app.approvedAmount ?? 0) ? ` for ₱${Number(app.redeemedAmount).toLocaleString()} of ₱${Number(app.approvedAmount).toLocaleString()}` : ''}. Case complete.</p>
                      <button className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg ${VARIANT_CLS['secondary']}`}
                        disabled={updating}
                        title="Reverse the redemption — for correcting mistakes only"
                        onClick={handleUnmarkRedeemed}>
                        <MdCancel size={14} /> Reverse Redemption
                      </button>
                    </>
                  )}
                </div>
              </>
            )}

            {/* TIMELINE & NOTES */}
            {section === 'timeline' && (
              <>
                <div className="card p-5">
                  <p className="eyebrow mb-3">Application Timeline</p>
                  <div className="space-y-2">
                    {buildTimelineStages(app).map((s, i) => (
                      <div key={s.key} className="flex items-start gap-3">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5
                          ${s.done ? 'bg-brand-500 border-brand-500 text-white'
                          : s.active ? 'border-amber-400 bg-amber-50 text-amber-500'
                          : 'border-gray-200 bg-white text-gray-300'}`}>
                          {s.done ? '✓' : i + 1}
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${s.done ? 'text-gray-800' : s.active ? 'text-amber-700' : 'text-gray-500'}`}>
                            {s.label} {s.active && <span className="badge badge-amber text-xs ml-1">Current</span>}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card p-5">
                  <p className="eyebrow mb-3 flex items-center gap-2">
                    <MdNote size={13} /> Case Notes ({(app.caseNotes ?? []).length})
                  </p>
                  {(app.caseNotes ?? []).length === 0 ? (
                    <p className="text-sm text-gray-500 italic mb-3">No case notes yet. Add the first one below.</p>
                  ) : (
                    <div className="space-y-2 mb-3">
                      {[...(app.caseNotes ?? [])].reverse().map((n, i) => (
                        <div key={i} className="bg-gray-50 rounded-lg p-3">
                          <div className="flex items-baseline justify-between gap-2 mb-1">
                            <p className="text-xs font-medium text-gray-700">{n.author}</p>
                            <p className="text-xs text-gray-500">{new Date(n.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                          </div>
                          <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{n.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {!['rejected'].includes(app.status) && (
                    <div className="flex items-start gap-2 pt-2 border-t border-gray-100">
                      <textarea className="input flex-1 text-sm resize-none" rows={2}
                        placeholder="Add a case note (e.g. called patient on 5/19, no answer)…"
                        maxLength={500}
                        value={newNote} onChange={e => setNewNote(e.target.value)} />
                      <button className="btn-primary text-sm flex items-center gap-1 flex-shrink-0"
                        disabled={savingNote || !newNote.trim()}
                        onClick={handleAddNote}>
                        <MdAdd size={14} /> Add
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Sub-modals ── */}
        {showReject && (
          <RejectModal app={app} onConfirm={handleReject} onClose={() => setShowReject(false)} />
        )}
        {showApprove && (
          <ApproveModal app={app} agency={agency} currentUser={user}
            request={request}
            siblings={siblings}
            onConfirm={(data) => requireReauth(() => handleApprove(data))}
            onClose={() => setShowApprove(false)} />
        )}
        {showSuggest && (
          <SuggestEndorsementModal
            app={app}
            request={request}
            siblings={siblings}
            onClose={() => setShowSuggest(false)} />
        )}
        {showUpload && (
          <SignedGLUploadModal app={app} existing={signedScan} onClose={() => setShowUpload(false)} />
        )}
        {showRequestInfo && (
          <RequestInfoModal app={app}
            onConfirm={handleRequestInfo}
            onClose={() => setShowRequestInfo(false)} />
        )}
        {viewingDoc && (
          <DocViewerModal docMeta={viewingDoc} onClose={() => setViewingDoc(null)} />
        )}

        <ConfirmModal
          open={showConfirmRedeem}
          onClose={() => setShowConfirmRedeem(false)}
          onConfirm={performRedeemGL}
          title="Mark Guarantee Letter as Redeemed?"
          body={(
            <div className="space-y-2">
              <p>Record the amount {app?.payableTo ?? 'the provider'} actually billed against this letter (approved: ₱{Number(app?.approvedAmount ?? 0).toLocaleString()}).</p>
              <input type="number" min={0} max={Number(app?.approvedAmount ?? 0)} step="0.01"
                className="input w-full" aria-label="Amount billed"
                value={redeemAmount} onChange={e => setRedeemAmount(e.target.value)} />
              {Number(redeemAmount) >= 0 && Number(redeemAmount) < Number(app?.approvedAmount ?? 0) && redeemAmount !== '' && (
                <p className="text-xs text-gray-500">₱{(Number(app?.approvedAmount ?? 0) - Number(redeemAmount)).toLocaleString()} unused goes back to your budget.</p>
              )}
            </div>
          )}
          tone="success"
          confirmLabel="Mark Redeemed"
          confirmLabelBusy="Marking…"
        />

        <ConfirmModal
          open={showConfirmUnmark}
          onClose={() => setShowConfirmUnmark(false)}
          onConfirm={performUnmarkRedeemed}
          title="Reverse the redemption?"
          body={`This moves the letter back to "Issued": ₱${Number(app?.approvedAmount ?? 0).toLocaleString()} is committed again and the ₱${Number(app?.redeemedAmount ?? app?.approvedAmount ?? 0).toLocaleString()} recorded as billed is removed from disbursed. Use only to correct a mistaken Mark Redeemed.`}
          tone="warning"
          confirmLabel="Reverse Redemption"
          confirmLabelBusy="Reversing…"
        />

        <ConfirmModal
          open={showConfirmExpire}
          onClose={() => setShowConfirmExpire(false)}
          onConfirm={performExpireGL}
          title="Mark Guarantee Letter as Expired?"
          body={`The GL is past its validity date. The committed budget of ₱${Number(app?.approvedAmount ?? 0).toLocaleString()} will be released back to the agency.`}
          tone="warning"
          confirmLabel="Mark Expired"
          confirmLabelBusy="Marking…"
        />

        <ConfirmModal
          open={showConfirmReverse}
          onClose={() => setShowConfirmReverse(false)}
          onConfirm={() => requireReauth(performReverseApproval)}
          title="Reverse this approval?"
          body={`The application returns to 'Reviewing' status, the committed budget of ₱${Number(app?.approvedAmount ?? 0).toLocaleString()} is released, and the patient is notified.\n\nThe 30-day cooldown clock keeps running from the original approval date — the patient cannot be re-approved at any agency until the cooldown elapses.\n\nUse this only to correct mistakes, not to deny assistance after the fact.`}
          tone="warning"
          confirmLabel="Reverse Approval"
          confirmLabelBusy="Reversing…"
        />

        {/* Step-up re-auth for the GL-issuing approval + reversal above. */}
        <ReauthModal {...reauthProps} />

      </div>
    </Layout>
  )
}
