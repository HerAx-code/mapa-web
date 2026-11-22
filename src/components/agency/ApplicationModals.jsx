import { useState, useEffect, useRef } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { MdClose, MdCheckCircle, MdHourglassEmpty } from 'react-icons/md'
import toast from 'react-hot-toast'
import { fmtDate } from '../../utils/dates'
import { approvalMarkId, approvalCooldownBlock, repeatLimitOf, OVERRIDE_REASON_MIN } from '../../utils/approvalCooldown'
import { ORG } from '../../config/org'

// This file keeps only the agency-specific modals (Reject / Approve /
// RequestInfo). The interview scheduling flow was removed in the async-
// assessment change (docs/remove-interview-scheduling-plan.md).

const REQUEST_INFO_TEMPLATES = [
  'Please upload your most recent proof of income.',
  'Please upload an updated medical certificate.',
  'Please upload a valid government-issued ID (front and back).',
  'Your uploaded document is unclear — please re-upload a clearer scan or photo.',
]

export const REJECT_TEMPLATES = [
  'Incomplete documents — please resubmit with all required documents.',
  'Does not meet income eligibility criteria for this program.',
  'Medical condition is not covered by this assistance program.',
  'Duplicate application — only one active application is allowed at a time.',
  'Slot limit reached — please apply again tomorrow.',
]

// ── Reject Modal ─────────────────────────────────────────────────────────

