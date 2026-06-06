import Layout from '../../components/Layout'
import AgencyAvatar from '../../components/AgencyAvatar'
import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  MdWarning, MdCalendarToday, MdArrowForward,
  MdInbox, MdVideoCall, MdCardMembership, MdBarChart,
  MdListAlt, MdMessage, MdDescription, MdMenuBook, MdTour,
} from 'react-icons/md'
import { useAuth } from '../../contexts/AuthContext'
import { PERIOD_NOUN, PERIOD_ADJECTIVE, GL_VALIDITY_DAYS } from '../../utils/constants'
import {
  collection, query, where, onSnapshot, doc, getDoc, getDocs,
  updateDoc, writeBatch, increment, serverTimestamp, addDoc,
  runTransaction,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { logAudit } from '../../utils/auditLog'
import { deriveRequestFinancials } from '../../utils/requests'
import { notify } from '../../utils/notifications'
import StatusBadge from '../../components/ui/StatusBadge'
import Tour from '../../components/Tour'
import { agencyDashboardTour, resetTourFlag } from '../../utils/tours'
import { tsToDate } from '../../utils/dates'
import toast from 'react-hot-toast'

// Threshold below which the agency gets a one-shot "budget running low"
// notification. Resets when the admin tops up allocated or resets the period.
const LOW_BALANCE_FRAC = 0.10
// Stale-period detection: monthly periods older than this trigger a banner.
const STALE_PERIOD_DAYS = 31

// GL_VALIDITY_DAYS imported from utils/constants (single source of truth).
// Application status badge + label rendering is delegated to <StatusBadge />
// which reads APP_STATUS_CONFIG from constants.js.

const formatDate = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
}

