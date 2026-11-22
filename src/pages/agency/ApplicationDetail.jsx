import Layout from '../../components/Layout'
import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import {
  collection, query, where, orderBy, onSnapshot,
  doc, updateDoc, getDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { ORG } from '../../config/org'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import { decideSlice, settleLetter } from '../../utils/sliceActions'
import { getOrCreateConversation } from '../../utils/messages'
import { isGLExpired, isGLExpiringSoon, glDaysRemaining } from '../../utils/constants'
import { tsToDate, fmtDate } from '../../utils/dates'
import { computeFunding, sliceApproved } from '../../utils/requests'
import { careSettingLabel } from '../../utils/outpatient'
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
  // Phase 2 PR 2.3: every decision and letter action runs on the server
  // (decideSlice / settleLetter), which re-reads the slice, the request, the
  // sibling slices and the budget in one transaction, moves the budget, writes
  // the request's totals, the audit entry and the notifications. The page only
  // asks; the rules refuse a direct write. The server's message is shown as is.

  const runAction = async (call, okMessage, failMessage) => {
    if (!app) return false
    setUpdating(true)
    try {
      await call()
      if (okMessage) toast.success(okMessage)
      return true
    } catch (err) {
      console.error('[ApplicationDetail]', err?.code, err?.message)
      toast.error(err?.message && err?.code !== 'functions/internal' ? err.message : failMessage, { duration: 8000 })
      return false
    } finally {
      setUpdating(false)
    }
  }
  const decide = (action, extra = {}) => decideSlice({ sliceId: app.id, action, ...extra })
  const settle = (action, extra = {}) => settleLetter({ sliceId: app.id, action, ...extra })

  const handleRequestInfo = async (message) => {
    const ok = await runAction(() => decide('request_info', { message }),
      'Patient notified. Application paused from the urgent queue.', 'Failed to request more information.')
    if (ok) setShowRequestInfo(false)
  }

  // Manual resume — the coordinator decides the patient has responded enough
  // to move on, or the request was sent in error.
  const handleResumeFromAwaiting = () =>
    runAction(() => decide('resume'), 'Application resumed. Back in the active queue.', 'Failed to resume the application.')

  const handleApprove = async ({ approvedAmount, purposeOfAssistance, payableTo, repeatOverrideReason = '' }) => {
    if (!app.requestId) {
      toast.error('This slice is not linked to a request and cannot be approved.')
      return
    }
    const ok = await runAction(
      () => decide('approve', { amount: approvedAmount, purposeOfAssistance, payableTo, repeatOverrideReason }),
      'Application approved. Guarantee Letter pending issuance.', 'Failed to approve application.')
    if (ok) setShowApprove(false)
  }

  const handleReject = async (reason) => {
    const ok = await runAction(() => decide('reject', { reason }), null, 'Failed to reject application.')
    if (!ok) return
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

  // Each of the GL lifecycle actions below opens an in-app ConfirmModal (see
  // the render at the end of the page); its onConfirm runs the performX.
  const handleRedeemGL = () => { setRedeemAmount(String(sliceApproved(app) || '')); setShowConfirmRedeem(true) }
  const performRedeemGL = async () => {
    // Settle on what the provider actually billed (Phase 1): the whole
    // approved amount leaves "committed", only the billed amount is disbursed.
    const amount = sliceApproved(app)
    const actual = Number(redeemAmount)
    if (redeemAmount === '' || !Number.isFinite(actual) || actual < 0 || actual > amount) {
      toast.error(`Enter the amount billed, from ₱0 up to the approved ₱${amount.toLocaleString()}.`)
      return
    }
    const ok = await runAction(() => settle('redeem', { redeemedAmount: actual }), 'GL marked as redeemed.', 'Failed to mark GL redeemed.')
    if (ok) setShowConfirmRedeem(false)
  }

  // Reverses a mistaken Mark Redeemed: the amount moves back from disbursed
  // to committed and the letter is open again. Audited.
  const handleUnmarkRedeemed = () => setShowConfirmUnmark(true)
  const performUnmarkRedeemed = async () => {
    const ok = await runAction(() => settle('undo_redeem'), 'Redemption reversed. Amount returned to committed.', 'Failed to reverse redemption.')
    if (ok) setShowConfirmUnmark(false)
  }

  const handleExpireGL = () => setShowConfirmExpire(true)
  const performExpireGL = async () => {
    const ok = await runAction(() => settle('expire'), 'GL marked as expired. Budget released.', 'Failed to mark GL expired.')
    if (ok) setShowConfirmExpire(false)
  }

  // Back to review, the letter withdrawn and the budget released. The repeat
  // limit keeps running from the original approval (the mark is kept).
  const handleReverseApproval = () => setShowConfirmReverse(true)
  const performReverseApproval = async () => {
    const ok = await runAction(() => settle('reverse'), 'Approval reversed. Budget released.', 'Failed to reverse approval.')
    if (ok) setShowConfirmReverse(false)
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

                {isApproved && sliceApproved(app) > 0 && (
                  <div className="card p-5">
                    <p className="eyebrow mb-3 flex items-center gap-2">
                      <MdAttachMoney size={13} /> Approved Assistance
                    </p>
                    <p className="text-2xl font-bold text-gray-900 mb-2">₱{sliceApproved(app).toLocaleString()}</p>
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
                      <p className="text-sm text-green-700 italic flex-1">✓ GL redeemed on {formatDate(app.glRedeemedAt)}{app.redeemedAmount != null && Number(app.redeemedAmount) < sliceApproved(app) ? ` for ₱${Number(app.redeemedAmount).toLocaleString()} of ₱${sliceApproved(app).toLocaleString()}` : ''}. Case complete.</p>
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
              <p>Record the amount {app?.payableTo ?? 'the provider'} actually billed against this letter (approved: ₱{sliceApproved(app).toLocaleString()}).</p>
              <input type="number" min={0} max={sliceApproved(app)} step="0.01"
                className="input w-full" aria-label="Amount billed"
                value={redeemAmount} onChange={e => setRedeemAmount(e.target.value)} />
              {Number(redeemAmount) >= 0 && Number(redeemAmount) < sliceApproved(app) && redeemAmount !== '' && (
                <p className="text-xs text-gray-500">₱{(sliceApproved(app) - Number(redeemAmount)).toLocaleString()} unused goes back to your budget.</p>
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
          body={`This moves the letter back to "Issued": ₱${sliceApproved(app).toLocaleString()} is committed again and the ₱${Number(app?.redeemedAmount ?? sliceApproved(app)).toLocaleString()} recorded as billed is removed from disbursed. Use only to correct a mistaken Mark Redeemed.`}
          tone="warning"
          confirmLabel="Reverse Redemption"
          confirmLabelBusy="Reversing…"
        />

        <ConfirmModal
          open={showConfirmExpire}
          onClose={() => setShowConfirmExpire(false)}
          onConfirm={performExpireGL}
          title="Mark Guarantee Letter as Expired?"
          body={`The GL is past its validity date. The committed budget of ₱${sliceApproved(app).toLocaleString()} will be released back to the agency.`}
          tone="warning"
          confirmLabel="Mark Expired"
          confirmLabelBusy="Marking…"
        />

        <ConfirmModal
          open={showConfirmReverse}
          onClose={() => setShowConfirmReverse(false)}
          onConfirm={() => requireReauth(performReverseApproval)}
          title="Reverse this approval?"
          body={`The application returns to 'Reviewing' status, the committed budget of ₱${sliceApproved(app).toLocaleString()} is released, and the patient is notified.\n\nYour agency's repeat limit keeps running from the original approval date — approving this patient again on another request inside it needs a written reason.\n\nUse this only to correct mistakes, not to deny assistance after the fact.`}
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
