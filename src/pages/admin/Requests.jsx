import { useState, useEffect } from 'react'
import Layout from '../../components/Layout'
import {
  collection, query, where, onSnapshot, doc, getDocs,
  serverTimestamp, runTransaction, arrayUnion,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import { logAudit } from '../../utils/auditLog'
import { computeFunding } from '../../utils/requests'
import { REQUEST_STATUS_CONFIG } from '../../utils/constants'
import {
  MdClose, MdWarning, MdReceiptLong, MdLocalHospital, MdSend,
  MdPerson, MdAttachFile, MdBlock, MdCheckCircle,
} from 'react-icons/md'
import toast from 'react-hot-toast'

const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`

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
          status:    'endorsing',
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
                  {eligible.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name}{a.matches ? ' ✓' : ''} · {a.slots?.remaining ?? 0} slots
                    </option>
                  ))}
                </select>
                {eligible.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">No eligible agencies (need open slots and not already endorsed).</p>
                )}
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
  const [slices, setSlices] = useState([])
  const [showEndorse, setShowEndorse] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'applications'), where('requestId', '==', request.id)),
      snap => setSlices(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => {},
    )
    return unsub
  }, [request.id])

  const funding = computeFunding(request.amountNeeded, slices)
  const cfg = REQUEST_STATUS_CONFIG[request.status] ?? REQUEST_STATUS_CONFIG.submitted
  const terminal = ['fully_funded', 'closed', 'rejected'].includes(request.status)

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
    <div className="fixed inset-0 bg-black/40 z-[150] flex items-end sm:items-center justify-center sm:p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 truncate">{request.patientName}</h2>
            <p className="text-xs text-gray-400">{request.requestId} · {request.assistanceType}</p>
          </div>
          <span className={`badge text-xs ${cfg.badge}`}>{cfg.label}</span>
          <button onClick={onClose} className="ml-2 text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Amounts */}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-400">Total bill</p><p className="font-semibold text-gray-800">{peso(request.totalBill)}</p></div>
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-400">PhilHealth</p><p className="font-semibold text-gray-800">{peso(request.philhealthCovered)}</p></div>
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-400">Other aid</p><p className="font-semibold text-gray-800">{peso(request.otherCovered)}</p></div>
            <div className="bg-brand-50 rounded-lg p-3"><p className="text-xs text-brand-700">Net needed</p><p className="font-semibold text-brand-700">{peso(request.amountNeeded)}</p></div>
          </div>

          {/* Funding progress */}
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>{peso(funding.committed)} secured · {peso(funding.outstanding)} pending</span>
              <span>{peso(funding.balance)} remaining</span>
            </div>
            <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-green-400 rounded-full transition-all" style={{ width: `${funding.pct}%` }} />
            </div>
          </div>

          {request.description && (
            <div className="text-sm text-gray-600"><span className="text-xs text-gray-400 block mb-0.5">Description</span>{request.description}</div>
          )}

          {/* Patient + docs */}
          <div className="text-xs text-gray-500 space-y-1">
            <p className="flex items-center gap-1.5"><MdPerson size={13} className="text-gray-400" /> {request.patientContact || 'No contact'} · {request.patientAddress || 'No address'}</p>
            <p className="flex items-center gap-1.5"><MdAttachFile size={13} className="text-gray-400" /> {(request.attachedDocuments?.length ?? 0)} document(s) attached · submitted {fmtDate(request.submittedAt)}</p>
          </div>

          {/* Slices */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Endorsed agencies</p>
            {slices.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Not yet endorsed to any agency.</p>
            ) : (
              <div className="space-y-2">
                {slices.map(s => (
                  <div key={s.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-100">
                    <div className={`w-8 h-8 ${s.agencyColor ?? 'bg-gray-400'} rounded-lg text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}>
                      {s.agencyInitials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{s.agencyName}</p>
                      <p className="text-xs text-gray-400">Asked {peso(s.amountRequested)}{s.amountApproved > 0 ? ` · approved ${peso(s.amountApproved)}` : ''}</p>
                    </div>
                    <span className="badge badge-gray text-xs flex-shrink-0">{s.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        {!terminal && (
          <div className="px-5 pb-4 pt-2 flex flex-wrap gap-2 justify-end border-t border-gray-50 sticky bottom-0 bg-white">
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
            <button className="btn-primary text-sm flex items-center gap-1.5" onClick={() => setShowEndorse(true)} disabled={busy}>
              <MdSend size={14} /> Endorse
            </button>
          </div>
        )}
      </div>

      {showEndorse && (
        <EndorseModal request={request} slices={slices} agencies={agencies} onClose={() => setShowEndorse(false)} />
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

  const needsAction = requests.filter(r => ['submitted', 'verifying'].includes(r.status))
  const inProgress  = requests.filter(r => ['endorsing', 'partially_funded'].includes(r.status))
  const done        = requests.filter(r => ['fully_funded', 'closed', 'rejected'].includes(r.status))

  const card = (r) => {
    const cfg = REQUEST_STATUS_CONFIG[r.status] ?? REQUEST_STATUS_CONFIG.submitted
    return (
      <button key={r.id} onClick={() => setSelected(r)}
        className="card p-4 text-left hover:shadow-md transition-all w-full">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="text-sm font-semibold text-gray-800 truncate">{r.patientName}</p>
          <span className={`badge text-xs flex-shrink-0 ${cfg.badge}`}>{cfg.label}</span>
        </div>
        <p className="text-xs text-gray-400 mb-2">{r.requestId} · {r.assistanceType}</p>
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">Needs <span className="font-semibold text-gray-700">{peso(r.amountNeeded)}</span></span>
          <span className="text-gray-400">Secured <span className="font-semibold text-green-600">{peso(r.amountCommitted ?? 0)}</span></span>
        </div>
      </button>
    )
  }

  const section = (label, items, empty) => (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
        {label} {items.length > 0 && <span className="text-gray-300 font-normal">({items.length})</span>}
      </p>
      {items.length === 0
        ? <p className="text-sm text-gray-400 italic mb-2">{empty}</p>
        : <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">{items.map(card)}</div>}
    </div>
  )

  return (
    <Layout breadcrumb="Assistance Requests">
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">
        <div className="mb-5">
          <h1 className="page-title flex items-center gap-2"><MdReceiptLong className="text-brand-500" size={22} /> Assistance Requests</h1>
          <p className="page-sub">Review patient requests, verify the bill, and endorse them to agencies toward zero balance.</p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[1,2,3,4].map(i => <div key={i} className="card p-4 h-24 animate-pulse" />)}
          </div>
        ) : requests.length === 0 ? (
          <div className="card p-10 text-center">
            <MdLocalHospital size={32} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-600 mb-1">No assistance requests yet</p>
            <p className="text-xs text-gray-400">Patient requests will appear here for endorsement.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {section('Needs Endorsement', needsAction, 'Nothing waiting for endorsement.')}
            {section('In Progress', inProgress, 'No requests currently being funded.')}
            {section('Completed', done, 'No completed requests yet.')}
          </div>
        )}
      </div>

      {selectedLive && (
        <RequestDetail request={selectedLive} agencies={agencies} onClose={() => setSelected(null)} />
      )}
    </Layout>
  )
}