export function RejectModal({ app, onConfirm, onClose }) {
  const [reason, setReason] = useState('')
  const panelRef = useRef(null)
  useEscapeKey(onClose)
  useFocusTrap(panelRef, true)
  return (
    <div className="fixed inset-0 bg-black/40 z-[300] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-modal-title"
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden outline-none">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 id="reject-modal-title" className="text-base font-semibold text-gray-900">Reject Application</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-600"><MdClose size={20} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-gray-500">
            Rejecting application from <strong>{app.patientName}</strong>. The patient will be notified.
          </p>
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Common reasons — click to use:</p>
            <div className="flex flex-col gap-1.5">
              {REJECT_TEMPLATES.map((t, i) => (
                <button key={i} type="button"
                  className={`text-left text-xs px-3 py-2 rounded-lg border transition-colors ${
                    reason === t
                      ? 'bg-red-50 border-red-300 text-red-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                  onClick={() => setReason(reason === t ? '' : t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Or write a custom reason <span className="text-red-400">*</span>
            </label>
            <textarea className="input resize-none" rows={2}
              placeholder="Add additional context or a custom reason..."
              value={reason} onChange={e => setReason(e.target.value)} />
          </div>
        </div>
        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-danger text-sm"
            onClick={() => {
              if (!reason.trim()) { toast.error('Please select or enter a rejection reason.'); return }
              onConfirm(reason.trim())
            }}>
            Confirm Reject
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Approve / Issue GL Modal ─────────────────────────────────────────────

export function ApproveModal({ app, agency, currentUser, request = null, siblings = [], onConfirm, onClose }) {
  // Don't prefill the amount. Under the pure-selection endorsement model
  // amountRequested = the full bill, so prefilling it would tee up an
  // auto-approve-the-whole-thing — the opposite of the case-assessment
  // judgment we want the agency operator to apply.
  const [amount, setAmount]               = useState('')
  const [payableTo, setPayableTo]         = useState('')
  const [purposes, setPurposes]           = useState(new Set())
  const [saving, setSaving]               = useState(false)
  const [priorApproval, setPriorApproval] = useState(null)
  const [overrideReason, setOverrideReason] = useState('')
  const panelRef = useRef(null)
  useEscapeKey(onClose, !saving)
  useFocusTrap(panelRef, true)

  useEffect(() => {
    if (!app?.patientId || !currentUser?.agencyId) return
    // Same check as the rules (outsideRepeatLimit): this agency's last
    // approval for the patient (per assistance type when the agency counts
    // per type), unless it was for this same request.
    getDoc(doc(db, 'approvalMarks', approvalMarkId(currentUser.agencyId, app.patientId)))
      .then(snap => setPriorApproval(approvalCooldownBlock(
        snap.exists() ? snap.data() : null, app.requestId, Date.now(),
        repeatLimitOf(agency), request?.assistanceType ?? '')))
      .catch(() => {})
  }, [app?.patientId, app?.requestId, currentUser?.agencyId, agency?.repeatLimit?.days, agency?.repeatLimit?.perType, request?.assistanceType])

  const allocated = agency?.budget?.allocated ?? 0
  const committed = agency?.budget?.committed ?? 0
  const disbursed = agency?.budget?.disbursed ?? 0
  const remaining = Math.max(0, allocated - committed)
  const hasBudget = allocated > 0

  // Co-funding slice: the gateway endorsed a capped amount this agency may approve up
  // to. Approving less returns the remainder to the request balance.
  const isSlice  = !!app?.requestId
  const sliceCap = Number(app?.amountRequested) || 0

  // Maximum per approval (D10): the agency's policy ceiling per approval (PCSO
  // ₱25K, DSWD tier limits, etc.). Hard-enforced here; the gateway saw a soft warning
  // at endorse time.
  const perApplicantCap = Number(agency?.maxPerApplicant) || 0

  const purposeOptions = agency?.assistanceTypes ?? []

  const togglePurpose = (p) => {
    setPurposes(prev => {
      const next = new Set(prev)
      next.has(p) ? next.delete(p) : next.add(p)
      return next
    })
  }

  const amountNum = Number(amount) || 0
  const exceedsBudget    = hasBudget && amountNum > remaining
  const exceedsRequested = isSlice && sliceCap > 0 && amountNum > sliceCap
  const exceedsPerCap    = perApplicantCap > 0 && amountNum > perApplicantCap

  // R35 (§B.26 Item 1.3): live over-commitment guard. Sibling agencies on
  // the same request may have committed since this modal opened (the
  // siblings array updates via onSnapshot). Surface the running total so
  // the coordinator sees what their proposed amount adds to the network's
  // running total. Soft warning -- doesn't block submit -- because the
  // existing design explicitly allows controlled over-commitment (the gateway
  // sometimes intentionally over-endorses to give the patient a buffer).
  const needAmount = Number(request?.amountNeeded) || 0
  const siblingsCommitted = (siblings ?? [])
    .filter(s => s.id !== app?.id && ['approved', 'certificate'].includes(s.status) && s.glStatus !== 'expired')
    .reduce((sum, s) => sum + (Number(s.amountApproved) || 0), 0)
  const projectedTotal = siblingsCommitted + amountNum
  const overCommit     = needAmount > 0 && projectedTotal > needAmount
  // Phase 2A: an outpatient request is one charge slip — agencies together
  // may fund only up to it (rules-enforced). Inpatient keeps the soft warning.
  const outpatientOver = request?.careSetting === 'outpatient' && overCommit
  const fullFunded     = needAmount > 0 && projectedTotal === needAmount
  const pctOfBill      = needAmount > 0 ? Math.min(100, Math.round((projectedTotal / needAmount) * 100)) : 0

  // Quick-fill helpers (presentational only — one-tap setAmount, no math change):
  // the full endorsed slice, and the need still unfunded after sibling agencies'
  // commitments, capped at this slice. The input stays empty by default (operator
  // decides), but the two common cases are a single tap away.
  const remainingGap = isSlice
    ? Math.max(0, Math.min(sliceCap || needAmount, needAmount - siblingsCommitted))
    : 0

  const handleSubmit = () => {
    if (amountNum <= 0)      { toast.error('Enter a valid amount greater than 0.'); return }
    if (purposes.size === 0) { toast.error('Select at least one purpose of assistance.'); return }
    if (!payableTo.trim())   { toast.error('Specify the provider (Payable To).'); return }
    if (exceedsBudget)       { toast.error(`Amount exceeds remaining budget of ₱${remaining.toLocaleString()}.`); return }
    if (exceedsRequested)    { toast.error(`Amount exceeds the ₱${sliceCap.toLocaleString()} ${ORG.gatewayName} endorsed for this slice.`); return }
    if (outpatientOver)      { toast.error(`This outpatient charge is ₱${needAmount.toLocaleString()}; other agencies already cover ₱${siblingsCommitted.toLocaleString()}. Approve at most ₱${Math.max(0, needAmount - siblingsCommitted).toLocaleString()}.`); return }
    if (exceedsPerCap)       { toast.error(`Amount exceeds this agency's maximum per approval of ₱${perApplicantCap.toLocaleString()}.`); return }
    if (priorApproval && overrideReason.trim().length < OVERRIDE_REASON_MIN) {
      toast.error(`Give a reason (at least ${OVERRIDE_REASON_MIN} characters) for approving inside your repeat limit.`); return
    }

    setSaving(true)
    onConfirm({
      approvedAmount:      amountNum,
      purposeOfAssistance: Array.from(purposes),
      payableTo:           payableTo.trim(),
      approvedBy:          currentUser.name,
      approvedByUid:       currentUser.uid,
      repeatOverrideReason: priorApproval ? overrideReason.trim() : '',
    }).finally(() => setSaving(false))
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[300] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="approve-modal-title"
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden outline-none">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 id="approve-modal-title" className="text-base font-semibold text-gray-900">Approve & Issue Guarantee Letter</h2>
            <p className="text-xs text-gray-500 mt-0.5">{app.patientName} · {app.appId}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-600"><MdClose size={20} /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {priorApproval && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-800">Inside your repeat limit ({priorApproval.days} days{priorApproval.type ? `, ${priorApproval.type}` : ''})</p>
              <p className="text-xs text-amber-800 leading-relaxed">
                Your agency approved {priorApproval.type ? <strong>{priorApproval.type}</strong> : null}{priorApproval.type ? ' ' : ''}assistance for this patient <strong>{priorApproval.daysAgo} day{priorApproval.daysAgo === 1 ? '' : 's'} ago</strong>, on another request.
                The limit ends on <strong>{fmtDate(priorApproval.until)}</strong>. To approve now, record why; the reason is saved with the approval and in the audit log.
              </p>
              <textarea
                className="input text-xs w-full resize-none" rows={2} maxLength={300}
                placeholder="Reason for approving inside the limit (e.g. new admission, different bill)"
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
              />
            </div>
          )}

          {isSlice && (
            <div className="bg-brand-50 border border-brand-100 rounded-xl p-3 text-xs text-brand-700">
              <strong>Co-funded request.</strong> {ORG.gatewayName} referred this case asking you to cover up to <strong>₱{sliceCap.toLocaleString()}</strong> (the full bill). Approve what your agency can — other endorsed agencies are also assessing this case (see the application page for current coverage).
            </div>
          )}

          {/* the gateway's free-text referral note, if provided in EndorseModal. Shows
              the agency's coordinator the context the gateway wanted them to know. */}
          {app.gatewayNotes && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
              <p className="text-xs font-semibold text-amber-800 mb-0.5">Note from {ORG.gatewayName}</p>
              <p className="text-xs text-amber-700 leading-relaxed whitespace-pre-line">{app.gatewayNotes}</p>
            </div>
          )}

          {hasBudget ? (
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
              <p className="text-xs text-gray-500 mb-1">Agency budget this period</p>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-gray-800">₱{remaining.toLocaleString()}</span>
                <span className="text-xs text-gray-500">remaining of ₱{allocated.toLocaleString()}</span>
              </div>
              <div className="w-full h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
                <div className={`h-full rounded-full ${committed / allocated > 0.9 ? 'bg-red-400' : committed / allocated > 0.7 ? 'bg-amber-400' : 'bg-green-400'}`}
                  style={{ width: `${Math.min(100, (committed / allocated) * 100)}%` }} />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                ₱{committed.toLocaleString()} committed · ₱{disbursed.toLocaleString()} disbursed
              </p>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-700">
              <strong>No budget allocated yet.</strong> The administrator can set an allocation on the Agency Detail page. Approvals can proceed but won't be tracked against a budget.
            </div>
          )}

          {/* R35: live coordination signal. As the coordinator types an
              amount, show the projected total across the request. Updates
              live as sibling agencies approve/expire (siblings subscription
              is upstream in ApplicationDetail). Soft warning on
              over-commitment; positive cue on perfect fill. */}
          {isSlice && needAmount > 0 && (
            <div className={`rounded-xl p-3 border ${
              overCommit  ? 'bg-amber-50 border-amber-200'
              : fullFunded ? 'bg-green-50 border-green-200'
                           : 'bg-gray-50 border-gray-100'
            }`}>
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <p className={`text-xs font-semibold ${
                  overCommit  ? 'text-amber-800'
                  : fullFunded ? 'text-green-800'
                               : 'text-gray-600'
                }`}>
                  {overCommit  ? '⚠ Over-commitment warning'
                   : fullFunded ? '✓ Would fully fund this case'
                                 : 'Co-funding running total'}
                </p>
                <span className="text-xs text-gray-500">{pctOfBill}% of bill</span>
              </div>
              <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden mb-1.5">
                <div
                  className={`h-full rounded-full transition-all ${
                    overCommit  ? 'bg-amber-400'
                    : fullFunded ? 'bg-green-400'
                                 : 'bg-brand-400'
                  }`}
                  style={{ width: `${pctOfBill}%` }}
                />
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">
                Sibling agencies committed <strong>₱{siblingsCommitted.toLocaleString()}</strong>;
                your proposed <strong>₱{amountNum.toLocaleString()}</strong> would bring
                the total to <strong>₱{projectedTotal.toLocaleString()}</strong> of
                ₱{needAmount.toLocaleString()} needed.
                {overCommit && (
                  <> That's <strong>₱{(projectedTotal - needAmount).toLocaleString()} over</strong> the bill — another agency may have already covered this. {outpatientOver ? <>For an outpatient charge this is not allowed: lower your amount.</> : <>Coordinate via {ORG.gatewayName}, or lower your amount.</>}</>
                )}
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Approved Amount (₱) <span className="text-red-400">*</span>
            </label>
            {isSlice && sliceCap > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setAmount(String(sliceCap))}
                  className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 tabular-nums transition-colors hover:bg-brand-100">
                  Full ₱{sliceCap.toLocaleString()}
                </button>
                {remainingGap > 0 && remainingGap !== sliceCap && (
                  <button type="button" onClick={() => setAmount(String(remainingGap))}
                    className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 tabular-nums transition-colors hover:bg-gray-50">
                    Remaining ₱{remainingGap.toLocaleString()}
                  </button>
                )}
              </div>
            )}
            <input type="number" min={1} max={isSlice && sliceCap > 0 ? sliceCap : undefined}
              className={`input ${(exceedsBudget || exceedsRequested || exceedsPerCap) ? 'border-red-400 bg-red-50' : ''}`}
              placeholder="e.g. 5000"
              value={amount} onChange={e => setAmount(e.target.value)} />
            {isSlice && sliceCap > 0 && !exceedsRequested && (
              <p className="text-xs text-gray-500 mt-1">Bill total: ₱{sliceCap.toLocaleString()} — approve what your agency can.</p>
            )}
            {perApplicantCap > 0 && !exceedsPerCap && (
              <p className="text-xs text-gray-500 mt-1">Maximum per approval: ₱{perApplicantCap.toLocaleString()}.</p>
            )}
            {exceedsRequested && (
              <p className="text-xs text-red-500 mt-1">
                Exceeds the endorsed cap by ₱{(amountNum - sliceCap).toLocaleString()}.
              </p>
            )}
            {exceedsBudget && (
              <p className="text-xs text-red-500 mt-1">
                Exceeds remaining budget by ₱{(amountNum - remaining).toLocaleString()}.
              </p>
            )}
            {exceedsPerCap && (
              <p className="text-xs text-red-500 mt-1">
                Exceeds the maximum per approval of ₱{perApplicantCap.toLocaleString()} by ₱{(amountNum - perApplicantCap).toLocaleString()}.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Purpose of Assistance <span className="text-red-400">*</span>
            </label>
            {purposeOptions.length === 0 ? (
              <p className="text-xs text-amber-600">
                No assistance types configured for this agency. Ask an admin to add types via Agency Detail.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {purposeOptions.map(p => {
                  const selected = purposes.has(p)
                  return (
                    <button key={p} type="button"
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                        selected
                          ? 'bg-brand-500 text-white border-brand-500'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                      onClick={() => togglePurpose(p)}>
                      {selected && '✓ '}{p}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Payable To <span className="text-red-400">*</span>
            </label>
            <input className="input"
              placeholder="e.g. Hospital Billing Department, Mercury Drug Cotabato"
              value={payableTo} onChange={e => setPayableTo(e.target.value)} />
            <p className="text-xs text-gray-500 mt-0.5">
              Provider/department that will redeem this Guarantee Letter.
            </p>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex gap-2 justify-end flex-shrink-0">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            disabled={saving || exceedsBudget || exceedsRequested || exceedsPerCap || outpatientOver || (!!priorApproval && overrideReason.trim().length < OVERRIDE_REASON_MIN)}
            title={priorApproval && overrideReason.trim().length < OVERRIDE_REASON_MIN ? 'Give a reason for approving inside your repeat limit' : ''}
            onClick={handleSubmit}>
            <MdCheckCircle size={14} className="inline -mt-0.5 mr-1" />
            {saving ? 'Approving…' : 'Approve & Issue GL'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Request More Info Modal ──────────────────────────────────────────────
// Coordinator writes a short message asking the patient for additional
// documents or clarification. Status flips to awaiting_info; the app stays
// out of the urgent queue. Auto-reverts to reviewing when the patient uploads
// any new document.

export function RequestInfoModal({ app, onConfirm, onClose }) {
  const [message, setMessage] = useState('')
  const [saving, setSaving]   = useState(false)
  const panelRef = useRef(null)
  useEscapeKey(onClose, !saving)
  useFocusTrap(panelRef, true)

  return (
    <div className="fixed inset-0 bg-black/40 z-[300] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="requestinfo-modal-title"
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden outline-none">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <MdHourglassEmpty size={20} className="text-amber-500" />
            <h2 id="requestinfo-modal-title" className="text-base font-semibold text-gray-900">Request More Information</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-600"><MdClose size={20} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-gray-500">
            Pauses this application from the urgent queue and notifies <strong>{app.patientName}</strong>.
            The application will automatically return to Reviewing when the patient uploads a new document.
          </p>
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Common requests — click to use:</p>
            <div className="flex flex-col gap-1.5">
              {REQUEST_INFO_TEMPLATES.map((t, i) => (
                <button key={i} type="button"
                  className={`text-left text-xs px-3 py-2 rounded-lg border transition-colors ${
                    message === t
                      ? 'bg-amber-50 border-amber-300 text-amber-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                  onClick={() => setMessage(message === t ? '' : t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Message to patient <span className="text-red-400">*</span>
            </label>
            <textarea className="input resize-none" rows={3}
              placeholder="Describe what's needed and why…"
              value={message} onChange={e => setMessage(e.target.value)} />
          </div>
        </div>
        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button
            className="text-sm bg-amber-500 text-white px-3 py-1.5 rounded-lg hover:bg-amber-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
            disabled={saving || !message.trim()}
            onClick={() => {
              if (!message.trim()) { toast.error('Please write a message to the patient.'); return }
              setSaving(true)
              Promise.resolve(onConfirm(message.trim())).finally(() => setSaving(false))
            }}>
            {saving ? 'Sending…' : 'Send Request'}
          </button>
        </div>
      </div>
    </div>
  )
}
