import Layout from '../../components/Layout'
import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import {
  collection, query, where, onSnapshot,
  doc, updateDoc, getDoc, getDocs, serverTimestamp,
  writeBatch, increment, runTransaction, Timestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import { logAudit } from '../../utils/auditLog'
import { getOrCreateConversation } from '../../utils/messages'
import { GL_VALIDITY_DAYS, isGLExpired } from '../../utils/constants'
import { computeFunding } from '../../utils/requests'
import StatusBadge from '../../components/ui/StatusBadge'
import {
  MdArrowBack, MdArrowForward, MdMessage, MdCheckCircle, MdCancel,
  MdDescription, MdAssignment, MdAttachMoney, MdVideoCall,
  MdNote, MdAdd, MdWarning,
  MdPrint, MdUpload, MdInfo, MdReceipt, MdHistory,
  MdHourglassEmpty, MdPlayArrow,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import { isIntakeComplete, requiredFieldsStatus } from '../../utils/intakeSheet'
import SignedGLUploadModal from '../../components/SignedGLUploadModal'
import GLDocumentPanel from '../../components/GLDocumentPanel'
import DocViewerModal from '../../components/DocViewerModal'
import ConfirmModal from '../../components/ConfirmModal'
import { RejectModal, ApproveModal, RequestInfoModal } from '../../components/agency/ApplicationModals'

// ── Helpers ───────────────────────────────────────────────────────────────
// Application status badge + label rendering is delegated to <StatusBadge />
// which reads APP_STATUS_CONFIG from constants.js.

const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`

// GL_VALIDITY_DAYS imported from utils/constants (single source of truth).
const tsToDate  = (ts) => !ts ? null : (ts.toDate ? ts.toDate() : new Date(ts))
const daysSince = (ts) => {
  const d = tsToDate(ts)
  return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null
}
// isGLExpired now imported from utils/constants -- shared with Inbox,
// Dashboard, and TrackStatus so all four surfaces agree on when an
// 'issued' GL is past its validity window.
const formatDate = (ts) => {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}
// Timeline stages derived from app status. The previous implementation
// updated a stored `stages` array on every status write, which (a) was
// dead data for new-model slices since the rich per-stage dates and
// notes were never written for them (sliceStages() in admin/Requests
// was dropped earlier this session), and (b) hardcoded a 6-stage flow
// that includes Document Verification and Interview Scheduled -- both
// CRMC-owned under the redesign, not agency-owned.
//
// Co-funding slice (has requestId): 4-stage Submit -> For Funding ->
// Approve -> GL Done (mirrors CompactStepper at the top of the page).
// Legacy direct-to-agency app (no requestId): original 6-stage view
// from before the redesign.
const buildTimelineStages = (app) => {
  const status = app?.status
  if (app?.requestId) {
    // New-model slice
    const SLICE_DEFS = [
      { key: 'endorsed',    label: 'Endorsed by CRMC' },
      { key: 'reviewing',   label: 'Under Funding Review' },
      { key: 'approved',    label: 'Approved' },
      { key: 'certificate', label: 'Guarantee Letter Issued' },
    ]
    const sliceDoneMap = {
      endorsed:      [],
      reviewing:     ['endorsed'],
      awaiting_info: ['endorsed'],
      approved:      ['endorsed', 'reviewing'],
      certificate:   ['endorsed', 'reviewing', 'approved'],
      rejected:      [],
    }
    const sliceActiveMap = {
      endorsed:      'endorsed',
      reviewing:     'reviewing',
      awaiting_info: 'reviewing',
      approved:      'approved',
      certificate:   'certificate',
      rejected:      null,
    }
    const doneKeys  = sliceDoneMap[status]  ?? []
    const activeKey = sliceActiveMap[status] ?? null
    return SLICE_DEFS.map(s => ({
      key:    s.key,
      label:  s.label,
      done:   doneKeys.includes(s.key),
      active: s.key === activeKey,
    }))
  }
  // Legacy direct-to-agency stepper
  const STAGE_DEFS = [
    { key: 'submitted',   label: 'Application Submitted' },
    { key: 'docs',        label: 'Document Verification' },
    { key: 'reviewing',   label: 'Under Agency Review' },
    { key: 'interview',   label: 'Interview Scheduled' },
    { key: 'approved',    label: 'Application Approved' },
    { key: 'certificate', label: 'Guarantee Letter Issued' },
  ]
  const doneMap = {
    pending:     ['submitted'],
    reviewing:   ['submitted', 'docs'],
    awaiting_info: ['submitted', 'docs'],
    interview:   ['submitted', 'docs', 'reviewing'],
    approved:    ['submitted', 'docs', 'reviewing', 'interview'],
    certificate: ['submitted', 'docs', 'reviewing', 'interview', 'approved'],
    rejected:    ['submitted'],
  }
  const activeMap = {
    pending:     'docs',
    reviewing:   'reviewing',
    awaiting_info: 'reviewing',
    interview:   'interview',
    approved:    'approved',
    certificate: 'certificate',
    rejected:    null,
  }
  const doneKeys  = doneMap[status]  ?? ['submitted']
  const activeKey = activeMap[status] ?? null
  return STAGE_DEFS.map(s => ({
    key:    s.key,
    label:  s.label,
    done:   doneKeys.includes(s.key),
    active: s.key === activeKey,
  }))
}

// Section definitions (ordered)
const SECTION_DEFS = [
  { id: 'overview',  label: 'Overview',          icon: MdInfo,        always: true },
  { id: 'intake',    label: 'Assessment',        icon: MdAssignment,  forStatus: ['reviewing','awaiting_info','interview','approved','certificate'] },
  { id: 'documents', label: 'Documents',         icon: MdDescription, always: true },
  { id: 'gl',        label: 'Guarantee Letter',  icon: MdReceipt,     forStatus: ['approved','certificate'] },
  { id: 'timeline',  label: 'Timeline & Notes',  icon: MdHistory,     always: true },
]

// ── Compact stepper (slimmer than the standalone card) ───────────────────

function CompactStepper({ app }) {
  if (app.status === 'rejected') return null

  const glRedeemed    = app.glStatus === 'redeemed'

  // Funding-only agency view: CRMC owns document review + assessment, so the
  // agency's track is just Submit -> For Funding -> Approve -> GL Done.
  const steps = [
    { key: 'submitted', label: 'Submit',      done: true,                                             active: false },
    { key: 'reviewing', label: 'For Funding', done: ['approved','certificate'].includes(app.status), active: ['reviewing','awaiting_info','interview'].includes(app.status) },
    { key: 'approved',  label: 'Approve',     done: ['approved','certificate'].includes(app.status), active: false },
    { key: 'gl',        label: 'GL Done',     done: glRedeemed,                                       active: app.status === 'certificate' && !glRedeemed },
  ]

  return (
    <div className="flex items-center gap-0 overflow-x-auto pb-1">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center flex-shrink-0">
          <div className="flex flex-col items-center min-w-14">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
              s.done ? 'bg-brand-500 text-white'
              : s.active ? 'border-2 border-amber-400 bg-amber-50 text-amber-500'
              : 'bg-gray-100 text-gray-300'
            }`}>
              {s.done ? '✓' : i + 1}
            </div>
            <p className={`text-xs mt-1 font-medium whitespace-nowrap ${
              s.done ? 'text-gray-700'
              : s.active ? 'text-amber-700'
              : 'text-gray-400'
            }`}>{s.label}</p>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 w-8 sm:w-12 mt-3 ${
              s.done && steps[i+1].done ? 'bg-brand-300'
              : s.done ? 'bg-amber-200'
              : 'bg-gray-100'
            }`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Compute the next-action CTA buttons for the hero ─────────────────────

function getPrimaryActions(ctx) {
  const { app, intakeReady, expired, handlers, navigate, signedScan } = ctx
  const goIntake = () => navigate(`/agency/applications/${app.id}/intake`)

  if (app.status === 'pending') {
    return {
      hint: 'Start the review to move this case forward.',
      tone: 'brand',
      actions: [
        { label: 'Start Review',      icon: MdCheckCircle, variant: 'primary',  onClick: handlers.handleStartReview },
        { label: 'Reject',            icon: MdCancel,      variant: 'danger',   onClick: () => handlers.setShowReject(true) },
      ],
    }
  }

  // Funding-only: CRMC already verified the documents and completed the
  // assessment (intake + interview), so the agency just decides funding.
  if (app.status === 'reviewing') {
    return {
      hint: 'CRMC verified the documents and completed the assessment. Approve your share and issue the GL, request more info, or reject.',
      tone: 'brand',
      actions: [
        { label: 'Approve & Issue GL', icon: MdCheckCircle,     variant: 'primary-green', onClick: () => handlers.setShowApprove(true) },
        { label: 'Request More Info',  icon: MdHourglassEmpty,  variant: 'secondary',     onClick: () => handlers.setShowRequestInfo(true) },
        { label: 'Reject',             icon: MdCancel,          variant: 'danger',        onClick: () => handlers.setShowReject(true) },
      ],
    }
  }

  if (app.status === 'awaiting_info') {
    return {
      hint: `Waiting on the patient. Requested: "${app.awaitingInfoMessage ?? '—'}"`,
      tone: 'amber',
      actions: [
        { label: 'Resume Review', icon: MdPlayArrow,    variant: 'primary',   onClick: handlers.handleResumeFromAwaiting },
        { label: 'Update Request', icon: MdHourglassEmpty, variant: 'secondary', onClick: () => handlers.setShowRequestInfo(true) },
        { label: 'Reject',        icon: MdCancel,       variant: 'danger',    onClick: () => handlers.setShowReject(true) },
      ],
    }
  }

  // Note: under the co-funding redesign, slices never reach status 'interview'
  // — the single assessment interview is on the parent request (CRMC-conducted),
  // not per-slice. Legacy interview branches removed.

  if (app.status === 'approved') {
    return {
      hint: 'Print the Guarantee Letter to issue it.',
      tone: 'brand',
      actions: [
        { label: 'Print Guarantee Letter', icon: MdPrint,  variant: 'primary',   onClick: handlers.handlePrintGL },
        { label: 'Reverse Approval',       icon: MdCancel, variant: 'secondary', onClick: handlers.handleReverseApproval },
      ],
    }
  }

  if (app.status === 'certificate' && app.glStatus === 'issued' && expired) {
    return {
      hint: `GL passed its ${GL_VALIDITY_DAYS}-day validity window — release the committed budget.`,
      tone: 'red',
      actions: [
        { label: 'Mark GL Expired',  icon: MdWarning, variant: 'primary-orange', onClick: handlers.handleExpireGL },
        { label: 'Reverse Approval', icon: MdCancel,  variant: 'secondary',      onClick: handlers.handleReverseApproval },
      ],
    }
  }

  if (app.status === 'certificate' && app.glStatus === 'issued' && !signedScan) {
    return {
      hint: 'Wet-sign the printed copy, then upload the scan so the patient can download it.',
      tone: 'amber',
      actions: [
        { label: 'Upload Signed Scan', icon: MdUpload, variant: 'primary',   onClick: () => handlers.setShowUpload(true) },
        { label: 'Re-print',           icon: MdPrint,  variant: 'secondary', onClick: handlers.handlePrintGL },
      ],
    }
  }

  if (app.status === 'certificate' && app.glStatus === 'issued' && signedScan) {
    return {
      hint: 'When the provider bills back, mark the GL as redeemed.',
      tone: 'brand',
      actions: [
        { label: 'Mark GL Redeemed', icon: MdCheckCircle, variant: 'primary-green', onClick: handlers.handleRedeemGL },
        { label: 'Reverse Approval', icon: MdCancel,      variant: 'secondary',     onClick: handlers.handleReverseApproval },
      ],
    }
  }

  if (app.glStatus === 'redeemed') {
    return { hint: '✓ Case complete — GL redeemed.', tone: 'green', actions: [] }
  }
  if (app.glStatus === 'expired') {
    return {
      hint: '⚠ GL expired — committed budget released.',
      tone: 'gray',
      actions: [
        { label: 'Reverse Approval', icon: MdCancel, variant: 'secondary', onClick: handlers.handleReverseApproval },
      ],
    }
  }
  if (app.status === 'rejected') {
    return { hint: 'Application rejected. No further action required.', tone: 'red', actions: [] }
  }

  return { hint: null, tone: 'gray', actions: [] }
}

const VARIANT_CLS = {
  'primary':         'bg-brand-500 text-white hover:bg-brand-600',
  'primary-green':   'bg-green-600  text-white hover:bg-green-700',
  'primary-orange':  'bg-orange-500 text-white hover:bg-orange-600',
  'secondary':       'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50',
  'danger':          'bg-white text-red-600  border border-red-200  hover:bg-red-50',
}

const TONE_CLS = {
  brand:  'bg-brand-50  border-brand-100  text-brand-700',
  amber:  'bg-amber-50  border-amber-100  text-amber-700',
  purple: 'bg-purple-50 border-purple-100 text-purple-700',
  red:    'bg-red-50    border-red-200    text-red-700',
  gray:   'bg-gray-50   border-gray-100   text-gray-600',
  green:  'bg-green-50  border-green-100  text-green-700',
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function ApplicationDetail() {
  const { id }         = useParams()
  const navigate       = useNavigate()
  const { user }       = useAuth()
  const [searchParams] = useSearchParams()
  const queueFilter    = searchParams.get('queue') ?? 'all'

  const [app, setApp]                       = useState(null)
  const [appLoading, setAppLoading]         = useState(true)
  const [request, setRequest]               = useState(null)
  const [siblings, setSiblings]             = useState([])
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
  // Confirm-modal flags for the four GL-lifecycle actions that used to
  // fire window.confirm. The actual action runs from the modal's onConfirm.
  const [showConfirmRedeem, setShowConfirmRedeem]       = useState(false)
  const [showConfirmUnmark, setShowConfirmUnmark]       = useState(false)
  const [showConfirmExpire, setShowConfirmExpire]       = useState(false)
  const [showConfirmReverse, setShowConfirmReverse]     = useState(false)
  const [viewingDoc, setViewingDoc]         = useState(null)
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
    if (!app?.patientId) return
    // Live subscription so the agency sees patient re-uploads while the
    // application is in 'awaiting_info' without a page reload. The query
    // returns every patient doc; if the slice has a frozen attachedDocuments
    // list, we project onto that list (preserving order + the per-doc
    // updatedAfterSubmission flag).
    const unsub = onSnapshot(
      query(collection(db, 'documents'), where('patientId', '==', app.patientId)),
      (snap) => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
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
  }, [app?.patientId, app?.attachedDocuments])

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

  const queueIndex = useMemo(() => queueIds.indexOf(id), [queueIds, id])
  const prevId = queueIndex > 0 ? queueIds[queueIndex - 1] : null
  const nextId = queueIndex >= 0 && queueIndex < queueIds.length - 1 ? queueIds[queueIndex + 1] : null
  const goTo   = (targetId) => navigate(`/agency/applications/${targetId}?queue=${queueFilter}`)

  // ── Status update handlers ───────────────────────────────────────────

  const updateStatus = async (newStatus, extra = {}) => {
    if (!app) return false
    setUpdating(true)
    try {
      await updateDoc(doc(db, 'applications', app.id), {
        status:    newStatus,
        updatedAt: serverTimestamp(),
        ...extra,
      })
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
  // interview is now on the parent request and conducted by CRMC.

  const handleApprove = async ({ approvedAmount, purposeOfAssistance, payableTo, approvedBy, approvedByUid }) => {
    setUpdating(true)
    try {
      // ── Pre-transaction cooldown gate (same-agency only).
      // Transactions can only read by doc-ref, not run collection queries,
      // so we check cooldown here. A second approval landing between this
      // check and the transaction is theoretically possible but extremely
      // narrow; the ApproveModal already shows a hard block when it loads.
      //
      // SCOPE: this query intentionally filters by agencyId so it only
      // returns applications from the SAME agency as the approver. A
      // patient-only query (no agencyId clause) returns every app the
      // patient has ever filed — including cross-agency ones — which
      // Firestore's rule engine then denies wholesale with
      // permission-denied because the read rule on /applications
      // requires resource.data.agencyId == userAgencyId() and the query
      // can't statically guarantee that for unconstrained patientId
      // queries. Cross-agency cooldown is already caught by the
      // hospitalIds check below (every approval stamps lastApprovedAt
      // on the patient's CRMC Hospital ID, so any agency's recent
      // approval is visible there).
      const COOLDOWN_DAYS = 30
      const now = Date.now()
      const recentSnap = await getDocs(query(
        collection(db, 'applications'),
        where('patientId', '==', app.patientId),
        where('agencyId',  '==', user.agencyId),
      ))
      const blocking = recentSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        // Co-funding: sibling slices of the SAME request are meant to be
        // approved by several agencies, so they never block each other. Only
        // approvals tied to a DIFFERENT (or no) request trip the cooldown.
        .filter(a => a.id !== app.id && !(app.requestId && a.requestId === app.requestId))
        .filter(a => {
          // Signal 1: live approval within window
          if (a.approvedAt && ['approved', 'certificate'].includes(a.status)) {
            const d = a.approvedAt.toDate ? a.approvedAt.toDate() : new Date(a.approvedAt)
            const days = Math.floor((now - d.getTime()) / 86400000)
            if (days <= COOLDOWN_DAYS) return true
          }
          // Signal 2: reversed approval whose cooldown hasn't elapsed yet
          if (a.cooldownUntilAt) {
            const until = a.cooldownUntilAt.toDate ? a.cooldownUntilAt.toDate() : new Date(a.cooldownUntilAt)
            if (until.getTime() > now) return true
          }
          return false
        })
      if (blocking.length > 0) {
        const b = blocking[0]
        const reversed = !!b.cooldownUntilAt && !b.approvedAt
        toast.error(
          reversed
            ? `This patient has an active cooldown from a reversed approval at ${b.agencyName}. ` +
              `The ${COOLDOWN_DAYS}-day window has not elapsed yet. Contact an administrator if a second approval is genuinely needed.`
            : `This patient was already approved by ${b.agencyName} less than ${COOLDOWN_DAYS} days ago ` +
              `(₱${Number(b.approvedAmount ?? 0).toLocaleString()}). Approval blocked. ` +
              `Contact an administrator if a second approval is genuinely needed.`,
          { duration: 8000 }
        )
        return
      }

      // #9 — Second cooldown gate: read the patient's hospitalIds doc.
      // This catches the abuse case where a patient deleted their account
      // and re-registered with a new email to bypass per-UID cooldown
      // tracking. The cooldownUntilAt on hospitalIds persists across
      // account churn because it's keyed by CRMC-issued ID, not by uid.
      // (Fall back to user doc if the app pre-dates the patientHospitalId
      // snapshot field added in MedicalPrograms.handleSubmit.)
      let patientHospitalId = app.patientHospitalId ?? null
      if (!patientHospitalId) {
        const userSnap = await getDoc(doc(db, 'users', app.patientId)).catch(() => null)
        patientHospitalId = userSnap?.data?.()?.hospitalId ?? null
      }
      // Skip the per-patient (hospital-ID) cooldown for co-funding slices —
      // one request is intentionally funded by several agencies in the same
      // window. The cross-request cooldown is enforced at request submission
      // (one active request at a time).
      if (patientHospitalId && !app.requestId) {
        const hidSnap = await getDoc(doc(db, 'hospitalIds', patientHospitalId)).catch(() => null)
        const hid = hidSnap?.exists?.() ? hidSnap.data() : null
        if (hid?.cooldownUntilAt) {
          const until = hid.cooldownUntilAt.toDate ? hid.cooldownUntilAt.toDate() : new Date(hid.cooldownUntilAt)
          if (until.getTime() > now) {
            toast.error(
              `This patient (Hospital ID ${patientHospitalId}) has an active cooldown until ${until.toLocaleDateString()}. ` +
              `Approval blocked. Contact an administrator if a second approval is genuinely needed.`,
              { duration: 8000 }
            )
            return
          }
        }
        if (hid?.lastApprovedAt) {
          const lastAp = hid.lastApprovedAt.toDate ? hid.lastApprovedAt.toDate() : new Date(hid.lastApprovedAt)
          const days = Math.floor((now - lastAp.getTime()) / 86400000)
          if (days <= COOLDOWN_DAYS) {
            toast.error(
              `This patient (Hospital ID ${patientHospitalId}) was approved less than ${COOLDOWN_DAYS} days ago ` +
              `(possibly under a different account). Approval blocked.`,
              { duration: 8000 }
            )
            return
          }
        }
      }

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
        const data       = agencySnap.exists() ? agencySnap.data() : {}
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
          glRedeemedAt:        null,
          updatedAt:           serverTimestamp(),
        })
        if (allocated > 0) {
          tx.update(agencyRef, {
            'budget.committed': increment(approvedAmount),
          })
        }

        // #9 — Stamp the patient's CRMC Hospital ID with the approval
        // timestamp so cooldown follows the human, not the account. If
        // the patient deletes their account and re-registers, the new
        // account inherits this cooldown automatically. Best-effort:
        // skipped if the hospital ID wasn't resolved earlier.
        if (patientHospitalId && !app.requestId) {
          tx.update(doc(db, 'hospitalIds', patientHospitalId), {
            lastApprovedAt: serverTimestamp(),
            cooldownUntilAt: null,  // clear any prior reversed-cooldown
          })
        }

        // Co-funding: advance the parent request. amountCommitted grows by the
        // approved amount; the request becomes fully_funded once the secured
        // total reaches the net need, else partially_funded. (The rule limits
        // agency writes here to amountCommitted/status/updatedAt.)
        if (reqSnap?.exists()) {
          const r            = reqSnap.data()
          const need         = r.amountNeeded ?? 0
          const newCommitted = (r.amountCommitted ?? 0) + approvedAmount
          // approvedAmount is always > 0 here (ApproveModal validates), so
          // newCommitted > 0 is guaranteed -- the request can only move into
          // 'fully_funded' or 'partially_funded'. The previous 'endorsing'
          // fallback was unreachable.
          const newStatus = (need > 0 && newCommitted >= need)
            ? 'fully_funded'
            : 'partially_funded'
          tx.update(reqRef, {
            amountCommitted: newCommitted,
            status:          newStatus,
            updatedAt:       serverTimestamp(),
          })
        }
      })

      await notify(app.patientId, {
        type:  'interview_approved',
        title: 'Application approved! 🎉',
        body:  `Your application to ${app.agencyName} is approved for ₱${approvedAmount.toLocaleString()} (${purposeOfAssistance.join(', ')}). A Guarantee Letter will be issued shortly.`,
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
      setShowApprove(false)
      toast.success('Application approved. Guarantee Letter pending issuance.')
    } catch (err) {
      console.error('[ApplicationDetail] approve error:', err?.code, err?.message, err)
      // Surface the explicit budget message; Firestore wraps thrown errors
      // from inside runTransaction in err.message.
      if (typeof err?.message === 'string' && err.message.startsWith('BUDGET_INSUFFICIENT:')) {
        toast.error(err.message.replace('BUDGET_INSUFFICIENT:', ''), { duration: 8000 })
      } else if (err?.code === 'permission-denied' || err?.message?.includes('permission')) {
        // Most common cause: agency user is trying to approve an application
        // that belongs to a different agency (agencyId mismatch). Could also
        // be a hospitalIds rule mismatch on the cooldown stamp.
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
    const submittedDate = app.submittedAt?.toDate?.()
    const isToday = submittedDate &&
      submittedDate.toDateString() === new Date().toDateString()
    if (isToday) {
      try {
        const agencyRef = doc(db, 'agencies', user.agencyId)
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(agencyRef)
          if (!snap.exists()) return
          const current = snap.data()?.slots?.remaining ?? 0
          const total   = snap.data()?.slots?.total    ?? 0
          tx.update(agencyRef, { 'slots.remaining': Math.min(current + 1, total) })
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
  const handleRedeemGL = () => setShowConfirmRedeem(true)
  const performRedeemGL = async () => {
    setUpdating(true)
    try {
      const amount = Number(app.approvedAmount) || 0
      const batch = writeBatch(db)
      batch.update(doc(db, 'applications', app.id), {
        glStatus:     'redeemed',
        glRedeemedAt: serverTimestamp(),
        updatedAt:    serverTimestamp(),
      })
      if (amount > 0 && (agency?.budget?.allocated ?? 0) > 0) {
        batch.update(doc(db, 'agencies', user.agencyId), {
          'budget.committed': increment(-amount),
          'budget.disbursed': increment(amount),
        })
      }
      await batch.commit()
      logAudit(user, { action: 'gl_redeemed', targetType: 'application', targetId: app.id, targetName: app.patientName, details: `₱${amount.toLocaleString()} redeemed by ${app.payableTo}` })
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
      const batch = writeBatch(db)
      batch.update(doc(db, 'applications', app.id), {
        glStatus:     'issued',
        glRedeemedAt: null,
        updatedAt:    serverTimestamp(),
      })
      if (amount > 0 && (agency?.budget?.allocated ?? 0) > 0) {
        batch.update(doc(db, 'agencies', user.agencyId), {
          'budget.committed': increment(amount),
          'budget.disbursed': increment(-amount),
        })
      }
      await batch.commit()
      logAudit(user, { action: 'gl_unmark_redeemed', targetType: 'application', targetId: app.id, targetName: app.patientName, details: `₱${amount.toLocaleString()} returned to committed (redemption reversed)` })
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
      const batch = writeBatch(db)
      batch.update(doc(db, 'applications', app.id), {
        glStatus:    'expired',
        glExpiredAt: serverTimestamp(),
        updatedAt:   serverTimestamp(),
      })
      if (amount > 0 && (agency?.budget?.allocated ?? 0) > 0) {
        batch.update(doc(db, 'agencies', user.agencyId), {
          'budget.committed': increment(-amount),
        })
      }
      await batch.commit()
      logAudit(user, { action: 'gl_expired', targetType: 'application', targetId: app.id, targetName: app.patientName, details: `₱${amount.toLocaleString()} released back to budget` })
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

      // Preserve cooldown: the patient was approved once, so the 30-day clock
      // keeps running from the original approvedAt. We stash an explicit
      // cooldownUntilAt so future approval checks still see the lock even
      // after approvedAt is cleared. Without this, reverse-then-reapprove
      // (here or at another agency) would silently bypass the cooldown.
      const COOLDOWN_DAYS = 30
      const original = app.approvedAt?.toDate ? app.approvedAt.toDate() : (app.approvedAt ? new Date(app.approvedAt) : null)
      const cooldownUntil = original
        ? Timestamp.fromDate(new Date(original.getTime() + COOLDOWN_DAYS * 86400000))
        : null

      const batch = writeBatch(db)
      batch.update(doc(db, 'applications', app.id), {
        status:              'reviewing',
        // Preserve approvedAmount and the other approval-context fields as
        // historical record. The status='reviewing' + approvedAt=null pair
        // is the authoritative "not currently approved" signal; every
        // consumer of approvedAmount also checks status. Keeping these
        // values populated lets the Funds history show real numbers and
        // lets the cooldown banner reference the original amount.
        approvedAt:          null,
        glStatus:            null,
        glRedeemedAt:        null,
        cooldownUntilAt:     cooldownUntil,
        reversedAt:          serverTimestamp(),
        reversedBy:          user.name,
        reversedByUid:       user.uid,
        reversalReason:      `Reversed by ${user.name} on ${new Date().toLocaleDateString()}`,
        updatedAt:           serverTimestamp(),
      })
      if (amount > 0 && (agency?.budget?.allocated ?? 0) > 0) {
        batch.update(doc(db, 'agencies', user.agencyId), {
          'budget.committed': increment(-amount),
        })
      }
      // #9 — Mirror cooldown to the patient's CRMC Hospital ID so the
      // 30-day lock survives an account delete + re-register cycle.
      let reversalHospitalId = app.patientHospitalId ?? null
      if (!reversalHospitalId) {
        const userSnap = await getDoc(doc(db, 'users', app.patientId)).catch(() => null)
        reversalHospitalId = userSnap?.data?.()?.hospitalId ?? null
      }
      if (reversalHospitalId && cooldownUntil) {
        batch.update(doc(db, 'hospitalIds', reversalHospitalId), {
          cooldownUntilAt: cooldownUntil,
        })
      }
      await batch.commit()
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
      logAudit(user, { action: 'approval_reversed', targetType: 'application', targetId: app.id, targetName: app.patientName, details: `₱${amount.toLocaleString()} released. Cooldown preserved until ${cooldownUntil?.toDate?.()?.toLocaleDateString?.() ?? 'n/a'}.` })
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

  // Direct ping to the CRMC coordinator who endorsed this slice — closes the
  // agency -> CRMC ad-hoc-question loop without making the agency hunt for
  // the right admin in their messages list.
  const handleMessageCrmc = async () => {
    if (!app?.endorsedById) return
    try {
      const convId = await getOrCreateConversation(user.uid, app.endorsedById, {
        names:   { [user.uid]: user.name, [app.endorsedById]: app.endorsedBy ?? 'CRMC' },
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
      <div className="p-4 sm:p-6 max-w-5xl space-y-4">
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
  // parent request. Prefer request.intakeSheet (live data CRMC owns); fall
  // back to app.intakeSheet for legacy pre-redesign slices.
  const effectiveIntake = request?.intakeSheet ?? app.intakeSheet
  const intakeReady     = isIntakeComplete(effectiveIntake)
  const expired         = isGLExpired(app)
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
      <div className="p-4 sm:p-6 max-w-5xl">

        {/* ── Thin nav strip ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <Link to={`/agency/inbox${queueFilter !== 'all' ? `?status=${queueFilter}` : ''}`}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600 font-medium">
            <MdArrowBack size={16} /> Back to Inbox
          </Link>
          <div className="flex items-center gap-2">
            {queueIds.length > 0 && (
              <>
                <button disabled={!prevId} onClick={() => prevId && goTo(prevId)}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Previous in queue">
                  <MdArrowBack size={16} />
                </button>
                <span className="text-xs text-gray-400 whitespace-nowrap">
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
              <button onClick={handleMessageCrmc}
                className="btn-secondary text-sm flex items-center gap-1.5"
                title={`Message ${app.endorsedBy ?? 'CRMC'} (endorsing coordinator)`}>
                <MdMessage size={14} /> Message CRMC
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
                    : 'badge-blue'
                  }`}>
                    GL {expired && app.glStatus === 'issued' ? 'expired' : app.glStatus}
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
                    <s.icon size={15} className={active ? 'text-brand-500' : 'text-gray-400'} />
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
                {app.requestId && request && siblings.length > 0 && (() => {
                  const need = Number(request.amountNeeded) || 0
                  const { committed, outstanding, headroom, pct } = computeFunding(need, siblings)
                  const ordered = [...siblings].sort((a, b) =>
                    (a.id === app.id ? -1 : 0) - (b.id === app.id ? -1 : 0))
                  return (
                    <div className="card p-5">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <MdAttachMoney size={13} /> Co-funding picture
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-400 mb-0.5">Total bill</p>
                          <p className="text-sm font-semibold text-gray-800">{peso(need)}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-400 mb-0.5">Committed</p>
                          <p className="text-sm font-semibold text-green-700">{peso(committed)}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-400 mb-0.5">In review</p>
                          <p className="text-sm font-semibold text-amber-600">{peso(outstanding)}</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-400 mb-0.5">Still open</p>
                          <p className="text-sm font-semibold text-gray-800">{peso(headroom)}</p>
                        </div>
                      </div>
                      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-green-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs text-gray-400 mt-2 mb-3">
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
                                <p className="text-xs text-gray-400">{peso(amt)}</p>
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
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Patient</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[
                      { label: 'Name',        value: app.patientName },
                      { label: 'Contact',     value: app.patientContact || '—' },
                      { label: 'Address',     value: patientProfile?.address || '—' },
                      { label: 'Access Code', value: patientProfile?.hospitalId || '—' },
                    ].map((r, i) => (
                      <div key={i} className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-400 mb-0.5">{r.label}</p>
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
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                      <MdAttachMoney size={13} /> Approved Assistance
                    </p>
                    <p className="text-2xl font-bold text-gray-900 mb-2">₱{Number(app.approvedAmount).toLocaleString()}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      {app.purposeOfAssistance?.length > 0 && (
                        <div className="bg-gray-50 rounded-lg p-2"><p className="text-xs text-gray-400">For</p><p className="text-gray-700">{app.purposeOfAssistance.join(', ')}</p></div>
                      )}
                      {app.payableTo && (
                        <div className="bg-gray-50 rounded-lg p-2"><p className="text-xs text-gray-400">Payable to</p><p className="text-gray-700">{app.payableTo}</p></div>
                      )}
                      {app.approvedBy && (
                        <div className="bg-gray-50 rounded-lg p-2 sm:col-span-2"><p className="text-xs text-gray-400">Approved by</p><p className="text-gray-700">{app.approvedBy} · {formatDate(app.approvedAt)}</p></div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* INTAKE */}
            {section === 'intake' && (
              <div className="card p-5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Case Assessment <span className="text-gray-300 normal-case font-normal">· owned by CRMC</span></p>
                <div className="flex items-start gap-3 mb-4">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    intakeReady ? 'bg-green-50' : effectiveIntake ? 'bg-amber-50' : 'bg-gray-100'
                  }`}>
                    <MdAssignment size={18} className={
                      intakeReady ? 'text-green-600' : effectiveIntake ? 'text-amber-600' : 'text-gray-400'
                    } />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800 mb-0.5">
                      {intakeReady ? `Completed by ${effectiveIntake.completedBy}` : `${intakeDone} of ${intakeTotal} required fields filled`}
                    </p>
                    <p className="text-xs text-gray-500">
                      {intakeReady
                        ? 'CRMC\'s assessment is complete. Approval unlocked.'
                        : effectiveIntake ? 'CRMC\'s assessment is still in progress.' : 'CRMC has not completed the assessment yet.'}
                    </p>
                  </div>
                </div>

                {/* CRMC-conducted assessment interview — read-only context for
                    the funding decision. Surfaces date/conductor/Meet link and
                    the recorded outcome + any free-text notes. */}
                {request && (request.interviewDate || request.interviewOutcome) && (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-4">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <MdVideoCall size={14} className="text-blue-500 flex-shrink-0" />
                      <p className="text-sm font-medium text-blue-800">CRMC Assessment Interview</p>
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
                    <div className="bg-gray-50 rounded-lg p-2"><p className="text-gray-400">Means-Test Category</p><p className="font-medium text-gray-800 capitalize">{effectiveIntake.meansTestCategory?.replace('_', ' ')}</p></div>
                    <div className="bg-gray-50 rounded-lg p-2"><p className="text-gray-400">Household Size</p><p className="font-medium text-gray-800">{effectiveIntake.householdSize ?? '—'}</p></div>
                    <div className="bg-gray-50 rounded-lg p-2"><p className="text-gray-400">Monthly Income</p><p className="font-medium text-gray-800">₱{Number(effectiveIntake.monthlyIncome ?? 0).toLocaleString()}</p></div>
                    <div className="bg-gray-50 rounded-lg p-2"><p className="text-gray-400">Estimated Cost</p><p className="font-medium text-gray-800">₱{Number(effectiveIntake.estimatedTotalCost ?? 0).toLocaleString()}</p></div>
                    <div className="bg-gray-50 rounded-lg p-2 sm:col-span-2"><p className="text-gray-400">Diagnosis</p><p className="font-medium text-gray-800">{effectiveIntake.diagnosis || '—'}</p></div>
                    {effectiveIntake.recommendation && (
                      <div className="bg-gray-50 rounded-lg p-2 sm:col-span-2"><p className="text-gray-400">Recommendation</p><p className="text-gray-800 italic">"{effectiveIntake.recommendation}"</p></div>
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
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
                  Submitted Documents ({patientDocs.length})
                </p>
                {patientDocs.length === 0 ? (
                  <div className="text-center py-8">
                    <MdDescription size={32} className="text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">No documents submitted with this application.</p>
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
                        <span className="text-lg">📄</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{d.documentTypeName || d.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <p className="text-xs text-gray-400">{d.date}</p>
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
                      <p className="text-xs text-gray-400 mt-2 italic">CRMC verified these documents before endorsement; any documents the patient re-uploaded since are pending re-verification.</p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-2 italic">CRMC verified these documents before endorsing. Click a document to view it.</p>
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
                  {app.status === 'certificate' && app.glStatus === 'issued' && !expired && (
                    <button className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg ${VARIANT_CLS['primary-green']}`}
                      disabled={updating} onClick={handleRedeemGL}>
                      <MdCheckCircle size={14} /> Mark GL Redeemed
                    </button>
                  )}
                  {app.status === 'certificate' && app.glStatus === 'issued' && expired && (
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
                  {app.status === 'approved' && (
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
                      <p className="text-sm text-green-700 italic flex-1">✓ GL redeemed on {formatDate(app.glRedeemedAt)}. Case complete.</p>
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
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Application Timeline</p>
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
                          <p className={`text-sm font-medium ${s.done ? 'text-gray-800' : s.active ? 'text-amber-700' : 'text-gray-400'}`}>
                            {s.label} {s.active && <span className="badge badge-amber text-xs ml-1">Current</span>}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card p-5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <MdNote size={13} /> Case Notes ({(app.caseNotes ?? []).length})
                  </p>
                  {(app.caseNotes ?? []).length === 0 ? (
                    <p className="text-sm text-gray-400 italic mb-3">No case notes yet. Add the first one below.</p>
                  ) : (
                    <div className="space-y-2 mb-3">
                      {[...(app.caseNotes ?? [])].reverse().map((n, i) => (
                        <div key={i} className="bg-gray-50 rounded-lg p-3">
                          <div className="flex items-baseline justify-between gap-2 mb-1">
                            <p className="text-xs font-medium text-gray-700">{n.author}</p>
                            <p className="text-xs text-gray-400">{new Date(n.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
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
            onConfirm={handleApprove}
            onClose={() => setShowApprove(false)} />
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
          body={`This records that ${app?.payableTo ?? 'the provider'} has billed back for ₱${Number(app?.approvedAmount ?? 0).toLocaleString()}. The agency's committed budget will move to disbursed.`}
          tone="success"
          confirmLabel="Mark Redeemed"
          confirmLabelBusy="Marking…"
        />

        <ConfirmModal
          open={showConfirmUnmark}
          onClose={() => setShowConfirmUnmark(false)}
          onConfirm={performUnmarkRedeemed}
          title="Reverse the redemption?"
          body={`This moves ₱${Number(app?.approvedAmount ?? 0).toLocaleString()} back from disbursed to committed and sets the Guarantee Letter back to "Issued". Use only to correct a mistaken Mark Redeemed.`}
          tone="warning"
          confirmLabel="Reverse Redemption"
          confirmLabelBusy="Reversing…"
        />

        <ConfirmModal
          open={showConfirmExpire}
          onClose={() => setShowConfirmExpire(false)}
          onConfirm={performExpireGL}
          title="Mark Guarantee Letter as Expired?"
          body={`The 30-day validity window has passed. The committed budget of ₱${Number(app?.approvedAmount ?? 0).toLocaleString()} will be released back to the agency.`}
          tone="warning"
          confirmLabel="Mark Expired"
          confirmLabelBusy="Marking…"
        />

        <ConfirmModal
          open={showConfirmReverse}
          onClose={() => setShowConfirmReverse(false)}
          onConfirm={performReverseApproval}
          title="Reverse this approval?"
          body={`The application returns to 'Reviewing' status, the committed budget of ₱${Number(app?.approvedAmount ?? 0).toLocaleString()} is released, and the patient is notified.\n\nThe 30-day cooldown clock keeps running from the original approval date — the patient cannot be re-approved at any agency until the cooldown elapses.\n\nUse this only to correct mistakes, not to deny assistance after the fact.`}
          tone="warning"
          confirmLabel="Reverse Approval"
          confirmLabelBusy="Reversing…"
        />

      </div>
    </Layout>
  )
}
