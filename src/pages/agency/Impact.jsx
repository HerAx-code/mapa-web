import { useState, useEffect, useMemo } from 'react'
import Layout from '../../components/Layout'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { computeAnalytics, formatMonth } from '../../utils/analytics'
import BarList from '../../components/charts/BarList'
import TrendArea from '../../components/charts/TrendArea'
import {
  MdPayments, MdGroup, MdWorkspacePremium, MdDownload, MdInsights,
} from 'react-icons/md'
import toast from 'react-hot-toast'

const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`

// Agency-scoped impact: the outcome view for this agency's own funding —
// how much it disbursed, to how many patients, by assistance type, over time.
// Complements the Funds page (which shows the live budget gauge).
export default function AgencyImpact() {
  const { user }  = useAuth()
  const [slices,  setSlices]  = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.agencyId) return
    let alive = true
    ;(async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'applications'),
          where('agencyId', '==', user.agencyId),
        ))
        if (!alive) return
        setSlices(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (err) {
        console.error('[AgencyImpact] load failed:', err)
        toast.error('Failed to load impact data. Please refresh the page.')
        setSlices([])
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [user?.agencyId])

  const a = useMemo(() => computeAnalytics(slices ?? []), [slices])

  const exportSummary = () => {
    const rows = [
      ['MAPA — Agency Impact Summary', ''],
      ['Agency', user?.agencyName ?? ''],
      ['Generated', new Date().toLocaleString()],
      [''],
      ['Assistance disbursed', a.totalFacilitated],
      ['Patients funded', a.patientsHelped],
      ['Guarantee Letters issued', a.glsIssued],
      ['Guarantee Letters redeemed', a.glsRedeemed],
      ['Avg turnaround (days)', a.avgTurnaroundDays != null ? a.avgTurnaroundDays.toFixed(1) : ''],
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
    link.download = `mapa-agency-impact-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const kpis = [
    { label: 'Assistance disbursed',  value: peso(a.totalFacilitated), Icon: MdPayments,         tone: 'text-brand-600' },
    { label: 'Patients funded',       value: a.patientsHelped,          Icon: MdGroup,            tone: 'text-gray-900' },
    { label: 'Guarantee Letters',     value: a.glsIssued, sub: `${a.glsRedeemed} redeemed`, Icon: MdWorkspacePremium, tone: 'text-gray-900' },
  ]

  const hasData = (slices ?? []).length > 0 && a.totalFacilitated > 0

  return (
    <Layout breadcrumb="Impact">
      <div className="w-full p-4 sm:p-6 max-w-6xl mx-auto">

        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <p className="eyebrow">Impact</p>
            <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Your Funding Impact</h1>
            <p className="text-sm text-gray-500 mt-1">
              What your agency has disbursed — patients funded, by assistance type, over time.
            </p>
          </div>
          {hasData && (
            <button onClick={exportSummary} className="btn-secondary text-sm flex items-center gap-1.5 flex-shrink-0">
              <MdDownload size={16} /> Export summary
            </button>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="stat-tile animate-pulse"><div className="h-8 bg-gray-100 rounded w-24" /><div className="h-3 bg-gray-100 rounded w-16 mt-3" /></div>
            ))}
          </div>
        ) : !hasData ? (
          <div className="card p-10 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-brand-50 flex items-center justify-center">
              <MdInsights size={30} className="text-brand-400" />
            </div>
            <p className="text-base font-semibold text-gray-800 mb-1">No disbursements yet</p>
            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              Once you approve endorsed applications and issue Guarantee Letters, your funding impact appears here.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {kpis.map(k => (
                <div key={k.label} className="stat-tile">
                  <k.Icon size={18} className="text-gray-300" />
                  <p className={`stat-num mt-2 ${k.tone}`}>{k.value}</p>
                  <p className="stat-label">{k.label}{k.sub ? ` · ${k.sub}` : ''}</p>
                </div>
              ))}
            </div>

            {a.avgTurnaroundDays != null && (
              <p className="text-xs text-gray-500">
                Average decision time: <strong className="text-gray-700">{a.avgTurnaroundDays.toFixed(1)} days</strong> from endorsement to approval.
              </p>
            )}

            <div className="card p-5">
              <p className="eyebrow mb-1">Over time</p>
              <h2 className="text-base font-semibold text-gray-900 mb-4">Assistance disbursed per month</h2>
              <TrendArea data={a.byMonth} labelFor={(d) => formatMonth(d.key)} />
            </div>

            <div className="card p-5">
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
