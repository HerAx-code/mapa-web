import Layout from '../../components/Layout'
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
  const [newAlloc, setNewAlloc]         = useState(0)
  const [newPeriod, setNewPeriod]       = useState('monthly')
  const [newFundSource, setNewFundSource]       = useState('')
  const [newFundSourceNotes, setNewFundSourceNotes] = useState('')
  const [saving, setSaving]             = useState(false)
  const [resetting, setResetting]       = useState(false)
  const [openRequests, setOpenRequests] = useState([])
  const [history, setHistory]           = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyKey, setHistoryKey]     = useState(0)  // bump to refetch after save/reset

  const isAgencyAdmin = user?.role === 'agency_admin'

  // Live agency budget
  useEffect(() => {
    if (!user?.agencyId) return
    const unsub = onSnapshot(doc(db, 'agencies', user.agencyId),
      snap => {
        if (snap.exists()) {
          const data = { id: snap.id, ...snap.data() }
          setAgency(data)
          setNewAlloc(data.budget?.allocated ?? 0)
          setNewPeriod(data.budget?.period ?? 'monthly')
          setNewFundSource(data.budget?.fundSource ?? '')
          setNewFundSourceNotes(data.budget?.fundSourceNotes ?? '')
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
  // Re-fetches when historyKey is bumped (after a save or period reset).
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
  }, [user?.agencyId, isAgencyAdmin, historyKey])

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
        <div className="p-4 sm:p-6 max-w-2xl space-y-4">
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
    if (next > 0 && !newFundSource.trim()) {
      toast.error('Please name the fund source (e.g., PCSO Resolution #2026-15) for accountability.')
      return
    }
    setSaving(true)
    try {
      const fundSource      = newFundSource.trim()
      const fundSourceNotes = newFundSourceNotes.trim()
      await updateDoc(doc(db, 'agencies', agency.id), {
        budget: {
          period:                newPeriod,
          allocated:             next,
          committed:             committed,
          disbursed:             disbursed,
          periodStart:           budget.periodStart ?? serverTimestamp(),
          // Fund source recorded for COA-style audit defense.
          fundSource:            fundSource || null,
          fundSourceNotes:       fundSourceNotes || null,
          // Fresh allocation reopens the low-balance notification window
          lowBalanceNotifiedAt:  null,
        },
      })
      logAudit(user, {
        action:     'budget_allocated',
        targetType: 'agency',
        targetId:   agency.id,
        targetName: agency.name,
        details:    `Allocation set to ₱${next.toLocaleString()} (${newPeriod})` +
                    (fundSource ? ` · source: ${fundSource}` : '') +
                    ' by agency admin',
      })
      setEditing(false)
      toast.success('Allocation updated.')
      // Give the new audit entry a moment to land before re-fetching history.
      setTimeout(() => setHistoryKey(k => k + 1), 600)
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
    const periodNoun = PERIOD_NOUN[budget.period] ?? 'period'
    if (!window.confirm(
      `Start a new ${periodNoun}?\n\n` +
      `This resets disbursed (₱${disbursed.toLocaleString()}) back to ₱0 and starts a fresh ${periodNoun} clock. ` +
      `The allocation (₱${allocated.toLocaleString()}) stays the same.\n\n` +
      `Use this at the start of each budget ${periodNoun}.`
    )) return
    setResetting(true)
    try {
      await updateDoc(doc(db, 'agencies', agency.id), {
        'budget.committed':            0,
        'budget.disbursed':            0,
        'budget.periodStart':          serverTimestamp(),
        'budget.lowBalanceNotifiedAt': null,
      })
      logAudit(user, {
        action:     'budget_period_reset',
        targetType: 'agency',
        targetId:   agency.id,
        targetName: agency.name,
        details:    `New ${budget.period} period started by agency admin`,
      })
      toast.success('New budget period started.')
      setTimeout(() => setHistoryKey(k => k + 1), 600)
    } catch (err) {
      console.error('[Allocation] reset error:', err)
      toast.error('Failed to reset budget period.')
    } finally {
      setResetting(false)
    }
  }

  // Stale-period detection
  const periodStart = budget.periodStart?.toDate
    ? budget.periodStart.toDate()
    : (budget.periodStart ? new Date(budget.periodStart) : null)
  const periodDays = periodStart
    ? Math.floor((Date.now() - periodStart.getTime()) / 86400000)
    : null
  const isStale = budget.period === 'monthly' && periodDays != null && periodDays > 31

  return (
    <Layout breadcrumb="Budget Allocation">
      <div className="p-4 sm:p-6 max-w-3xl">

        <div className="mb-5">
          <h1 className="page-title">Budget Allocation</h1>
          <p className="page-sub">
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
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Amount (₱)</label>
                <input type="number" min={0} className="input"
                  placeholder="e.g. 500000"
                  value={newAlloc} onChange={e => setNewAlloc(Number(e.target.value))} />
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
                    setNewAlloc(allocated)
                    setNewPeriod(budget.period ?? 'monthly')
                    setNewFundSource(budget.fundSource ?? '')
                    setNewFundSourceNotes(budget.fundSourceNotes ?? '')
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

        <p className="text-xs text-gray-400 mt-2 leading-relaxed">
          <strong>Accountability —</strong> Changes here are recorded in your agency's audit log. As Agency Administrator, you are accountable to your funding source (PCSO / DOH / DSWD / etc.) for how the allocation is set and spent. CRMC operates the platform but does not control your agency's budget.
        </p>

      </div>
    </Layout>
  )
}