export default function AgencyDashboard() {
  const navigate      = useNavigate()
  const { user }      = useAuth()
  const [agency, setAgency]             = useState(null)
  const [applications, setApplications] = useState([])
  const [loading, setLoading]           = useState(true)
  const [showTopUp, setShowTopUp]       = useState(false)

  // Load agency data + auto-reset slots at start of each new day
  useEffect(() => {
    if (!user?.agencyId) return
    const unsub = onSnapshot(doc(db, 'agencies', user.agencyId), async snap => {
      if (!snap.exists()) return
      const data  = snap.data()
      // Anchor the "today" key to Asia/Manila so the reset fires at the
      // pilot-local midnight, not at UTC midnight (which is 08:00 PHT and
      // would delay the reset by 8 hours).
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
      if (data.lastResetDate !== today && (data.slots?.total ?? 0) > 0) {
        // New day — reset remaining slots back to total
        await updateDoc(doc(db, 'agencies', snap.id), {
          'slots.remaining': data.slots.total,
          lastResetDate:     today,
        })
        // onSnapshot will fire again with updated data — setAgency happens then
      } else {
        setAgency({ id: snap.id, ...data })
      }
    }, (err) => console.error('[Dashboard] agency snapshot error:', err))
    return unsub
  }, [user?.agencyId])

  // Load applications for this agency
  useEffect(() => {
    if (!user?.agencyId) return
    const q = query(
      collection(db, 'applications'),
      where('agencyId', '==', user.agencyId)
    )
    const unsub = onSnapshot(q, snap => {
      setApplications(snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.submittedAt?.seconds ?? 0) - (a.submittedAt?.seconds ?? 0))
      )
      setLoading(false)
    }, (err) => {
      setLoading(false)
      console.error('[Dashboard] applications snapshot error:', err)
      toast.error('Failed to load applications.')
    })
    return unsub
  }, [user?.agencyId])

  // Sweep expired GLs on Dashboard load. A GL is expired when:
  //   glStatus === 'issued' AND approvedAt is older than GL_VALIDITY_DAYS.
  // For each such application: flip glStatus → 'expired', release the
  // committed budget back to the agency. Atomically per application.
  // Audit-logged so super_admin can see automated sweeps.
  useEffect(() => {
    if (!user?.agencyId || !user?.uid) return
    let cancelled = false
    const run = async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'applications'),
          where('agencyId', '==', user.agencyId),
          where('glStatus', '==', 'issued')
        ))
        const now = Date.now()
        const expired = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(a => {
            const d = tsToDate(a.approvedAt)
            if (!d) return false
            const days = Math.floor((now - d.getTime()) / 86400000)
            return days > GL_VALIDITY_DAYS
          })
        if (cancelled || expired.length === 0) return

        // R3 fix: each expiry is now a runTransaction that re-syncs
        // the parent request's amountCommitted + status alongside the
        // slice flip + agency budget release. Mirrors performExpireGL
        // in ApplicationDetail.jsx -- same end-state docs regardless
        // of which path fired.
        for (const a of expired) {
          if (cancelled) break
          try {
            const amount = Number(a.approvedAmount) || 0
            await runTransaction(db, async (tx) => {
              const appRef = doc(db, 'applications', a.id)
              const appSnap = await tx.get(appRef)
              if (!appSnap.exists()) return
              // Skip if a coordinator already marked it expired between
              // the query and this transaction.
              if (appSnap.data().glStatus !== 'issued') return

              let reqRef = null, reqSnap = null, siblings = []
              if (a.requestId) {
                reqRef  = doc(db, 'requests', a.requestId)
                reqSnap = await tx.get(reqRef)
                const sibSnap = await getDocs(query(
                  collection(db, 'applications'),
                  where('requestId', '==', a.requestId),
                ))
                siblings = sibSnap.docs.map(d => {
                  const data = { id: d.id, ...d.data() }
                  if (d.id === a.id) return { ...data, glStatus: 'expired' }
                  return data
                })
              }

              tx.update(appRef, {
                glStatus:    'expired',
                glExpiredAt: serverTimestamp(),
                expiredBy:   'auto-sweep',
                updatedAt:   serverTimestamp(),
              })
              if (amount > 0) {
                tx.update(doc(db, 'agencies', user.agencyId), {
                  'budget.committed': increment(-amount),
                })
              }
              if (reqRef && reqSnap?.exists()) {
                const need = reqSnap.data().amountNeeded ?? 0
                const next = deriveRequestFinancials(siblings, need)
                tx.update(reqRef, {
                  amountCommitted: next.amountCommitted,
                  status:          next.status,
                  updatedAt:       serverTimestamp(),
                })
              }
            })
            logAudit(user, {
              action:     'gl_auto_expired',
              targetType: 'application',
              targetId:   a.id,
              targetName: a.patientName,
              details:    `Auto-expired by Dashboard sweep — ₱${amount.toLocaleString()} released to budget`,
            })
          } catch (err) {
            console.error(`Failed to auto-expire ${a.id}:`, err)
          }
        }
        if (!cancelled && expired.length > 0) {
          toast(`${expired.length} expired Guarantee Letter${expired.length === 1 ? '' : 's'} were swept and committed budget released.`, {
            icon: '🧹',
            duration: 5000,
          })
        }
      } catch (err) {
        console.error('GL expiry sweep failed:', err)
      }
    }
    run()
    return () => { cancelled = true }
  }, [user?.agencyId, user?.uid])

  // ── Low-balance one-shot notification ──────────────────────────────────
  // Fires when remaining drops below LOW_BALANCE_FRAC of allocated and we
  // haven't notified for the current depleted state yet. Sets
  // budget.lowBalanceNotifiedAt as the idempotency marker; admin clears it
  // on top-up or period reset. Multi-coordinator race is tolerated — duplicate
  // notifications are recoverable and rare at pilot scale.
  useEffect(() => {
    if (!agency || !user?.agencyId) return
    const allocated = agency.budget?.allocated ?? 0
    if (allocated <= 0) return
    const committed   = agency.budget?.committed ?? 0
    const remaining   = Math.max(0, allocated - committed)
    const notifiedAt  = agency.budget?.lowBalanceNotifiedAt
    if (notifiedAt) return
    if (remaining / allocated > LOW_BALANCE_FRAC) return

    ;(async () => {
      try {
        // Stake the idempotency flag first; if another coordinator wins the
        // race, their notify already fired and ours becomes a no-op next render.
        await updateDoc(doc(db, 'agencies', agency.id), {
          'budget.lowBalanceNotifiedAt': serverTimestamp(),
        })
        // Low-balance is an intra-agency concern. CRMC has zero fund
        // authority, so they're not notified. Targets: every user at this
        // agency (both coordinator and agency_admin roles).
        const teamSnap = await getDocs(query(
          collection(db, 'users'),
          where('agencyId', '==', agency.id),
          where('role', 'in', ['agency', 'agency_admin']),
        ))
        const targets = teamSnap.docs
        const pct = Math.round((remaining / allocated) * 100)
        await Promise.all(targets.map(d => notify(d.id, {
          type:  'budget_low',
          title: 'Budget running low',
          body:  `${agency.name} has only ₱${remaining.toLocaleString()} remaining (${pct}% of ₱${allocated.toLocaleString()} allocated). Top up to keep approving applications.`,
        }).catch(() => {})))
      } catch (err) {
        console.error('[Dashboard] low-balance notify failed:', err)
      }
    })()
  }, [agency, user?.agencyId])

  if (!agency) return (
    <Layout breadcrumb="Agency Dashboard">
      <div className="p-4 sm:p-6 max-w-3xl space-y-4">
        <div className="h-8 bg-gray-100 rounded w-48 animate-pulse mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-3 bg-gray-100 rounded w-24 mb-3" />
              <div className="h-7 bg-gray-100 rounded w-16" />
            </div>
          ))}
        </div>
        <div className="card p-4 animate-pulse">
          <div className="h-3 bg-gray-100 rounded w-32 mb-3" />
          <div className="h-2.5 bg-gray-100 rounded w-full" />
        </div>
      </div>
    </Layout>
  )

  const slots      = agency.slots ?? { total: 0, remaining: 0 }
  const slotPct    = slots.total > 0 ? Math.round(((slots.total - slots.remaining) / slots.total) * 100) : 0
  const pendingApps = applications.filter(a => a.status === 'pending' || a.status === 'reviewing')
  const approvedCount = applications.filter(a => a.status === 'approved' || a.status === 'certificate').length

  return (
    <Layout breadcrumb="Agency Dashboard">
      <div className="p-4 sm:p-6">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <AgencyAvatar agency={agency} className="w-10 h-10 rounded-xl text-sm" />
          <div>
            <h1 className="page-title">{agency.name} Workspace</h1>
            <p className="page-sub">Manage medical assistance applications for {agency.name}.</p>
          </div>
        </div>

        {/* Metrics */}
        <div data-tour-id="agency-metrics" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <MdWarning size={16} className="text-amber-500" />
              <span className="text-xs text-gray-500">Awaiting Funding Decision</span>
            </div>
            <p className="text-2xl font-semibold text-amber-600">{pendingApps.length}</p>
            <p className="text-xs text-gray-400">endorsed to you</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <MdCalendarToday size={16} className="text-brand-500" />
              <span className="text-xs text-gray-500">Available Slots Today</span>
            </div>
            <p className="text-2xl font-semibold text-brand-600">
              {slots.remaining} <span className="text-sm font-normal text-gray-400">/ {slots.total}</span>
            </p>
          </div>
          <div className="card p-4">
            <div className="text-xs text-gray-500 mb-1">Total Approved</div>
            <p className="text-2xl font-semibold text-gray-800">{approvedCount}</p>
          </div>
        </div>

        {/* Slot bar */}
        <div data-tour-id="agency-slots" className="card p-4 mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Today's Slot Usage</span>
            <span className="text-xs text-gray-400">Resets midnight</span>
          </div>
          <div className="w-full h-2.5 bg-gray-100 rounded-full mb-1">
            <div className="h-2.5 bg-brand-500 rounded-full transition-all" style={{ width: `${slotPct}%` }} />
          </div>
          <p className="text-xs text-gray-400">
            {slots.total - slots.remaining} used · {slots.remaining} remaining · resets midnight
          </p>
        </div>

        {/* Budget bar (read-only for agency) */}
        {(() => {
          const budget    = agency.budget ?? { period: 'monthly', allocated: 0, committed: 0, disbursed: 0 }
          const allocated = budget.allocated ?? 0
          if (allocated === 0) return null
          const committed = budget.committed ?? 0
          const disbursed = budget.disbursed ?? 0
          const remaining = Math.max(0, allocated - committed)
          const utilization = Math.round((committed / allocated) * 100)
          const bar = utilization >= 90 ? 'bg-red-400' : utilization >= 70 ? 'bg-amber-400' : 'bg-green-400'
          const warn = utilization >= 80

          // Stale-period detection: only meaningful for monthly periods (the
          // only configured option today). If periodStart is older than
          // STALE_PERIOD_DAYS, surface a banner so the agency knows to ask
          // their administrator for a period reset.
          const periodStart = budget.periodStart?.toDate
            ? budget.periodStart.toDate()
            : (budget.periodStart ? new Date(budget.periodStart) : null)
          const periodDays = periodStart
            ? Math.floor((Date.now() - periodStart.getTime()) / 86400000)
            : null
          const isStale = budget.period === 'monthly' && periodDays != null && periodDays > STALE_PERIOD_DAYS

          return (
            <div data-tour-id="agency-budget" className={`card p-4 mb-5 ${warn ? 'border-amber-200 bg-amber-50/30' : ''}`}>
              {isStale && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3 text-xs text-amber-700">
                  <MdWarning size={13} className="inline mr-1" />
                  This {PERIOD_NOUN[budget.period] ?? 'period'} started <strong>{periodDays} days ago</strong>. Ask your administrator if it's time to start a new {PERIOD_NOUN[budget.period] ?? 'period'}.
                </div>
              )}
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">{PERIOD_ADJECTIVE[budget.period] ?? 'Period'} Budget</span>
                <span className={`text-xs font-medium ${warn ? 'text-amber-600' : 'text-gray-400'}`}>
                  ₱{remaining.toLocaleString()} remaining
                </span>
              </div>
              <div className="w-full h-2.5 bg-gray-100 rounded-full mb-1">
                <div className={`h-2.5 ${bar} rounded-full transition-all`} style={{ width: `${Math.min(100, utilization)}%` }} />
              </div>
              <p className="text-xs text-gray-400">
                ₱{committed.toLocaleString()} committed · ₱{disbursed.toLocaleString()} disbursed · ₱{allocated.toLocaleString()} allocated
                {warn && <span className="ml-2 text-amber-600 font-medium">⚠ Approaching limit</span>}
              </p>
              {budget.fundSource && (
                <p className="text-xs text-gray-400 mt-1">
                  Source: <span className="font-medium text-gray-600">{budget.fundSource}</span>
                </p>
              )}
              {warn && (
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => setShowTopUp(true)}
                    className="text-xs bg-amber-500 text-white px-3 py-1.5 rounded-lg hover:bg-amber-600 transition-colors flex items-center gap-1">
                    <MdArrowForward size={13} /> Request Budget Top-Up
                  </button>
                </div>
              )}
            </div>
          )
        })()}

        {/* Quick Actions */}
        <div data-tour-id="agency-actions" className="mb-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Quick Actions</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {[
              { label: 'Inbox',          icon: MdInbox,          path: '/agency/inbox',       badge: pendingApps.length, color: 'bg-amber-50  text-amber-600'  },
              { label: 'GL Letters',     icon: MdCardMembership, path: '/agency/generator',                               color: 'bg-green-50  text-green-600'  },
              { label: 'Slot Mgmt',      icon: MdBarChart,       path: '/agency/slots',                                   color: 'bg-brand-50  text-brand-600'  },
              { label: 'App Logs',       icon: MdListAlt,        path: '/agency/logs',                                    color: 'bg-teal-50   text-teal-600'   },
              { label: 'Messages',       icon: MdMessage,        path: '/agency/messages',                                color: 'bg-cyan-50   text-cyan-600'   },
              { label: 'Agency Profile', icon: MdDescription,    path: '/agency/program',                                 color: 'bg-blue-50   text-blue-600'   },
            ].map((qa, i) => (
              <button key={i}
                onClick={() => navigate(qa.path)}
                className="card p-3 flex flex-col items-center gap-1.5 hover:shadow-md transition-all text-center relative">
                {qa.badge > 0 && (
                  <span className="absolute top-1.5 right-1.5 text-xs font-bold bg-red-500 text-white rounded-full min-w-4 h-4 px-1 flex items-center justify-center">
                    {qa.badge > 99 ? '99+' : qa.badge}
                  </span>
                )}
                <div className={`w-9 h-9 ${qa.color} rounded-xl flex items-center justify-center`}>
                  <qa.icon size={18} />
                </div>
                <p className="text-xs text-gray-600 font-medium leading-tight">{qa.label}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Pending applications */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-800">
            Pending Applications
            {pendingApps.length > 0 && (
              <span className="ml-2 badge badge-amber text-xs">{pendingApps.length}</span>
            )}
          </h2>
          <button className="text-xs text-brand-500 hover:text-brand-600 font-medium flex items-center gap-1"
            onClick={() => navigate('/agency/inbox')}>
            View all <MdArrowForward size={14} />
          </button>
        </div>

        {loading ? (
          <div className="card p-8 text-center text-sm text-gray-400">Loading applications...</div>
        ) : pendingApps.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-sm text-gray-400">No pending applications.</p>
            <p className="text-xs text-gray-300 mt-1">New applications will appear here when CRMC endorses requests to your agency.</p>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="data-table min-w-full">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Application ID</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pendingApps.slice(0, 5).map(app => (
                  <tr key={app.id}>
                    <td>
                      <p className="font-medium text-gray-800">{app.patientName}</p>
                      <p className="text-xs text-gray-400">{app.patientContact}</p>
                    </td>
                    <td className="text-gray-400 text-xs font-mono">{app.appId}</td>
                    <td className="text-gray-400 text-xs">{formatDate(app.submittedAt)}</td>
                    <td>
                      <StatusBadge status={app.status} />
                    </td>
                    <td>
                      <button className="btn-primary text-xs py-1.5 px-3"
                        onClick={() => navigate(`/agency/applications/${app.id}?queue=pending`)}>
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Replay-tour link. Unobtrusive footer placement so it's
            available when needed (training new coordinators, thesis
            demo) without crowding the daily-use surface. */}
        <div className="mt-8 pt-4 border-t border-gray-100 text-center">
          <button
            onClick={() => {
              resetTourFlag('agency-dashboard', user?.uid)
              // Force a refresh so <Tour> re-evaluates its localStorage
              // gate on mount. Simpler than wiring an external trigger.
              window.location.reload()
            }}
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-brand-600 transition-colors">
            <MdTour size={14} /> Show welcome tour again
          </button>
        </div>
      </div>

      {showTopUp && (
        <BudgetTopUpModal
          agency={agency}
          user={user}
          onClose={() => setShowTopUp(false)}
        />
      )}

      {/* First-visit guided tour for coordinators / agency admins.
          Auto-fires once per uid; spotlights metrics, slot meter,
          budget card, and quick-action shortcuts. */}
      <Tour steps={agencyDashboardTour} storageKey="agency-dashboard" />
    </Layout>
  )
}

// ── Budget Top-Up Request Modal ────────────────────────────────────────
// Lightweight: writes to the existing `reports` collection with a
// category of 'Budget Request'. Admins see it in their normal Reports
// queue and can filter by category. No new collection, no new admin UI.

function BudgetTopUpModal({ agency, user, onClose }) {
  const [amount, setAmount]   = useState('')
  const [reason, setReason]   = useState('')
  const [saving, setSaving]   = useState(false)

  const allocated = agency.budget?.allocated ?? 0
  const committed = agency.budget?.committed ?? 0
  const remaining = Math.max(0, allocated - committed)

  const submit = async () => {
    const amt = Number(amount)
    if (!amt || amt <= 0) { toast.error('Enter a valid amount greater than 0.'); return }
    if (!reason.trim())   { toast.error('Briefly explain why you need the top-up.'); return }
    setSaving(true)
    try {
      await addDoc(collection(db, 'reports'), {
        category:        'Budget Request',
        description:     `Requesting ₱${amt.toLocaleString()} top-up. Reason: ${reason.trim()}`,
        amountRequested: amt,
        agencyId:        agency.id,
        agencyName:      agency.name,
        currentRemaining: remaining,
        currentAllocated: allocated,
        reportedBy:      user.uid,
        reporterName:    user.name,
        reporterEmail:   user.email,
        reporterRole:    user.role,
        createdAt:       serverTimestamp(),
        status:          'open',
      })
      // Top-up is an intra-agency matter — funds come from the agency's
      // own source, not CRMC. Notify the agency_admin for this agency.
      // (If no agency_admin exists yet, the report still lands in the
      // reports collection and a super_admin can promote one.)
      getDocs(query(
        collection(db, 'users'),
        where('agencyId', '==', agency.id),
        where('role', '==', 'agency_admin'),
      ))
        .then(snap => Promise.all(snap.docs.map(d => notify(d.id, {
          type:  'budget_request',
          title: 'Budget top-up requested',
          body:  `${user.name} is requesting ₱${amt.toLocaleString()}. Currently ₱${remaining.toLocaleString()} remaining of ₱${allocated.toLocaleString()}. Review on the Allocation page.`,
        })))).catch(() => {})
      toast.success('Request submitted. Your agency administrator has been notified.')
      onClose()
    } catch (err) {
      console.error('[BudgetTopUpModal] submit error:', err)
      toast.error('Failed to submit request.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[300] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Request Budget Top-Up</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
            <p className="text-xs text-gray-500 mb-1">Current budget — {agency.name}</p>
            <p className="text-sm font-semibold text-gray-800">₱{remaining.toLocaleString()} remaining</p>
            <p className="text-xs text-gray-400">of ₱{allocated.toLocaleString()} allocated</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Amount requested (₱) <span className="text-red-400">*</span>
            </label>
            <input type="number" min={1} className="input"
              placeholder="e.g. 50000"
              value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Reason <span className="text-red-400">*</span>
            </label>
            <textarea className="input resize-none" rows={3}
              placeholder="Why does the agency need this top-up? Be specific so the administrator can assess quickly."
              value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          <p className="text-xs text-gray-400">
            This sends a request to the administrators. They'll review and either top up your allocation directly or contact you for more details.
          </p>
        </div>
        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button
            className="text-sm bg-amber-500 text-white px-3 py-1.5 rounded-lg hover:bg-amber-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
            disabled={saving}
            onClick={submit}>
            {saving ? 'Submitting…' : 'Send Request'}
          </button>
        </div>
      </div>
    </div>
  )
}
