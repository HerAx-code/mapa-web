import Layout from '../../components/Layout'
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase'
import { exportToCSV, dateStamp } from '../../utils/export'
import {
  MdAttachMoney, MdDownload, MdSearch, MdWarning,
  MdTrendingUp, MdAccountBalance, MdReceipt, MdArrowForward,
} from 'react-icons/md'

const peso = (n) => `₱${Number(n ?? 0).toLocaleString()}`

const tierFor = (utilization) =>
  utilization >= 100 ? 'over'
  : utilization >= 90 ? 'critical'
  : utilization >= 70 ? 'warn'
  : 'ok'

const TIER_BAR = {
  ok:       'bg-green-400',
  warn:     'bg-amber-400',
  critical: 'bg-red-400',
  over:     'bg-red-500',
}
const TIER_LABEL = {
  ok:       { text: 'Within limits',     cls: 'badge-green' },
  warn:     { text: 'High utilization',  cls: 'badge-amber' },
  critical: { text: 'Near limit',         cls: 'badge-red'   },
  over:     { text: 'Over committed',     cls: 'badge-red'   },
}

export default function Funds() {
  const navigate                = useNavigate()
  const [agencies, setAgencies] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [filter,   setFilter]   = useState('all')  // all | with_budget | no_budget | warn

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'agencies'),
      snap => {
        setAgencies(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setLoading(false)
      },
      () => setLoading(false)
    )
    return unsub
  }, [])

  const enriched = useMemo(() => agencies.map(a => {
    const b = a.budget ?? { period: 'monthly', allocated: 0, committed: 0, disbursed: 0 }
    const allocated = b.allocated ?? 0
    const committed = b.committed ?? 0
    const disbursed = b.disbursed ?? 0
    const remaining = Math.max(0, allocated - committed)
    const utilization = allocated > 0 ? (committed / allocated) * 100 : 0
    const tier = allocated > 0 ? tierFor(utilization) : null
    return { ...a, _b: b, allocated, committed, disbursed, remaining, utilization, tier }
  }), [agencies])

  // Portfolio totals
  const totals = useMemo(() => {
    const t = { allocated: 0, committed: 0, disbursed: 0, withBudget: 0, withoutBudget: 0, agencies: enriched.length }
    enriched.forEach(a => {
      t.allocated += a.allocated
      t.committed += a.committed
      t.disbursed += a.disbursed
      if (a.allocated > 0) t.withBudget++
      else t.withoutBudget++
    })
    t.remaining   = Math.max(0, t.allocated - t.committed)
    t.utilization = t.allocated > 0 ? Math.round((t.committed / t.allocated) * 100) : 0
    return t
  }, [enriched])

  const filtered = useMemo(() => {
    let list = enriched
    if (filter === 'with_budget') list = list.filter(a => a.allocated > 0)
    if (filter === 'no_budget')   list = list.filter(a => a.allocated === 0)
    if (filter === 'warn')        list = list.filter(a => a.tier === 'warn' || a.tier === 'critical' || a.tier === 'over')
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(a => a.name?.toLowerCase().includes(q))
    return list.sort((a, b) => b.utilization - a.utilization)
  }, [enriched, filter, search])

  const handleExport = () => {
    exportToCSV(`funds-overview-${dateStamp()}.csv`, [
      { label: 'Agency',     getValue: a => a.name ?? '' },
      { label: 'Period',     getValue: a => a._b.period ?? '' },
      { label: 'Allocated',  getValue: a => a.allocated },
      { label: 'Committed',  getValue: a => a.committed },
      { label: 'Disbursed',  getValue: a => a.disbursed },
      { label: 'Remaining',  getValue: a => a.remaining },
      { label: 'Utilization %', getValue: a => a.allocated > 0 ? Math.round(a.utilization) : '' },
      { label: 'Status',     getValue: a => a.tier ? TIER_LABEL[a.tier].text : 'No budget' },
    ], enriched)
  }

  const portfolioBar = totals.utilization >= 90 ? 'bg-red-400'
    : totals.utilization >= 70 ? 'bg-amber-400'
    : 'bg-green-400'

  return (
    <Layout breadcrumb="Funds Overview">
      <div className="p-4 sm:p-6">

        {/* Header */}
        <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <MdAttachMoney size={22} className="text-green-600" />
              Funds Overview
            </h1>
            <p className="page-sub">Portfolio-wide budget allocation, commitment, and disbursement across all agencies.</p>
          </div>
          <button className="btn-secondary flex items-center gap-1.5 text-sm"
            onClick={handleExport}>
            <MdDownload size={16} /> Export CSV
          </button>
        </div>

        {/* Portfolio metric cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <MdAccountBalance size={16} className="text-gray-400" />
              <span className="text-xs text-gray-500">Total Allocated</span>
            </div>
            <p className="text-2xl font-semibold text-gray-900">{peso(totals.allocated)}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {totals.withBudget} of {totals.agencies} agencies funded
            </p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <MdTrendingUp size={16} className="text-amber-500" />
              <span className="text-xs text-gray-500">Committed</span>
            </div>
            <p className="text-2xl font-semibold text-amber-600">{peso(totals.committed)}</p>
            <p className="text-xs text-gray-400 mt-0.5">Approved but not yet redeemed</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <MdReceipt size={16} className="text-purple-500" />
              <span className="text-xs text-gray-500">Disbursed</span>
            </div>
            <p className="text-2xl font-semibold text-purple-600">{peso(totals.disbursed)}</p>
            <p className="text-xs text-gray-400 mt-0.5">GLs redeemed by providers</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <MdAttachMoney size={16} className="text-green-500" />
              <span className="text-xs text-gray-500">Remaining</span>
            </div>
            <p className="text-2xl font-semibold text-green-600">{peso(totals.remaining)}</p>
            <p className="text-xs text-gray-400 mt-0.5">Available for new approvals</p>
          </div>
        </div>

        {/* Portfolio utilization bar */}
        {totals.allocated > 0 && (
          <div className="card p-4 mb-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Portfolio utilization</span>
              <span className={`text-sm font-semibold ${
                totals.utilization >= 90 ? 'text-red-500'
                : totals.utilization >= 70 ? 'text-amber-600'
                : 'text-green-600'
              }`}>
                {totals.utilization}%
              </span>
            </div>
            <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${portfolioBar}`}
                style={{ width: `${Math.min(100, totals.utilization)}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {peso(totals.committed)} committed · {peso(totals.disbursed)} disbursed · {peso(totals.remaining)} remaining of {peso(totals.allocated)} allocated
            </p>
          </div>
        )}

        {/* Alerts strip */}
        {totals.withoutBudget > 0 && (
          <div className="mb-5 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex items-start gap-2">
            <MdWarning size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              <strong>{totals.withoutBudget} {totals.withoutBudget === 1 ? 'agency has' : 'agencies have'} no budget allocated.</strong>
              {' '}Approvals from these agencies won't be tracked against a fund — set an allocation from each Agency Detail page.
            </p>
          </div>
        )}

        {/* Filters + search */}
        <div className="flex gap-2 mb-4 flex-wrap items-center">
          <div className="flex gap-1">
            {[
              ['all',          'All',          enriched.length],
              ['with_budget',  'With budget',  enriched.filter(a => a.allocated > 0).length],
              ['no_budget',    'No budget',    enriched.filter(a => a.allocated === 0).length],
              ['warn',         'Needs attention', enriched.filter(a => ['warn','critical','over'].includes(a.tier)).length],
            ].map(([key, label, count]) => (
              <button key={key}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  filter === key
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
                onClick={() => setFilter(key)}>
                {label}
                {count > 0 && (
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${filter === key ? 'bg-white/20' : 'bg-gray-100'}`}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-48 ml-auto">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input className="input pl-9 text-sm" placeholder="Search agency…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {/* Per-agency table */}
        <div className="card overflow-x-auto">
          <table className="data-table min-w-full">
            <thead>
              <tr>
                <th>Agency</th>
                <th>Period</th>
                <th className="text-right">Allocated</th>
                <th className="text-right">Committed</th>
                <th className="text-right">Disbursed</th>
                <th className="text-right">Remaining</th>
                <th>Utilization</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td><div className="h-3 bg-gray-100 rounded w-28" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-16" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-20 ml-auto" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-20 ml-auto" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-20 ml-auto" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-20 ml-auto" /></td>
                  <td><div className="h-2 bg-gray-100 rounded w-24" /></td>
                  <td><div className="h-5 bg-gray-100 rounded-full w-20" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-10" /></td>
                </tr>
              ))}
              {!loading && filtered.map(a => {
                const tierMeta = a.tier ? TIER_LABEL[a.tier] : null
                return (
                  <tr key={a.id} className="cursor-pointer hover:bg-gray-50"
                    onClick={() => navigate(`/admin/agencies/${a.id}`)}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-lg ${a.color ?? 'bg-gray-400'} text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}>
                          {a.initials ?? a.name?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <span className="text-sm font-medium text-gray-800">{a.name}</span>
                      </div>
                    </td>
                    <td className="text-xs text-gray-500 capitalize">{a._b.period ?? '—'}</td>
                    <td className="text-right text-sm text-gray-800">{peso(a.allocated)}</td>
                    <td className="text-right text-sm text-amber-600">{peso(a.committed)}</td>
                    <td className="text-right text-sm text-purple-600">{peso(a.disbursed)}</td>
                    <td className="text-right text-sm font-medium text-green-600">{peso(a.remaining)}</td>
                    <td>
                      {a.allocated > 0 ? (
                        <div className="flex items-center gap-2 min-w-24">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${TIER_BAR[a.tier]}`}
                              style={{ width: `${Math.min(100, a.utilization)}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 w-8 text-right">{Math.round(a.utilization)}%</span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td>
                      {tierMeta ? (
                        <span className={`badge text-xs ${tierMeta.cls}`}>{tierMeta.text}</span>
                      ) : (
                        <span className="badge badge-gray text-xs">No budget</span>
                      )}
                    </td>
                    <td>
                      <MdArrowForward size={14} className="text-gray-300" />
                    </td>
                  </tr>
                )
              })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-12">
                    <MdAttachMoney size={36} className="text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">
                      {search || filter !== 'all' ? 'No agencies match your filter.' : 'No agencies found.'}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-400 mt-4 leading-relaxed max-w-3xl">
          <strong>Definitions —</strong> <strong>Allocated:</strong> period budget set by admin · <strong>Committed:</strong> sum of approved-but-not-yet-redeemed Guarantee Letters · <strong>Disbursed:</strong> sum of GLs redeemed by providers · <strong>Remaining:</strong> Allocated − Committed (what new approvals can draw from). MAPA records commitments only — actual settlement happens off-system.
        </p>
      </div>
    </Layout>
  )
}
