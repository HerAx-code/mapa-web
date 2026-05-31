import Layout from '../../components/Layout'
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore'
import { db } from '../../firebase'
import { PERIOD_ADJECTIVE } from '../../utils/constants'
import { tsToDate } from '../../utils/dates'
import { useAuth } from '../../contexts/AuthContext'
import {
  MdSearch, MdCheckCircle, MdCancel, MdHourglassEmpty,
  MdReceipt, MdArrowForward, MdWarning, MdFilterList,
} from 'react-icons/md'

const PAGE_SIZE = 25

const EVENT_META = {
  approve: { label: 'Approved',        icon: MdCheckCircle,    bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-100',  sign: '+',  desc: 'Committed budget' },
  redeem:  { label: 'GL Redeemed',     icon: MdReceipt,        bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-100', sign: '→',  desc: 'Committed → Disbursed' },
  expire:  { label: 'GL Expired',      icon: MdHourglassEmpty, bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', sign: '−',  desc: 'Released to remaining' },
  reverse: { label: 'Reversed',        icon: MdCancel,         bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',    sign: '−',  desc: 'Released to remaining' },
}

const formatDate = (ts) => {
  const d = tsToDate(ts)
  if (!d) return '—'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

const formatDateTime = (ts) => {
  const d = tsToDate(ts)
  if (!d) return '—'
  return d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Best-effort parse of the reversal date stored inside reversalReason
// (the rest of the codebase formats it as "Reversed by X on M/D/YYYY").
// Falls back to updatedAt if we can't parse.
const parseReversalDate = (reason, fallback) => {
  if (!reason) return fallback
  const m = reason.match(/on (\d{1,2}\/\d{1,2}\/\d{2,4})/i)
  if (m) {
    const d = new Date(m[1])
    if (!isNaN(d.getTime())) return d
  }
  return fallback
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function AgencyFunds() {
  const { user }      = useAuth()
  const navigate      = useNavigate()
  const [agency,     setAgency]     = useState(null)
  const [apps,       setApps]       = useState([])
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [startDate,  setStartDate]  = useState('')
  const [endDate,    setEndDate]    = useState('')
  const [page,       setPage]       = useState(0)

  // Live agency budget
  useEffect(() => {
    if (!user?.agencyId) return
    const unsub = onSnapshot(doc(db, 'agencies', user.agencyId),
      snap => snap.exists() && setAgency({ id: snap.id, ...snap.data() }),
      (err) => console.error('[Funds] agency snapshot error:', err),
    )
    return unsub
  }, [user?.agencyId])

  // Live applications for this agency
  useEffect(() => {
    if (!user?.agencyId) return
    const q = query(collection(db, 'applications'), where('agencyId', '==', user.agencyId))
    const unsub = onSnapshot(q,
      snap => {
        setApps(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setLoading(false)
      },
      (err) => {
        setLoading(false)
        console.error('[Funds] applications snapshot error:', err)
      },
    )
    return unsub
  }, [user?.agencyId])

  // Derive events from application state. Each app contributes 1–3 events
  // (approve, then optionally redeem/expire/reverse). Reversal preserves
  // approvedAmount + a reversedAt timestamp, so amounts and timestamps are
  // accurate end-to-end. Older docs that predate the preserve-on-reverse
  // change may still show "amount n/a" — that's fine for legacy data.
  const events = useMemo(() => {
    const out = []
    for (const a of apps) {
      const isReversed     = !!a.reversedAt || !!a.reversalReason
      const approvedAmount = Number(a.approvedAmount) || 0
      const hasAmount      = approvedAmount > 0

      // Approve event — prefer real approvedAt, fall back to back-solving
      // from cooldownUntilAt for reversed apps (cooldown = approvedAt + 30d).
      let approveDate = tsToDate(a.approvedAt)
      if (!approveDate && isReversed && a.cooldownUntilAt) {
        const cooldownUntil = tsToDate(a.cooldownUntilAt)
        if (cooldownUntil) approveDate = new Date(cooldownUntil.getTime() - 30 * 86400000)
      }
      if (approveDate) {
        out.push({
          id:       `${a.id}:approve`,
          appId:    a.id,
          type:     'approve',
          date:     approveDate,
          amount:   hasAmount ? approvedAmount : null,
          appCode:  a.appId,
          patient:  a.patientName,
          actor:    a.approvedBy ?? '—',
        })
      }

      if (a.glRedeemedAt) {
        out.push({
          id:       `${a.id}:redeem`,
          appId:    a.id,
          type:     'redeem',
          date:     tsToDate(a.glRedeemedAt),
          amount:   hasAmount ? approvedAmount : null,
          appCode:  a.appId,
          patient:  a.patientName,
          payableTo: a.payableTo,
        })
      }

      if (a.glExpiredAt) {
        out.push({
          id:       `${a.id}:expire`,
          appId:    a.id,
          type:     'expire',
          date:     tsToDate(a.glExpiredAt),
          amount:   hasAmount ? approvedAmount : null,
          appCode:  a.appId,
          patient:  a.patientName,
          actor:    a.expiredBy === 'auto-sweep' ? 'system (auto-sweep)' : 'manual',
        })
      }

      if (isReversed) {
        // Prefer the explicit reversedAt timestamp; fall back to parsing the
        // date string baked into reversalReason for legacy records.
        const reverseDate = tsToDate(a.reversedAt)
          ?? parseReversalDate(a.reversalReason, tsToDate(a.updatedAt))
        out.push({
          id:       `${a.id}:reverse`,
          appId:    a.id,
          type:     'reverse',
          date:     reverseDate,
          amount:   hasAmount ? approvedAmount : null,
          appCode:  a.appId,
          patient:  a.patientName,
          actor:    a.reversedBy ?? '—',
          reason:   a.reversalReason,
        })
      }
    }
    return out.sort((x, y) => (y.date?.getTime() ?? 0) - (x.date?.getTime() ?? 0))
  }, [apps])

  // Filters
  const filtered = useMemo(() => {
    const startMs = startDate ? new Date(startDate + 'T00:00:00').getTime() : null
    const endMs   = endDate   ? new Date(endDate   + 'T23:59:59').getTime() : null
    const q       = search.toLowerCase()
    return events.filter(e => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false
      if (startMs && (e.date?.getTime() ?? 0) < startMs) return false
      if (endMs   && (e.date?.getTime() ?? 0) > endMs)   return false
      if (!q) return true
      return (
        e.patient?.toLowerCase().includes(q) ||
        e.appCode?.toLowerCase().includes(q)
      )
    })
  }, [events, typeFilter, startDate, endDate, search])

  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  // Reset to page 0 when filters change
  useEffect(() => { setPage(0) }, [typeFilter, startDate, endDate, search])

  // Budget header
  const budget    = agency?.budget ?? { period: 'monthly', allocated: 0, committed: 0, disbursed: 0 }
  const allocated = budget.allocated ?? 0
  const committed = budget.committed ?? 0
  const disbursed = budget.disbursed ?? 0
  const remaining = Math.max(0, allocated - committed)
  const utilization = allocated > 0 ? Math.round((committed / allocated) * 100) : 0
  const bar = utilization >= 90 ? 'bg-red-400' : utilization >= 70 ? 'bg-amber-400' : 'bg-green-400'

  // Counts of each event type in the currently filtered window
  const counts = useMemo(() => {
    const c = { approve: 0, redeem: 0, expire: 0, reverse: 0 }
    for (const e of filtered) c[e.type] = (c[e.type] ?? 0) + 1
    return c
  }, [filtered])

  const clearFilters = () => {
    setSearch('')
    setTypeFilter('all')
    setStartDate('')
    setEndDate('')
  }

  const isFiltered = search || typeFilter !== 'all' || startDate || endDate

  return (
    <Layout breadcrumb="Funds">
      <div className="p-4 sm:p-6 max-w-5xl">

        {/* Header */}
        <div className="mb-5">
          <h1 className="page-title">Funds</h1>
          <p className="page-sub">Budget breakdown and history of every event that touched your agency's allocation.</p>
        </div>

        {/* Budget summary card */}
        {allocated === 0 ? (
          <div className="card p-5 mb-5 bg-amber-50 border-amber-200">
            <div className="flex items-start gap-2">
              <MdWarning size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800 mb-0.5">No budget allocated yet</p>
                <p className="text-xs text-amber-700">
                  Your agency has no budget allocation set. Approvals can still proceed but won't be tracked against a budget. Ask a system administrator to allocate one.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="card p-5 mb-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                {PERIOD_ADJECTIVE[budget.period] ?? 'Current'} Budget
              </p>
              <p className="text-xs text-gray-400">
                Period started {formatDate(budget.periodStart)}
              </p>
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
            <p className="text-xs text-gray-400">
              {utilization}% utilized · committed = sum of issued-but-not-redeemed GLs · disbursed = redeemed GLs · remaining = what new approvals can draw from
            </p>
            {budget.fundSource && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-0.5">Fund source</p>
                <p className="text-sm font-medium text-gray-700">{budget.fundSource}</p>
                {budget.fundSourceNotes && (
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{budget.fundSourceNotes}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Event-type filter chips */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
          {[
            { key: 'all',     label: 'All events', value: filtered.length, color: 'text-gray-800' },
            { key: 'approve', label: 'Approvals',  value: counts.approve,  color: 'text-green-600' },
            { key: 'redeem',  label: 'Redeemed',   value: counts.redeem,   color: 'text-purple-600' },
            { key: 'expire',  label: 'Expired',    value: counts.expire,   color: 'text-orange-600' },
            { key: 'reverse', label: 'Reversed',   value: counts.reverse,  color: 'text-red-500' },
          ].map(m => {
            const active = typeFilter === m.key
            return (
              <button key={m.key}
                onClick={() => setTypeFilter(active && m.key !== 'all' ? 'all' : m.key)}
                className={`card p-3 text-left transition-all hover:shadow-md ${active ? 'ring-2 ring-brand-300' : ''}`}>
                <p className="text-xs text-gray-400 mb-1">{m.label}</p>
                <p className={`text-lg font-semibold ${m.color}`}>{loading ? '—' : m.value}</p>
              </button>
            )
          })}
        </div>

        {/* Search + date range */}
        <div className="card p-4 mb-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[240px]">
              <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input className="input pl-9"
                placeholder="Search by patient name or application ID..."
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <MdFilterList size={14} className="text-gray-400 flex-shrink-0" />
              <label className="text-xs text-gray-500">From</label>
              <input type="date" className="input text-sm py-1.5"
                value={startDate} onChange={e => setStartDate(e.target.value)} />
              <label className="text-xs text-gray-500">to</label>
              <input type="date" className="input text-sm py-1.5"
                value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            {isFiltered && (
              <button onClick={clearFilters} className="text-xs text-brand-500 hover:text-brand-600 font-medium">
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Event list */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">Loading events…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center">
              <MdReceipt size={32} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">
                {isFiltered ? 'No events match the current filters.' : 'No budget events yet. They\'ll appear here as you approve and redeem applications.'}
              </p>
              {isFiltered && (
                <button
                  onClick={clearFilters}
                  className="mt-3 inline-flex items-center text-sm font-medium text-brand-500 hover:text-brand-600">
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              <table className="data-table min-w-full">
                <thead>
                  <tr>
                    <th className="text-left">Event</th>
                    <th className="text-left">Application</th>
                    <th className="text-left">Date</th>
                    <th className="text-right">Amount</th>
                    <th className="text-left">Effect on budget</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map(e => {
                    const meta = EVENT_META[e.type]
                    const Icon = meta.icon
                    // Build a one-line audit trailer for the row's hover
                    // tooltip. Surfaces who-did-this + (for redeems) which
                    // provider was paid, without taking up table column
                    // real estate. The data was already loaded onto the
                    // event object but never displayed.
                    const tooltip = [
                      e.actor && `By ${e.actor}`,
                      e.payableTo && `Payable to ${e.payableTo}`,
                      e.reason,
                    ].filter(Boolean).join(' · ')
                    return (
                      <tr key={e.id}
                        title={tooltip || undefined}
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => navigate(`/agency/applications/${e.appId}`)}>
                        <td>
                          <div className="flex items-center gap-2">
                            <span className={`w-8 h-8 rounded-lg ${meta.bg} ${meta.text} flex items-center justify-center flex-shrink-0`}>
                              <Icon size={16} />
                            </span>
                            <span className={`text-sm font-medium ${meta.text}`}>{meta.label}</span>
                          </div>
                        </td>
                        <td>
                          <p className="text-sm text-gray-800">{e.patient ?? '—'}</p>
                          <p className="text-xs text-gray-400 font-mono">{e.appCode ?? e.appId.slice(0, 8)}</p>
                        </td>
                        <td className="text-sm text-gray-600">{formatDateTime(e.date)}</td>
                        <td className="text-right">
                          {e.amount != null ? (
                            <span className={`text-sm font-semibold ${meta.text}`}>
                              {meta.sign} ₱{e.amount.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 italic" title={e.note ?? e.reason ?? ''}>amount n/a</span>
                          )}
                        </td>
                        <td className="text-xs text-gray-500">{meta.desc}</td>
                        <td>
                          <MdArrowForward size={14} className="text-gray-300" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
                  <span>
                    Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      className="px-3 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}>
                      Previous
                    </button>
                    <span>Page {page + 1} of {totalPages}</span>
                    <button
                      className="px-3 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}>
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <p className="text-xs text-gray-400 mt-4 leading-relaxed">
          <strong>Note —</strong> Events are derived from each application's current state. Legacy reversals (made before this version) may show "amount n/a"; new reversals preserve the original amount. Hover any row for the actor and other context.{' '}
          {user?.role === 'agency_admin' && (
            <>The full agency audit trail lives in the{' '}
              <button onClick={() => navigate('/agency/audit')}
                className="text-brand-500 hover:text-brand-600 font-medium underline underline-offset-2">
                Audit Log
              </button>.
            </>
          )}
        </p>

      </div>
    </Layout>
  )
}
