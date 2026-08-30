import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../firebase'
import { analyticsForRange, formatMonth } from '../../utils/analytics'
import BarList from '../../components/charts/BarList'
import TrendArea from '../../components/charts/TrendArea'
import DeltaChip from '../../components/admin/DeltaChip'
import PipelineFunnel from '../../components/admin/PipelineFunnel'
import {
  MdPayments, MdGroup, MdWorkspacePremium, MdVerified, MdDownload, MdInsights, MdTimer, MdHealthAndSafety,
} from 'react-icons/md'
import toast from 'react-hot-toast'

const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`

// Lifecycle stages for the pipeline distribution (all requests, in flow order).
const PIPELINE = [
  ['submitted', 'Submitted'], ['under_review', 'Under review'], ['assessment', 'Assessment'],
  ['endorsed', 'Endorsed'], ['partially_funded', 'Partially funded'], ['fully_funded', 'Fully funded'],
]
const OUTCOME_TONE = { brand: 'bg-brand-500', gray: 'bg-gray-300', amber: 'bg-amber-400', red: 'bg-red-400' }

// CRMC Program Overview — the board-level analytics surface (Magic Patterns
// adoption): facilitation KPIs with period-over-period deltas, a reporting-range
// selector, the request pipeline distribution, where requests end up, and the
// by-agency / by-type breakdowns. Staff surface (English-only).
export default function Analytics() {
  const navigate = useNavigate()
  const [slices,   setSlices]   = useState(null)
  const [requests, setRequests] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [rangeDays, setRangeDays] = useState(null) // null = all-time

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [appSnap, reqSnap] = await Promise.all([
          getDocs(collection(db, 'applications')),
          getDocs(collection(db, 'requests')),
        ])
        if (!alive) return
        setSlices(appSnap.docs.map(d => ({ id: d.id, ...d.data() })))
        setRequests(reqSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (err) {
        console.error('[Analytics] load failed:', err)
        toast.error('Failed to load analytics. Please refresh the page.')
        setSlices([])
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const a = useMemo(() => analyticsForRange(slices ?? [], requests, rangeDays), [slices, requests, rangeDays])

  const pipelineStages = useMemo(
    () => PIPELINE.map(([key, label]) => ({ key, label, count: requests.filter(r => r.status === key).length })),
    [requests])
  const outcomesMax = Math.max(1, ...(a.outcomes ?? []).map(o => o.count))

  const exportSummary = () => {
    const rows = [
      ['MAPA — Program Overview', ''],
      ['Generated', new Date().toLocaleString()],
      ['Reporting period', rangeDays ? `Last ${rangeDays} days` : 'All time'],
      [''],
      ['Total assistance facilitated', a.totalFacilitated],
      ['Patients helped', a.patientsHelped],
      ['Guarantee Letters issued', a.glsIssued],
      ['Guarantee Letters redeemed', a.glsRedeemed],
      ['Approval rate (%)', a.approvalRate ?? ''],
      ['PhilHealth share of bills (%)', a.philhealthShare ?? ''],
      ['Avg turnaround (days)', a.avgTurnaroundDays != null ? a.avgTurnaroundDays.toFixed(1) : ''],
      ['Fully-funded requests', a.requestsFullyFunded],
      ['Total requests', a.requestsTotal],
      [''],
      ['By agency', 'Amount', 'Count'],
      ...a.byAgency.map(x => [x.label, x.amount, x.count]),
      [''],
      ['By assistance type', 'Amount', 'Count'],
      ...a.byType.map(x => [x.label, x.amount, x.count]),
      [''],
      ['By month', 'Amount', 'Count'],
      ...a.byMonth.map(x => [formatMonth(x.key), x.amount, x.count]),
    ]
    const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `mapa-program-overview-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const kpis = [
    { label: 'Assistance facilitated', value: peso(a.totalFacilitated), Icon: MdPayments, tone: 'text-brand-600', delta: a.deltas?.totalFacilitated },
    { label: 'Patients helped',        value: a.patientsHelped,          Icon: MdGroup,    tone: 'text-gray-900', delta: a.deltas?.patientsHelped },
    { label: 'Guarantee Letters issued', value: a.glsIssued, sub: `${a.glsRedeemed} redeemed`, Icon: MdWorkspacePremium, tone: 'text-gray-900', delta: a.deltas?.glsIssued },
    { label: 'Approval rate', value: a.approvalRate != null ? `${a.approvalRate}%` : '—', sub: `of ${a.requestsTotal} requests`, Icon: MdVerified, tone: 'text-gray-900' },
  ]

  const hasAnyData = (slices ?? []).length > 0 || requests.length > 0
  const hasData = hasAnyData && (a.totalFacilitated > 0 || a.requestsTotal > 0)
  const RANGES = [['all', null, 'All'], ['90d', 90, '90d'], ['30d', 30, '30d'], ['7d', 7, '7d']]

  return (
    <Layout breadcrumb="Program Overview">
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <p className="eyebrow">Analytics</p>
            <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Program Overview</h1>
            <p className="text-sm text-gray-500 mt-1">
              Medical assistance across CRMC and partner agencies — the outcome view behind the operational queues.
            </p>
          </div>
          {hasAnyData && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="flex rounded-lg border border-gray-200 bg-white p-0.5" role="group" aria-label="Reporting period">
                {RANGES.map(([key, days, label]) => (
                  <button key={key} type="button" onClick={() => setRangeDays(days)} aria-pressed={rangeDays === days}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                      rangeDays === days ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-800'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
              <button onClick={exportSummary} className="btn-secondary text-sm flex items-center gap-1.5">
                <MdDownload size={16} /> Export
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="stat-tile animate-pulse"><div className="h-8 bg-gray-100 rounded w-24" /><div className="h-3 bg-gray-100 rounded w-16 mt-3" /></div>
            ))}
          </div>
        ) : !hasData ? (
          <div className="card p-10 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-brand-50 flex items-center justify-center">
              <MdInsights size={30} className="text-brand-400" />
            </div>
            <p className="text-base font-semibold text-gray-800 mb-1">No program data yet</p>
            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              As patients submit requests and agencies fund them, the program figures, pipeline, and trends appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

            {/* KPI row */}
            <div className="lg:col-span-12 grid grid-cols-2 lg:grid-cols-4 gap-4">
              {kpis.map(k => (
                <div key={k.label} className="stat-tile">
                  <div className="flex items-center justify-between">
                    <k.Icon size={18} className="text-gray-300" />
                    {k.delta != null && <DeltaChip value={k.delta} />}
                  </div>
                  <p className={`stat-num mt-2 ${k.tone}`}>{k.value}</p>
                  <p className="stat-label">{k.label}{k.sub ? ` · ${k.sub}` : ''}</p>
                </div>
              ))}
            </div>

            {/* Trend (8) + Health (4) */}
            <div className="lg:col-span-8 card p-5">
              <p className="eyebrow mb-1">Over time</p>
              <h2 className="text-base font-semibold text-gray-900 mb-4">Assistance facilitated per month</h2>
              <TrendArea data={a.byMonth} labelFor={(d) => formatMonth(d.key)} />
            </div>
            <div className="lg:col-span-4 card p-5">
              <p className="eyebrow mb-3">Program health</p>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0"><MdTimer size={18} className="text-brand-500" /></div>
                  <div>
                    <p className="text-xs text-gray-400">Median agency turnaround</p>
                    <p className="text-xl font-semibold text-gray-800 tabular-nums">{a.avgTurnaroundDays != null ? `${a.avgTurnaroundDays.toFixed(1)} days` : '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0"><MdHealthAndSafety size={18} className="text-green-600" /></div>
                  <div>
                    <p className="text-xs text-gray-400">PhilHealth share of bills</p>
                    <p className="text-xl font-semibold text-gray-800 tabular-nums">{a.philhealthShare != null ? `${a.philhealthShare}%` : '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0"><MdWorkspacePremium size={18} className="text-purple-600" /></div>
                  <div>
                    <p className="text-xs text-gray-400">Guarantee Letters redeemed</p>
                    <p className="text-xl font-semibold text-gray-800 tabular-nums">{a.glsRedeemed} <span className="text-sm font-normal text-gray-400">of {a.glsIssued}</span></p>
                  </div>
                </div>
              </div>
            </div>

            {/* Pipeline (7) + Outcomes (5) */}
            <div className="lg:col-span-7">
              <PipelineFunnel stages={pipelineStages} onOpenQueue={() => navigate('/admin/requests')} />
            </div>
            <div className="lg:col-span-5 card p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-gray-800">Where requests end up</h2>
              <p className="text-xs text-gray-500 mt-0.5">Outcome distribution across all {a.requestsTotal} requests.</p>
              <ul className="mt-4 space-y-3">
                {(a.outcomes ?? []).map(o => (
                  <li key={o.key} className="flex items-center gap-3">
                    <span className="w-[42%] shrink-0 truncate text-sm text-gray-700">{o.label}</span>
                    <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                      <span className={`block h-full rounded-full ${OUTCOME_TONE[o.tone] ?? 'bg-gray-300'}`} style={{ width: `${Math.round((o.count / outcomesMax) * 100)}%` }} />
                    </span>
                    <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900">{o.count}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Breakdowns */}
            <div className="lg:col-span-6 card p-5">
              <p className="eyebrow mb-1">Breakdown</p>
              <h2 className="text-base font-semibold text-gray-900 mb-4">By agency</h2>
              <BarList data={a.byAgency} />
            </div>
            <div className="lg:col-span-6 card p-5">
              <p className="eyebrow mb-1">Breakdown</p>
              <h2 className="text-base font-semibold text-gray-900 mb-4">By assistance type</h2>
              <BarList data={a.byType} />
            </div>

          </div>
        )}
      </div>
    </Layout>
  )
}
