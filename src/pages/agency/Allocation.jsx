import Layout from '../../components/Layout'
import ConfirmModal from '../../components/ConfirmModal'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  doc, onSnapshot, updateDoc, serverTimestamp, collection, query, where,
  orderBy, limit, getDocs,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { logAudit } from '../../utils/auditLog'
import { MdAttachMoney, MdRefresh, MdSave, MdEdit, MdWarning, MdLockOutline, MdHistory } from 'react-icons/md'
import { PERIOD_NOUN, PERIOD_ADJECTIVE } from '../../utils/constants'
import toast from 'react-hot-toast'

export default function AgencyAllocation() {
  const { user }   = useAuth()
  const navigate   = useNavigate()
  const [agency, setAgency]       = useState(null)
  const [loading, setLoading]     = useState(true)
  const [editing, setEditing]           = useState(false)
  // R15: held as string so the input can be cleanly empty (placeholder
  // visible) instead of pre-filled with "0". Save handlers coerce via
  // Number() at the boundary.
  const [newAlloc, setNewAlloc]         = useState('')
  const [newPeriod, setNewPeriod]       = useState('monthly')
  const [newFundSource, setNewFundSource]       = useState('')
  const [newFundSourceNotes, setNewFundSourceNotes] = useState('')
  // Per-applicant cap: '' = no cap (null in DB), a positive number = the
  // policy ceiling per case (PCSO ₱25K, DSWD tier limits, etc.). Enforced
  // hard in ApproveModal and shown as a soft warning in EndorseModal.
  const [newMaxPerApplicant, setNewMaxPerApplicant] = useState('')
  const [saving, setSaving]             = useState(false)
  const [resetting, setResetting]       = useState(false)
  const [openRequests, setOpenRequests] = useState([])
  const [history, setHistory]           = useState([])
  const [showConfirmReset, setShowConfirmReset] = useState(false)
  // For the "you're changing the budget period" prompt during Save.
  const [showPeriodChangeSave, setShowPeriodChangeSave] = useState(false)
  const [restartPeriodClock, setRestartPeriodClock]     = useState(true)
  const [historyLoading, setHistoryLoading] = useState(true)

  const isAgencyAdmin = user?.role === 'agency_admin'

  // Live agency budget
  useEffect(() => {
    if (!user?.agencyId) return
    const unsub = onSnapshot(doc(db, 'agencies', user.agencyId),
      snap => {
        if (snap.exists()) {
          const data = { id: snap.id, ...snap.data() }
          setAgency(data)
          // R15: keep input string-typed; show empty when allocation isn't
          // set yet so the placeholder ("e.g. 500000") is visible.
          setNewAlloc(data.budget?.allocated > 0 ? String(data.budget.allocated) : '')
          setNewPeriod(data.budget?.period ?? 'monthly')
          setNewFundSource(data.budget?.fundSource ?? '')
          setNewFundSourceNotes(data.budget?.fundSourceNotes ?? '')
          setNewMaxPerApplicant(
            data.maxPerApplicant != null && data.maxPerApplicant > 0
              ? String(data.maxPerApplicant)
              : ''
          )
        }
        setLoading(false)
      },
      (err) => {
        setLoading(false)
        console.error('[Allocation] agency snapshot error:', err)
      },
    )
    return unsub
  }, [user?.agencyId])

  // Allocation history — last 10 budget changes for this agency.
  // Uses the auditLog(actorAgencyId, createdAt DESC) composite index.
  // After save/reset, the local list is optimistically updated (see
  // handleSaveAllocation / handleResetPeriod) so the UI reflects the
  // change without a refetch race.
  useEffect(() => {
    if (!user?.agencyId || !isAgencyAdmin) return
    setHistoryLoading(true)
    getDocs(query(
      collection(db, 'auditLog'),
      where('actorAgencyId', '==', user.agencyId),
      orderBy('createdAt', 'desc'),
      limit(30),
    ))
      .then(snap => {
        const items = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(e => e.action === 'budget_allocated' || e.action === 'budget_period_reset')
          .slice(0, 10)
        setHistory(items)
      })
      .catch(err => {
        console.error('[Allocation] history load error:', err)
        setHistory([])
      })
      .finally(() => setHistoryLoading(false))
  }, [user?.agencyId, isAgencyAdmin])

  // Open top-up requests from this agency
  useEffect(() => {
    if (!user?.agencyId) return
    const q = query(
      collection(db, 'reports'),
      where('agencyId', '==', user.agencyId),
      where('category', '==', 'Budget Request'),
    )
    const unsub = onSnapshot(q,
      snap => {
        const items = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(r => r.status === 'open' || r.status === 'in_progress')
          .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
        setOpenRequests(items)
      },
      (err) => console.error('[Allocation] requests snapshot error:', err),
    )
    return unsub
  }, [user?.agencyId])

  if (!isAgencyAdmin) {
    return (
      <Layout breadcrumb="Budget Allocation">
        <div className="p-4 sm:p-6 max-w-2xl">
          <div className="card p-6 bg-amber-50 border-amber-200 flex items-start gap-3">
            <MdLockOutline size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800 mb-1">Restricted to Agency Administrators</p>
              <p className="text-xs text-amber-700">
                Budget allocation is set by your agency's senior officer. Coordinators can view current balances on the Dashboard and Funds page, but only an agency administrator can change the allocation or reset the period.
              </p>
              <button onClick={() => navigate('/agency/dashboard')}
                className="mt-3 text-xs font-medium text-amber-700 hover:text-amber-800 underline">
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      </Layout>
    )
  }

  if (loading || !agency) {
    return (
      <Layout breadcrumb="Budget Allocation">
        <div className="p-4 sm:p-6 max-w-[1400px] mx-auto space-y-4">
          {[1,2,3].map(i => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-48 mb-3" />
              <div className="h-3 bg-gray-100 rounded w-64" />
            </div>
          ))}
        </div>
      </Layout>
    )
  }

  const budget    = agency.budget ?? { period: 'monthly', allocated: 0, committed: 0, disbursed: 0 }
  const allocated = budget.allocated ?? 0
  const committed = budget.committed ?? 0
  const disbursed = budget.disbursed ?? 0
  const remaining = Math.max(0, allocated - committed)
  const utilization = allocated > 0 ? Math.round((committed / allocated) * 100) : 0
  const bar = utilization >= 90 ? 'bg-red-400' : utilization >= 70 ? 'bg-amber-400' : 'bg-green-400'

  const handleSaveAllocation = async () => {
    const next = Number(newAlloc)
    if (!Number.isFinite(next) || next < 0) {
      toast.error('Allocation must be 0 or a positive number.')
      return
    }
    // Block lowering allocation below the already-committed amount.
    // Otherwise the agency would silently owe more in GLs than its
    // declared budget — the UI clamps `remaining` at 0 so the violation
    // would be invisible until COA reconciliation. Coordinators can
    // still reverse approvals to release committed funds first.
    if (next > 0 && next < committed) {
      toast.error(
        `New allocation (₱${next.toLocaleString()}) is below the currently committed ` +
        `₱${committed.toLocaleString()}. Wait for outstanding Guarantee Letters to be ` +
        `redeemed or expired, or reverse approvals to release committed funds first.`,
        { duration: 8000 }
      )
      return
    }
    if (next > 0 && !newFundSource.trim()) {
      toast.error('Please name the fund source (e.g., PCSO Resolution #2026-15) for accountability.')
      return
    }
    // If the admin is switching periods (monthly ↔ quarterly ↔ yearly),
    // ask whether to reset periodStart via an in-app modal. Otherwise the
    // new monthly rule applies to a 14-month-old periodStart and would
    // immediately fire "stale period". Default to resetting — usually the
    // right call when changing periods unless the admin specifically wants
    // to inherit the old start date.
    const periodChanged = newPeriod !== (budget.period ?? 'monthly')
    if (periodChanged) {
      setRestartPeriodClock(true)
      setShowPeriodChangeSave(true)
      return
    }
    await performSaveAllocation(false)
  }

  // The actual save mutation. Split out so the period-change confirm
  // modal can call it with the chosen restartClock setting.
  const performSaveAllocation = async (shouldResetPeriodStart) => {
    const next = Number(newAlloc) || 0
    setSaving(true)
    try {
      const fundSource      = newFundSource.trim()
      const fundSourceNotes = newFundSourceNotes.trim()
      // Per-applicant cap: blank input or 0 = no cap (stored as null so the
      // ApproveModal's `(perCap > 0)` gate skips the check cleanly).
      // Defense-in-depth: re-validate at save time even though the input
      // handler clamps -- a paste or programmatic value could bypass it.
      const capRaw = Number(newMaxPerApplicant)
      const capNum = Number.isFinite(capRaw) && capRaw > 0 ? Math.floor(capRaw) : 0
      const maxPerApplicant = capNum > 0 ? capNum : null
      // Dotted-field update so budget.committed and budget.disbursed are
      // untouched. Those fields are owned exclusively by the approve /
      // redeem / reverse paths (which use increment()). Writing the whole
      // budget object here would race with a concurrent coordinator
      // approval and silently overwrite the increment, losing committed
      // dollars. Previous code did exactly that.
      await updateDoc(doc(db, 'agencies', agency.id), {
        'budget.period':               newPeriod,
        'budget.allocated':            next,
        // Reset periodStart on confirmed period change; otherwise inherit.
        'budget.periodStart':          shouldResetPeriodStart ? serverTimestamp() : (budget.periodStart ?? serverTimestamp()),
        // Fund source recorded for COA-style audit defense.
        'budget.fundSource':           fundSource || null,
        'budget.fundSourceNotes':      fundSourceNotes || null,
        // Fresh allocation reopens the low-balance notification window
        'budget.lowBalanceNotifiedAt': null,
        maxPerApplicant,
      })
      const auditDetails = `Allocation set to ₱${next.toLocaleString()} (${newPeriod})` +
                           (maxPerApplicant ? ` · max ₱${maxPerApplicant.toLocaleString()}/applicant` : '') +
                           (fundSource ? ` · source: ${fundSource}` : '') +
                           ' by agency admin'
      logAudit(user, {
        action:     'budget_allocated',
        targetType: 'agency',
        targetId:   agency.id,
        targetName: agency.name,
        details:    auditDetails,
      })
      setEditing(false)
      toast.success('Allocation updated.')
      // Optimistically prepend the entry so the UI updates immediately;
      // the next history refetch (manual reload / nav) will reconcile.
      // Removes the prior setTimeout race against audit-log write durability.
      setHistory(prev => [{
        id:        `optimistic-${Date.now()}`,
        action:    'budget_allocated',
        details:   auditDetails,
        actorName: user?.name,
        createdAt: { toDate: () => new Date() },
      }, ...prev].slice(0, 10))
    } catch (err) {
      console.error('[Allocation] save error:', err)
      toast.error('Failed to update allocation.')
    } finally {
      setSaving(false)
    }
  }

  const handleResetPeriod = async () => {
    // Safety: if there are still-issued GLs holding committed budget, a
    // naive period reset zeros committed without resolving those GLs.
    // Their later redemption/expiration/reversal would then write
    // increment(-amount) against a zero base, pushing committed negative
    // and silently corrupting the accounting identity. Block the reset
    // until the agency resolves outstanding GLs.
    if (committed > 0) {
      toast.error(
        `Cannot reset — ₱${committed.toLocaleString()} is still committed to issued Guarantee Letters. ` +
        `Wait for those GLs to be redeemed by providers or marked expired, then reset.`,
        { duration: 8000 }
      )
      return
    }
    // Open the in-app confirm modal; performResetPeriod (below) runs the
    // actual mutation when the admin confirms.
    setShowConfirmReset(true)
  }

  const performResetPeriod = async () => {
    setResetting(true)
    try {
      await updateDoc(doc(db, 'agencies', agency.id), {
        'budget.committed':            0,
        'budget.disbursed':            0,
        'budget.periodStart':          serverTimestamp(),
        'budget.lowBalanceNotifiedAt': null,
      })
      const resetDetails = `New ${budget.period} period started by agency admin`
      logAudit(user, {
        action:     'budget_period_reset',
        targetType: 'agency',
        targetId:   agency.id,
        targetName: agency.name,
        details:    resetDetails,
      })
      toast.success('New budget period started.')
      setHistory(prev => [{
        id:        `optimistic-${Date.now()}`,
        action:    'budget_period_reset',
        details:   resetDetails,
        actorName: user?.name,
        createdAt: { toDate: () => new Date() },
      }, ...prev].slice(0, 10))
      setShowConfirmReset(false)
    } catch (err) {
      console.error('[Allocation] reset error:', err)
      toast.error('Failed to reset budget period.')
    } finally {
      setResetting(false)
    }
  }

  // Stale-period detection — fires for any period, not just monthly.
  // The thresholds are one period + a small grace (admin probably forgot
  // to reset on the first day of the new month/quarter/year).
  const PERIOD_STALE_AFTER = { monthly: 31, quarterly: 95, yearly: 366 }
  const periodStart = budget.periodStart?.toDate
    ? budget.periodStart.toDate()
    : (budget.periodStart ? new Date(budget.periodStart) : null)
  const periodDays = periodStart
    ? Math.floor((Date.now() - periodStart.getTime()) / 86400000)
    : null
  const isStale = periodDays != null && periodDays > (PERIOD_STALE_AFTER[budget.period] ?? 31)

  return (
    <Layout breadcrumb="Budget Allocation">
      <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">

        <div className="mb-5">
          <p className="eyebrow">Budget</p>
          <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Budget Allocation</h1>
          <p className="text-sm text-gray-500 mt-1">
            Set and manage your agency's budget for {agency.name}. Only agency administrators can make changes here.
          </p>
        </div>

        {/* Stale period banner */}
        {isStale && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-start gap-2">
            <MdWarning size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">Budget period appears stale</p>
              <p className="text-xs text-amber-700 mt-0.5">
                This {PERIOD_NOUN[budget.period] ?? 'period'} started <strong>{periodDays} days ago</strong>. Reset to start a fresh {PERIOD_NOUN[budget.period] ?? 'period'}.
              </p>
            </div>
            <button
              className="text-xs font-medium text-amber-700 hover:text-amber-800 underline flex-shrink-0"
              onClick={handleResetPeriod}>
              Reset now
            </button>
          </div>
        )}

        {/* Split: budget controls on the left, allocation history on the right. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] gap-5 items-start">

          {/* Controls (cards space themselves via their own mb-5) */}
          <div className="min-w-0">

        {/* Current budget snapshot */}
        <div className="card p-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {PERIOD_ADJECTIVE[budget.period] ?? 'Current'} Budget
            </p>
            {periodStart && (
              <p className="text-xs text-gray-400">
                Period started {periodStart.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div>
              <p className="text-xs text-gray-400">Allocated</p>
              <p className="text-xl font-semibold text-gray-800">₱{allocated.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Committed</p>
              <p className="text-xl font-semibold text-amber-600">₱{committed.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Disbursed</p>
              <p className="text-xl font-semibold text-purple-600">₱{disbursed.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Remaining</p>
              <p className="text-xl font-semibold text-green-600">₱{remaining.toLocaleString()}</p>
            </div>
          </div>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-1">
            <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${Math.min(utilization, 100)}%` }} />
          </div>
          <p className="text-xs text-gray-400">{utilization}% utilized</p>
        </div>

        {/* Allocation editor */}
        <div className="card p-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-gray-800">Allocation</p>
              <p className="text-xs text-gray-400">
                The total budget for this {PERIOD_NOUN[budget.period] ?? 'period'}. Approved Guarantee Letters draw from this.
              </p>
            </div>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-xs font-medium text-brand-500 hover:text-brand-600 flex items-center gap-1">
                <MdEdit size={13} /> Edit
              </button>
            )}
          </div>
          {!editing ? (
            <div>
              <div className="flex items-center gap-3">
                <MdAttachMoney size={20} className="text-gray-400" />
                <p className="text-2xl font-semibold text-gray-800">₱{allocated.toLocaleString()}</p>
                <span className="text-xs text-gray-400">per {PERIOD_NOUN[budget.period] ?? 'period'}</span>
              </div>
              {budget.fundSource ? (
                <div className="mt-3 pt-3 border-t border-gray-50">
                  <p className="text-xs text-gray-400 mb-0.5">Fund source</p>
                  <p className="text-sm font-medium text-gray-700">{budget.fundSource}</p>
                  {budget.fundSourceNotes && (
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{budget.fundSourceNotes}</p>
                  )}
                </div>
              ) : allocated > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-50">
                  <p className="text-xs text-amber-600">
                    ⚠ No fund source recorded. Edit allocation to add one (required for COA accountability).
                  </p>
                </div>
              )}
              {/* Per-applicant cap — read-only summary line. Always shown so
                  agency admins see the current policy at a glance, even
                  when it's "no cap". */}
              <div className="mt-3 pt-3 border-t border-gray-50">
                <p className="text-xs text-gray-400 mb-0.5">Per-applicant cap</p>
                {agency.maxPerApplicant != null && agency.maxPerApplicant > 0 ? (
                  <p className="text-sm font-medium text-gray-700">
                    ₱{Number(agency.maxPerApplicant).toLocaleString()} maximum per case
                  </p>
                ) : (
                  <p className="text-sm text-gray-500 italic">No cap configured — approvals bound only by overall budget.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Amount (₱)</label>
                {/* Clamp at the input layer so a pasted negative or NaN
                    can never reach state (the save handler validates too,
                    but defense in depth — the UI never shows a -₱5 value). */}
                <input type="number" min={0} step={1} className="input"
                  placeholder="e.g. 500000"
                  value={newAlloc}
                  onChange={e => {
                    // R15: hold the raw string so an empty field stays
                    // empty (placeholder shows). Strip any leading zeros
                    // a paste might bring in. Reject negatives at the
                    // input layer; final coercion happens in the save
                    // handler.
                    const raw = e.target.value
                    if (raw === '') { setNewAlloc(''); return }
                    const cleaned = raw.replace(/^0+(?=\d)/, '')
                    const n = Number(cleaned)
                    if (!Number.isFinite(n) || n < 0) return
                    setNewAlloc(cleaned)
                  }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Period</label>
                <select className="input" value={newPeriod} onChange={e => setNewPeriod(e.target.value)}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Fund Source {Number(newAlloc) > 0 && <span className="text-red-400">*</span>}
                </label>
                <input className="input"
                  placeholder="e.g. PCSO Resolution #2026-15, DOH SAA Q1-2026"
                  value={newFundSource}
                  onChange={e => setNewFundSource(e.target.value)} />
                <p className="text-xs text-gray-400 mt-0.5">
                  The authorizing document or program that funded this allocation. Required when allocation &gt; 0.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Maximum per Applicant (₱) <span className="text-gray-400 font-normal">— optional</span>
                </label>
                <input type="number" min={0} step={1} className="input"
                  placeholder="e.g. 25000 (PCSO ceiling). Leave blank for no cap."
                  value={newMaxPerApplicant}
                  onChange={e => {
                    const v = e.target.value
                    // Allow blank; otherwise clamp to non-negative integers.
                    if (v === '') { setNewMaxPerApplicant(''); return }
                    const n = Number(v)
                    setNewMaxPerApplicant(Number.isFinite(n) && n >= 0 ? String(Math.floor(n)) : '')
                  }} />
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                  The most this agency may approve for a single case. PCSO uses ₱25,000; DSWD AICS varies by tier; Malasakit Center is based on case assessment. Leave blank if your agency has no per-case ceiling. CRMC sees a soft warning at endorsement; the agency's Approve modal hard-blocks any approval above this.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
                <textarea className="input resize-none" rows={2}
                  placeholder="Sub-program, restrictions, contact person, board resolution date, etc."
                  value={newFundSourceNotes}
                  onChange={e => setNewFundSourceNotes(e.target.value)} />
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={() => {
                    setEditing(false)
                    setNewAlloc(allocated > 0 ? String(allocated) : '')
                    setNewPeriod(budget.period ?? 'monthly')
                    setNewFundSource(budget.fundSource ?? '')
                    setNewFundSourceNotes(budget.fundSourceNotes ?? '')
                    setNewMaxPerApplicant(
                      agency.maxPerApplicant != null && agency.maxPerApplicant > 0
                        ? String(agency.maxPerApplicant)
                        : ''
                    )
                  }}
                  className="btn-secondary text-sm"
                  disabled={saving}>
                  Cancel
                </button>
                <button
                  onClick={handleSaveAllocation}
                  className="btn-primary text-sm flex items-center gap-1"
                  disabled={saving}>
                  <MdSave size={13} /> {saving ? 'Saving…' : 'Save Allocation'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Reset period */}
        {allocated > 0 && (
          <div className="card p-5 mb-5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">Start a New Period</p>
                <p className="text-xs text-gray-400">
                  Resets disbursed back to ₱0 and restarts the period clock. Allocation is preserved.
                </p>
                {committed > 0 && (
                  <p className="text-xs text-amber-600 mt-1">
                    ⚠ Currently ₱{committed.toLocaleString()} is still committed to issued GLs. Reset is unavailable until those GLs are redeemed or expired.
                  </p>
                )}
              </div>
              <button
                onClick={handleResetPeriod}
                disabled={resetting || committed > 0}
                title={committed > 0 ? 'Resolve outstanding GLs first' : ''}
                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed">
                <MdRefresh size={13} /> {resetting ? 'Resetting…' : 'Reset Period'}
              </button>
            </div>
          </div>
        )}

        {/* Open top-up requests from coordinators */}
        {openRequests.length > 0 && (
          <div className="card p-5 mb-5">
            <p className="text-sm font-semibold text-gray-800 mb-1">Open Top-Up Requests</p>
            <p className="text-xs text-gray-400 mb-3">
              Coordinators on your team have requested budget increases. Review and adjust allocation above.
            </p>
            <div className="space-y-2">
              {openRequests.map(r => (
                <div key={r.id} className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                  <div className="flex items-baseline justify-between mb-1">
                    <p className="text-sm font-semibold text-orange-800">
                      ₱{Number(r.amountRequested ?? 0).toLocaleString()} from <span className="font-normal">{r.reporterName}</span>
                    </p>
                    <p className="text-xs text-orange-600">{r.createdAt?.toDate?.()?.toLocaleDateString?.() ?? ''}</p>
                  </div>
                  <p className="text-xs text-orange-700">{r.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

          </div>{/* /controls column */}

          {/* Allocation history */}
          <aside className="lg:sticky lg:top-[68px]">
        {/* Allocation history — last 10 budget changes for this agency.
            Sources from auditLog filtered to this agency's actorAgencyId.
            For the full agency-wide audit slice, see /agency/audit. */}
        <div className="card p-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <MdHistory size={16} className="text-gray-400" />
              <p className="text-sm font-semibold text-gray-800">Allocation History</p>
            </div>
            <button
              onClick={() => navigate('/agency/audit')}
              className="text-xs text-brand-500 hover:text-brand-600 font-medium">
              Full audit log →
            </button>
          </div>
          {historyLoading ? (
            <p className="text-xs text-gray-400 py-3 text-center">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-gray-400 py-3 text-center">
              No allocation changes recorded yet. Set the allocation above to start the trail.
            </p>
          ) : (
            <div className="divide-y divide-gray-50">
              {history.map(e => {
                const isReset = e.action === 'budget_period_reset'
                const when = e.createdAt?.toDate
                  ? e.createdAt.toDate()
                  : (e.createdAt ? new Date(e.createdAt) : null)
                return (
                  <div key={e.id} className="py-2.5 flex items-start gap-3">
                    <span className={`badge text-xs flex-shrink-0 ${
                      isReset ? 'badge-gray' : 'badge-blue'
                    }`}>
                      {isReset ? 'Period reset' : 'Allocation set'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 leading-snug">{e.details ?? '—'}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        by <strong>{e.actorName ?? 'System'}</strong>
                        {when && <> · {when.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</>}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
          </aside>{/* /history column */}
        </div>{/* /split grid */}

        <p className="text-xs text-gray-400 mt-2 leading-relaxed">
          <strong>Accountability —</strong> Changes here are recorded in your agency's audit log. As Agency Administrator, you are accountable to your funding source (PCSO / DOH / DSWD / etc.) for how the allocation is set and spent. CRMC operates the platform but does not control your agency's budget.
        </p>

      </div>

      <ConfirmModal
        open={showConfirmReset}
        onClose={() => setShowConfirmReset(false)}
        onConfirm={performResetPeriod}
        title={`Start a new ${PERIOD_NOUN[budget.period] ?? 'period'}?`}
        body={`This resets disbursed (₱${(budget.disbursed ?? 0).toLocaleString()}) back to ₱0 and starts a fresh ${PERIOD_NOUN[budget.period] ?? 'period'} clock. The allocation (₱${(budget.allocated ?? 0).toLocaleString()}) stays the same.\n\nUse this at the start of each budget ${PERIOD_NOUN[budget.period] ?? 'period'}.`}
        tone="warning"
        confirmLabel={`Start new ${PERIOD_NOUN[budget.period] ?? 'period'}`}
        confirmLabelBusy="Starting…"
      />

      <ConfirmModal
        open={showPeriodChangeSave}
        onClose={() => setShowPeriodChangeSave(false)}
        onConfirm={async () => {
          setShowPeriodChangeSave(false)
          await performSaveAllocation(restartPeriodClock)
        }}
        title={`Changing budget period to ${newPeriod}`}
        body={
          <div className="space-y-3">
            <p className="text-sm text-gray-600 leading-relaxed">
              You're switching the budget period from <strong>{budget.period ?? 'monthly'}</strong> to <strong>{newPeriod}</strong>.
            </p>
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-1"
                checked={restartPeriodClock}
                onChange={e => setRestartPeriodClock(e.target.checked)}
              />
              <span>
                Restart the period clock now <span className="text-gray-400">(recommended — otherwise the new {newPeriod} rule applies to your old period start date and may immediately fire "stale period").</span>
              </span>
            </label>
          </div>
        }
        tone="info"
        confirmLabel="Save Allocation"
        confirmLabelBusy="Saving…"
      />
    </Layout>
  )
}
