import { useState, useEffect } from 'react'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { MdClose, MdCheckCircle, MdHourglassEmpty, MdVideoCall, MdOpenInNew } from 'react-icons/md'
import toast from 'react-hot-toast'

const REQUEST_INFO_TEMPLATES = [
  'Please upload your most recent proof of income.',
  'Please upload an updated medical certificate.',
  'Please upload a valid government-issued ID (front and back).',
  'Your uploaded document is unclear — please re-upload a clearer scan or photo.',
]

const COOLDOWN_DAYS = 30

const tsToDate = (ts) => !ts ? null : (ts.toDate ? ts.toDate() : new Date(ts))
const daysSince = (ts) => {
  const d = tsToDate(ts)
  return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null
}

export const REJECT_TEMPLATES = [
  'Incomplete documents — please resubmit with all required documents.',
  'Does not meet income eligibility criteria for this program.',
  'Medical condition is not covered by this assistance program.',
  'Duplicate application — only one active application is allowed at a time.',
  'Slot limit reached — please apply again tomorrow.',
]

// ── Interview Modal (schedule + reschedule) ──────────────────────────────

export function InterviewModal({ app, agency, onConfirm, onClose }) {
  const { user } = useAuth()
  const defaultConductor = agency?.defaultSignatory?.trim() || user?.name || ''
  const [form, setForm] = useState({ date: '', time: '2:00 PM', link: '', conductedBy: defaultConductor })
  const set = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.value }))

  return (
    <div className="fixed inset-0 bg-black/40 z-[300] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Schedule Interview</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-gray-500">
            Scheduling interview for <strong>{app.patientName}</strong>
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Date <span className="text-red-400">*</span></label>
            <input type="date" className="input" value={form.date} onChange={set('date')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Time <span className="text-red-400">*</span></label>
            <input className="input" placeholder="e.g. 2:00 PM" value={form.time} onChange={set('time')} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-gray-700">Google Meet Link <span className="text-red-400">*</span></label>
              {/* meet.new is Google's official shortcut: opening it
                  instantly provisions a new Meet using the coordinator's
                  signed-in Google account and lands on the meeting URL,
                  which they can then copy from the address bar and
                  paste back here. Saves 30 sec / interview vs hunting
                  for meet.google.com manually. */}
              <a
                href="https://meet.new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1 group">
                <MdVideoCall size={14} className="text-brand-500 group-hover:text-brand-600" />
                Generate Meet
                <MdOpenInNew size={11} className="opacity-60" />
              </a>
            </div>
            <input className="input" placeholder="https://meet.google.com/..." value={form.link} onChange={set('link')} />
            <p className="text-xs text-gray-400 mt-1 leading-snug">
              Tap <strong>Generate Meet</strong> to create a new meeting in Google. Copy the URL from the new tab and paste it here.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Conducting Social Worker <span className="text-red-400">*</span></label>
            <input className="input" placeholder="Full name of conducting staff" value={form.conductedBy} onChange={set('conductedBy')} />
          </div>
        </div>
        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm"
            onClick={() => {
              if (!form.date || !form.time || !form.link || !form.conductedBy.trim()) {
                toast.error('Please fill in all fields.'); return
              }
              onConfirm(form)
            }}>
            Schedule Interview
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Reject Modal ─────────────────────────────────────────────────────────

export function RejectModal({ app, onConfirm, onClose }) {
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 bg-black/40 z-[300] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Reject Application</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
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

export function ApproveModal({ app, agency, currentUser, onConfirm, onClose }) {
  const [amount, setAmount]               = useState('')
  const [payableTo, setPayableTo]         = useState('')
  const [purposes, setPurposes]           = useState(new Set())
  const [saving, setSaving]               = useState(false)
  const [priorApproval, setPriorApproval] = useState(null)

  useEffect(() => {
    if (!app?.patientId) return
    // Match handleApprove's check: a live approval within the window OR a
    // reversed approval with a still-running cooldownUntilAt counts as a
    // prior approval that blocks the button.
    getDocs(query(
      collection(db, 'applications'),
      where('patientId', '==', app.patientId),
    )).then(snap => {
      const now = Date.now()
      const candidates = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(a => a.id !== app.id)
        .map(a => {
          if (a.approvedAt && ['approved', 'certificate'].includes(a.status)) {
            const days = daysSince(a.approvedAt)
            if (days != null && days <= COOLDOWN_DAYS) {
              return { ...a, _daysAgo: days, _reversed: false }
            }
          }
          if (a.cooldownUntilAt) {
            const until = a.cooldownUntilAt.toDate ? a.cooldownUntilAt.toDate() : new Date(a.cooldownUntilAt)
            if (until.getTime() > now) {
              const daysRemaining = Math.ceil((until.getTime() - now) / 86400000)
              return { ...a, _daysAgo: COOLDOWN_DAYS - daysRemaining, _reversed: true, _daysRemaining: daysRemaining }
            }
          }
          return null
        })
        .filter(Boolean)
        .sort((a, b) => a._daysAgo - b._daysAgo)
      if (candidates[0]) setPriorApproval(candidates[0])
    }).catch(() => {})
  }, [app?.patientId])

  const allocated = agency?.budget?.allocated ?? 0
  const committed = agency?.budget?.committed ?? 0
  const disbursed = agency?.budget?.disbursed ?? 0
  const remaining = Math.max(0, allocated - committed)
  const hasBudget = allocated > 0

  const purposeOptions = agency?.assistanceTypes ?? []

  const togglePurpose = (p) => {
    setPurposes(prev => {
      const next = new Set(prev)
      next.has(p) ? next.delete(p) : next.add(p)
      return next
    })
  }

  const amountNum = Number(amount) || 0
  const exceedsBudget = hasBudget && amountNum > remaining

  const handleSubmit = () => {
    if (amountNum <= 0)      { toast.error('Enter a valid amount greater than 0.'); return }
    if (purposes.size === 0) { toast.error('Select at least one purpose of assistance.'); return }
    if (!payableTo.trim())   { toast.error('Specify the provider (Payable To).'); return }
    if (exceedsBudget)       { toast.error(`Amount exceeds remaining budget of ₱${remaining.toLocaleString()}.`); return }

    setSaving(true)
    onConfirm({
      approvedAmount:      amountNum,
      purposeOfAssistance: Array.from(purposes),
      payableTo:           payableTo.trim(),
      approvedBy:          currentUser.name,
      approvedByUid:       currentUser.uid,
    }).finally(() => setSaving(false))
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[300] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Approve & Issue Guarantee Letter</h2>
            <p className="text-xs text-gray-400 mt-0.5">{app.patientName} · {app.appId}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {priorApproval && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-xs font-semibold text-red-800 mb-1">⛔ Approval will be blocked — cooldown active</p>
              {priorApproval._reversed ? (
                <p className="text-xs text-red-700 leading-relaxed">
                  This patient has an <strong>active cooldown from a reversed approval</strong> at <strong>{priorApproval.agencyName}</strong>
                  {priorApproval.approvedAmount > 0 && <> (originally <strong>₱{Number(priorApproval.approvedAmount).toLocaleString()}</strong>)</>}.
                  About <strong>{priorApproval._daysRemaining} day{priorApproval._daysRemaining === 1 ? '' : 's'}</strong> remaining on the {COOLDOWN_DAYS}-day window.
                </p>
              ) : (
                <p className="text-xs text-red-700 leading-relaxed">
                  This patient was already approved by <strong>{priorApproval.agencyName}</strong> {priorApproval._daysAgo} day{priorApproval._daysAgo === 1 ? '' : 's'} ago for <strong>₱{Number(priorApproval.approvedAmount ?? 0).toLocaleString()}</strong>
                  {priorApproval.purposeOfAssistance?.length > 0 && <> ({priorApproval.purposeOfAssistance.join(', ')})</>}.
                </p>
              )}
              <p className="text-xs text-red-700 mt-1">
                The {COOLDOWN_DAYS}-day cooldown is enforced at write time. Submitting will fail until the cooldown elapses. Contact an administrator if a second approval is genuinely needed.
              </p>
            </div>
          )}

          {hasBudget ? (
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
              <p className="text-xs text-gray-500 mb-1">Agency budget this period</p>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-gray-800">₱{remaining.toLocaleString()}</span>
                <span className="text-xs text-gray-400">remaining of ₱{allocated.toLocaleString()}</span>
              </div>
              <div className="w-full h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
                <div className={`h-full rounded-full ${committed / allocated > 0.9 ? 'bg-red-400' : committed / allocated > 0.7 ? 'bg-amber-400' : 'bg-green-400'}`}
                  style={{ width: `${Math.min(100, (committed / allocated) * 100)}%` }} />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                ₱{committed.toLocaleString()} committed · ₱{disbursed.toLocaleString()} disbursed
              </p>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-700">
              <strong>No budget allocated yet.</strong> The administrator can set an allocation on the Agency Detail page. Approvals can proceed but won't be tracked against a budget.
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Approved Amount (₱) <span className="text-red-400">*</span>
            </label>
            <input type="number" min={1} className={`input ${exceedsBudget ? 'border-red-400 bg-red-50' : ''}`}
              placeholder="e.g. 5000"
              value={amount} onChange={e => setAmount(e.target.value)} />
            {exceedsBudget && (
              <p className="text-xs text-red-500 mt-1">
                Exceeds remaining budget by ₱{(amountNum - remaining).toLocaleString()}.
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
              placeholder="e.g. CRMC Billing Department, Mercury Drug Cotabato"
              value={payableTo} onChange={e => setPayableTo(e.target.value)} />
            <p className="text-xs text-gray-400 mt-0.5">
              Provider/department that will redeem this Guarantee Letter.
            </p>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex gap-2 justify-end flex-shrink-0">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            disabled={saving || exceedsBudget || !!priorApproval}
            title={priorApproval ? `Blocked: prior approval within ${COOLDOWN_DAYS} days` : ''}
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

  return (
    <div className="fixed inset-0 bg-black/40 z-[300] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <MdHourglassEmpty size={20} className="text-amber-500" />
            <h2 className="text-base font-semibold text-gray-900">Request More Information</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
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
