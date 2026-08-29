import { useState, useEffect, useMemo } from 'react'
import Layout from '../../components/Layout'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../firebase'
import { computeAnalytics, formatMonth } from '../../utils/analytics'
import BarList from '../../components/charts/BarList'
import TrendArea from '../../components/charts/TrendArea'
import {
  MdPayments, MdGroup, MdWorkspacePremium, MdCheckCircle, MdDownload, MdInsights,
} from 'react-icons/md'
import toast from 'react-hot-toast'

const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`

// CRMC program impact — synthesises the applications (slices) + requests into
// the outcome view the operational pages don't provide: how much assistance
// was facilitated, for how many patients, and how it breaks down.
export default function Analytics() {
  const [slices,   setSlices]   = useState(null)
  const [requests, setRequests] = useState([])
  const [loading,  setLoading]  = useState(true)

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

  const a = useMemo(() => computeAnalytics(slices ?? [], requests), [slices, requests])

  const exportSummary = () => {
    const rows = [
      ['MAPA — Program Impact Summary', ''],
      ['Generated', new Date().toLocaleString()],
      [''],
      ['Total assistance facilitated', a.totalFacilitated],
      ['Patients helped', a.patientsHelped],
      ['Guarantee Letters issued', a.glsIssued],
      ['Guarantee Letters redeemed', a.glsRedeemed],
      ['Fully-funded requests', a.requestsFullyFunded],
      ['Total requests', a.requestsTotal],
      ['Avg turnaround (days)', a.avgTurnaroundDays != null ? a.avgTurnaroundDays.toFixed(1) : ''],
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
    link.download = `mapa-impact-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const kpis = [
    { label: 'Assistance facilitated', value: peso(a.totalFacilitated), Icon: MdPayments,          tone: 'text-brand-600' },
    { label: 'Patients helped',        value: a.patientsHelped,          Icon: MdGroup,             tone: 'text-gray-900' },
    { label: 'Guarantee Letters issued', value: a.glsIssued, sub: `${a.glsRedeemed} redeemed`, Icon: MdWorkspacePremium, tone: 'text-gray-900' },
    { label: 'Requests fully funded',  value: a.requestsFullyFunded, sub: `of ${a.requestsTotal} total`, Icon: MdCheckCircle, tone: 'text-gray-900' },
  ]

  const hasData = (slices ?? []).length > 0 && a.totalFacilitated > 0

  return (
    <Layout breadcrumb="Analytics">
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <p className="eyebrow">Analytics</p>
            <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Program Impact</h1>
            <p className="text-sm text-gray-500 mt-1">
              Assistance facilitated across CRMC and partner agencies — the outcome view behind the operational queues.
            </p>
          </div>
          {hasData && (
            <button onClick={exportSummary} className="btn-secondary text-sm flex items-center gap-1.5 flex-shrink-0">
              <MdDownload size={16} /> Export summary
            </button>
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
            <p className="text-base font-semibold text-gray-800 mb-1">No facilitated assistance yet</p>
            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              Once agencies approve endorsed requests and Guarantee Letters are issued, the program impact figures and trends appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-6">

            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {kpis.map(k => (
                <div key={k.label} className="stat-tile">
                  <div className="flex items-center justify-between">
                    <k.Icon size={18} className="text-gray-300" />
                    {a.avgTurnaroundDays != null && k.label === 'Requests fully funded' && (
                      <span className="text-[11px] text-gray-400" title="Average agency decision time">
                        ~{a.avgTurnaroundDays.toFixed(1)}d avg
                      </span>
                    )}
                  </div>
                  <p className={`stat-num mt-2 ${k.tone}`}>{k.value}</p>
                  <p className="stat-label">{k.label}{k.sub ? ` · ${k.sub}` : ''}</p>
                </div>
              ))}
            </div>

            {/* Trend */}
            <div className="card p-5">
              <p className="eyebrow mb-1">Over time</p>
              <h2 className="text-base font-semibold text-gray-900 mb-4">Assistance facilitated per month</h2>
              <TrendArea data={a.byMonth} labelFor={(d) => formatMonth(d.key)} />
            </div>

            {/* Breakdowns */}
            <div className="grid md:grid-cols-2 gap-6">
              <div className="card p-5">
                <p className="eyebrow mb-1">Breakdown</p>
                <h2 className="text-base font-semibold text-gray-900 mb-4">By agency</h2>
                <BarList data={a.byAgency} />
              </div>
              <div className="card p-5">
                <p className="eyebrow mb-1">Breakdown</p>
                <h2 className="text-base font-semibold text-gray-900 mb-4">By assistance type</h2>
                <BarList data={a.byType} />
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
