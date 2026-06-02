import Layout from '../../components/Layout'
import { useState, useEffect } from 'react'
import { MdEdit, MdAdd, MdRemove, MdInfo, MdCalendarToday, MdHistory, MdAttachMoney } from 'react-icons/md'
import { useAuth } from '../../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, onSnapshot, doc, updateDoc, arrayUnion, serverTimestamp, runTransaction } from 'firebase/firestore'
import { db } from '../../firebase'
import { logAudit } from '../../utils/auditLog'
import toast from 'react-hot-toast'

const MAX_CAPACITY     = 100
const HISTORY_KEEP     = 10  // keep last N adjustments on the agency doc

const fmtISOTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function SlotManagement() {
  const { user }            = useAuth()
  const navigate            = useNavigate()
  const [agency, setAgency] = useState(null)
  const [loading, setLoading] = useState(true)
  const [adjust, setAdjust]   = useState(1)
  const [reason, setReason]   = useState('')
  const [editing, setEditing] = useState(false)
  const [newTotal, setNewTotal] = useState(0)
  const [saving, setSaving]   = useState(false)

  // Today's pending+reviewing apps — counts as backlog awareness
  const [backlog, setBacklog] = useState(0)

  useEffect(() => {
    if (!user?.agencyId) return
    const unsub = onSnapshot(doc(db, 'agencies', user.agencyId), snap => {
      if (snap.exists()) {
        const data = snap.data()
        setAgency({ id: snap.id, ...data })
        setNewTotal(data.slots?.total ?? 0)
      }
      setLoading(false)
    }, (err) => {
      setLoading(false)
      console.error('[SlotManagement] agency snapshot error:', err)
    })
    return unsub
  }, [user?.agencyId])

  useEffect(() => {
    if (!user?.agencyId) return
    const q = query(
      collection(db, 'applications'),
      where('agencyId', '==', user.agencyId),
      where('status', 'in', ['pending', 'reviewing'])
    )
    const unsub = onSnapshot(q, snap => setBacklog(snap.size), () => setBacklog(0))
    return unsub
  }, [user?.agencyId])

  if (loading || !agency) return (
    <Layout breadcrumb="Slot Management">
      <div className="p-4 sm:p-6 max-w-xl space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="card p-5 animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-48 mb-3" />
            <div className="h-3 bg-gray-100 rounded w-32" />
          </div>
        ))}
      </div>
    </Layout>
  )

  const slots  = agency.slots ?? { total: 0, remaining: 0 }
  const used   = slots.total - slots.remaining
  const pct    = slots.total > 0 ? Math.round((used / slots.total) * 100) : 0
  const status = slots.remaining === 0 ? 'FULL'
               : pct >= 75 ? 'HIGH'
               : pct >= 50 ? 'MEDIUM' : 'LOW'

  const statusColor = {
    FULL:   'text-red-500',
    HIGH:   'text-red-400',
    MEDIUM: 'text-amber-500',
    LOW:    'text-green-500',
  }
  const barColor = {
    FULL:   'bg-red-400',
    HIGH:   'bg-red-300',
    MEDIUM: 'bg-amber-400',
    LOW:    'bg-brand-500',
  }

  const today = new Date().toLocaleDateString([], {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  const todayISO = new Date().toISOString().slice(0, 10)
  const resetPending = agency.lastResetDate !== todayISO && (slots.total ?? 0) > 0

  const adjustments = Array.isArray(agency.slotAdjustments) ? agency.slotAdjustments : []
  const recentAdjustments = [...adjustments].reverse().slice(0, HISTORY_KEEP)

  const budget    = agency.budget ?? { period: 'monthly', allocated: 0, committed: 0, disbursed: 0 }
  const budgetRemaining = Math.max(0, (budget.allocated ?? 0) - (budget.committed ?? 0))

  const recordAdjustment = async (entry) => {
    // Keep history capped — fetch current array, append, trim to last HISTORY_KEEP * 2 to leave headroom
    const next = [...adjustments, { ...entry, at: new Date().toISOString(), by: user.name }]
      .slice(-HISTORY_KEEP * 2)
    await updateDoc(doc(db, 'agencies', agency.id), { slotAdjustments: next })
    logAudit(user, {
      action: 'slots_adjusted',
      targetType: 'agency',
      targetId:   agency.id,
      targetName: agency.name,
      details:    `${entry.type === 'add' ? '+' : entry.type === 'deduct' ? '-' : '↻ capacity to '}${entry.delta}${entry.reason ? ` · ${entry.reason}` : ''}`,
    })
  }

  // R5 fix: all three slot mutations now run inside runTransaction so a
  // concurrent endorsement decrement (admin/Requests EndorseModal does
  // `slots.remaining -= 1` inside its own tx) can't be silently overwritten
  // by an operator clicking +5 or -3 in this page. Lost-update race
  // previously possible because the handlers read slots.remaining from
  // React state and wrote that value back -- they have no idea another
  // tx just landed.
  //
  // 2026-06-03 end-to-end review (R5).

  const handleAdd = async () => {
    if (slots.remaining + adjust > slots.total) {
      toast.error(`Cannot exceed total capacity (${slots.total}).`)
      return
    }
    try {
      const ref = doc(db, 'agencies', agency.id)
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists()) throw new Error('GONE')
        const cur   = snap.data()?.slots?.remaining ?? 0
        const total = snap.data()?.slots?.total    ?? 0
        const next  = Math.min(cur + adjust, total)
        tx.update(ref, { 'slots.remaining': next })
      })
      await recordAdjustment({ type: 'add', delta: adjust, reason: reason.trim() || null })
      setReason('')
      toast.success(`${adjust} slot${adjust !== 1 ? 's' : ''} added.`)
    } catch { toast.error('Failed to update slots.') }
  }

  const handleDeduct = async () => {
    if (slots.remaining - adjust < 0) {
      toast.error('Cannot deduct below 0.')
      return
    }
    try {
      const ref = doc(db, 'agencies', agency.id)
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists()) throw new Error('GONE')
        const cur  = snap.data()?.slots?.remaining ?? 0
        const next = Math.max(0, cur - adjust)
        tx.update(ref, { 'slots.remaining': next })
      })
      await recordAdjustment({ type: 'deduct', delta: adjust, reason: reason.trim() || null })
      setReason('')
      toast.success(`${adjust} slot${adjust !== 1 ? 's' : ''} deducted.`)
    } catch { toast.error('Failed to update slots.') }
  }

  const handleSaveTotal = async () => {
    if (newTotal < 1)            { toast.error('Total capacity must be at least 1.'); return }
    if (newTotal > MAX_CAPACITY) { toast.error(`Total capacity cannot exceed ${MAX_CAPACITY}.`); return }
    if (newTotal < used)         { toast.error(`Cannot set total below already-used slots (${used}).`); return }
    setSaving(true)
    try {
      const ref = doc(db, 'agencies', agency.id)
      let oldTotal = slots.total ?? 0
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists()) throw new Error('GONE')
        const cur   = snap.data()?.slots ?? {}
        oldTotal    = cur.total ?? oldTotal
        const usedNow = (cur.total ?? 0) - (cur.remaining ?? 0)
        // Re-check the post-transactional consumption budget. Between
        // the UI guard above and now another tx could have consumed
        // a slot, pushing usedNow past newTotal. In that case we
        // refuse the change rather than silently set remaining<0.
        if (newTotal < usedNow) throw new Error('USED_EXCEEDS_NEW_TOTAL')
        tx.update(ref, {
          'slots.total':     newTotal,
          'slots.remaining': Math.max(0, newTotal - usedNow),
        })
      })
      await recordAdjustment({ type: 'capacity', delta: newTotal, oldDelta: oldTotal, reason: 'Capacity edit' })
      setEditing(false)
      toast.success('Daily capacity updated.')
    } catch (err) {
      if (String(err.message) === 'USED_EXCEEDS_NEW_TOTAL') {
        toast.error('Another change just landed -- used slots now exceed the new capacity. Re-check the page and try again.')
      } else {
        toast.error('Failed to update capacity.')
      }
    }
    finally { setSaving(false) }
  }

  return (
    <Layout breadcrumb="Slot Management">
      <div className="p-4 sm:p-6">

        <div className="mb-5">
          <h1 className="page-title">Slot Management</h1>
          <p className="page-sub">Manage daily patient slots for {agency.name}.</p>
        </div>

        <div className="max-w-xl space-y-4">

          {/* Default capacity */}
          <div className="card p-5 border-l-4 border-brand-500">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center text-xl">🎫</div>
                <div>
                  <p className="text-sm font-medium text-gray-800">Default Slot Capacity</p>
                  <p className="text-xs text-gray-400">Max 100 per day</p>
                </div>
              </div>
              {editing ? (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <input
                    type="number" min={1} max={MAX_CAPACITY}
                    className="input w-20 text-center"
                    value={newTotal}
                    onChange={e => setNewTotal(Number(e.target.value))}
                  />
                  <button className="btn-primary text-xs" onClick={handleSaveTotal} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button className="btn-secondary text-xs"
                    onClick={() => { setEditing(false); setNewTotal(slots.total) }}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-2xl font-bold text-brand-600">{slots.total}</span>
                  <span className="text-xs text-gray-400">slots/day</span>
                  <button className="btn-secondary text-xs flex items-center gap-1"
                    onClick={() => setEditing(true)}>
                    <MdEdit size={13} /> Edit
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Today's usage */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <MdCalendarToday size={14} className="text-gray-400" />
              <span className="text-sm font-medium text-gray-700">Today's Slots</span>
              <span className="text-xs text-gray-400">· {today}</span>
              {resetPending && (
                <span className="text-xs bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.5 rounded-full">
                  Pending reset
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-4xl font-bold text-gray-900">{slots.remaining}</span>
              <span className="text-base text-gray-400">/ {slots.total} remaining</span>
              <span className={`ml-auto text-sm font-bold ${statusColor[status]}`}>{status}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span>Usage</span>
              <span>{used} used · {slots.remaining} remaining</span>
            </div>
            <div className="w-full h-3 bg-gray-100 rounded-full">
              <div
                className={`h-3 rounded-full transition-all ${barColor[status]}`}
                style={{ width: `${pct}%` }}
              />
            </div>

            {/* Backlog awareness */}
            {backlog > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-50 flex items-center gap-2 text-xs text-gray-500">
                <MdInfo size={13} className="text-amber-500 flex-shrink-0" />
                <span>
                  <strong>{backlog}</strong> unprocessed application{backlog === 1 ? '' : 's'} in the Inbox
                  {' '}
                  {slots.remaining < backlog
                    ? <span className="text-red-500 font-medium">(exceeds remaining slots)</span>
                    : <span className="text-gray-400">— enough remaining slots</span>}
                </span>
              </div>
            )}

            {/* Reset clarity */}
            <p className="text-xs text-gray-400 mt-3 leading-relaxed">
              Slots reset to the default capacity at the start of each new day — the reset is applied automatically when the first coordinator opens the workspace. {resetPending && <span className="text-amber-600 font-medium">Today's reset hasn't run yet; refresh the Dashboard to trigger it.</span>}
            </p>
          </div>

          {/* Budget link */}
          {(budget.allocated ?? 0) > 0 ? (
            <div className="card p-4 flex items-center gap-3">
              <div className="w-9 h-9 bg-green-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <MdAttachMoney size={18} className="text-green-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-400">Remaining {budget.period} budget</p>
                <p className="text-sm font-semibold text-gray-800">
                  ₱{budgetRemaining.toLocaleString()} <span className="text-xs font-normal text-gray-400">of ₱{(budget.allocated ?? 0).toLocaleString()}</span>
                </p>
              </div>
              <button className="text-xs text-brand-500 hover:text-brand-600 font-medium flex-shrink-0"
                onClick={() => navigate('/agency/dashboard')}>
                View on Dashboard →
              </button>
            </div>
          ) : (
            <div className="card p-3 bg-amber-50/50 border-amber-100 text-xs text-amber-700">
              No budget allocated yet — slots control daily volume, but approval amounts won't be tracked against a budget. Ask the system admin to set an allocation on the Agency Detail page.
            </div>
          )}

          {/* Manual adjustment */}
          <div className="card p-5">
            <p className="text-sm font-medium text-gray-800 mb-1">Manual Adjustment</p>
            <p className="text-xs text-gray-400 mb-4">
              Add or deduct slots for today only — does not change the default capacity. Each change is audited.
            </p>
            <div className="flex items-center gap-3 flex-wrap mb-3">
              {/* Counter */}
              <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                <button
                  className="w-9 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
                  onClick={() => setAdjust(a => Math.max(1, a - 1))}>
                  <MdRemove size={18} />
                </button>
                <span className="w-10 text-center text-sm font-medium">{adjust}</span>
                <button
                  className="w-9 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
                  onClick={() => setAdjust(a => Math.min(MAX_CAPACITY, a + 1))}>
                  <MdAdd size={18} />
                </button>
              </div>
              <button className="btn-primary flex items-center gap-1.5 text-sm" onClick={handleAdd}>
                <MdAdd size={16} /> Add Slots
              </button>
              <button className="btn-danger flex items-center gap-1.5 text-sm" onClick={handleDeduct}>
                <MdRemove size={16} /> Deduct Slots
              </button>
            </div>
            <input
              className="input text-sm"
              placeholder="Reason (optional) — e.g. Walk-in patient, correction…"
              maxLength={120}
              value={reason}
              onChange={e => setReason(e.target.value)}
            />

            <div className="mt-4 bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-start gap-2">
              <MdInfo size={15} className="text-blue-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700">
                <strong>Auto-deduction:</strong> Slots are automatically deducted when patients submit
                applications. Use manual adjustment for walk-ins, corrections, or special cases.
              </p>
            </div>
          </div>

          {/* Adjustment history */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <MdHistory size={14} className="text-gray-400" />
              <p className="text-sm font-medium text-gray-800">Recent Adjustments</p>
            </div>
            {recentAdjustments.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No manual adjustments yet.</p>
            ) : (
              <div className="space-y-1.5">
                {recentAdjustments.map((a, i) => {
                  const isCap = a.type === 'capacity'
                  const sign  = a.type === 'add' ? '+' : a.type === 'deduct' ? '−' : '↻'
                  const color = a.type === 'add' ? 'text-green-600' : a.type === 'deduct' ? 'text-red-500' : 'text-blue-600'
                  return (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className={`font-bold w-6 text-center ${color}`}>{sign}{a.delta}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-700">
                          {isCap
                            ? <>Capacity changed to <strong>{a.delta}</strong></>
                            : <>{a.type === 'add' ? 'Added' : 'Deducted'} <strong>{a.delta}</strong> slot{a.delta === 1 ? '' : 's'}</>}
                          {a.reason && <span className="text-gray-400"> · {a.reason}</span>}
                        </p>
                        <p className="text-gray-400">
                          {a.by} · {fmtISOTime(a.at)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </Layout>
  )
}
