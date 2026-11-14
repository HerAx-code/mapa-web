import { useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { MdInsights } from 'react-icons/md'
import Layout from '../../components/Layout'
import { db } from '../../firebase'
import { useHospitals } from '../../hooks/useHospitals'
import { tsToDate } from '../../utils/dates'

// Network overview — multi-hospital Phase 9 (docs/multi-hospital-network-plan.md).
// Per-hospital counts from networkStats/current, a summary the Admin SDK builds
// (scheduled function refreshNetworkStats, or scripts/compute-network-stats.mjs)
// because the platform admin may not read the patient records being counted.
// Numbers only — no names, no case ids.

const peso = (n) => `₱${Math.round(Number(n) || 0).toLocaleString('en-PH')}`
const COLUMNS = [
  { key: 'patients',           label: 'Patients',       get: (s) => s.patients },
  { key: 'inReview',           label: 'In review',      get: (s) => s.requests?.inReview },
  { key: 'inFunding',          label: 'In funding',     get: (s) => s.requests?.inFunding },
  { key: 'funded',             label: 'Fully funded',   get: (s) => s.requests?.funded },
  { key: 'closed',             label: 'Closed',         get: (s) => s.requests?.closed },
  { key: 'approvedSlices',     label: 'Approved GLs',   get: (s) => s.approvedSlices },
  { key: 'amountApproved',     label: 'Amount approved', get: (s) => peso(s.amountApproved), money: true },
]

export default function Network() {
  const { hospitals } = useHospitals()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => onSnapshot(doc(db, 'networkStats', 'current'),
    (snap) => { setStats(snap.exists() ? snap.data() : null); setLoading(false) },
    (err) => { console.error('[Network] stats snapshot error:', err); setLoading(false) },
  ), [])

  const rows = useMemo(() => hospitals.map((h) => ({
    id: h.id, name: h.facilityName || h.id, stats: stats?.hospitals?.[h.id] ?? null,
  })), [hospitals, stats])

  const updated = tsToDate(stats?.generatedAt)

  return (
    <Layout breadcrumb="Network">
      <div className="w-full p-4 sm:p-6 max-w-[1200px] mx-auto">
        <div className="mb-5">
          <p className="eyebrow">Network</p>
          <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Network overview</h1>
          <p className="text-sm text-gray-500 mt-1">
            How each hospital's gateway is doing. Counts only — patient records stay with each hospital.
          </p>
        </div>

        {loading ? (
          <div className="card p-8 flex justify-center">
            <div className="w-8 h-8 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
          </div>
        ) : !stats ? (
          <div className="card p-8 text-center">
            <MdInsights size={28} className="mx-auto text-gray-300" />
            <p className="text-sm font-medium text-gray-700 mt-2">No figures yet</p>
            <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
              They refresh every 6 hours once Cloud Functions are deployed. Until then, run
              scripts/compute-network-stats.mjs --apply.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              {[
                ['Patients', stats.totals?.patients ?? 0],
                ['Requests in progress', (stats.totals?.requests?.inReview ?? 0) + (stats.totals?.requests?.inFunding ?? 0)],
                ['Approved GLs', stats.totals?.approvedSlices ?? 0],
                ['Amount approved', peso(stats.totals?.amountApproved)],
              ].map(([label, value]) => (
                <div key={label} className="card p-4">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="text-xl font-semibold text-gray-900 mt-1 tabular-nums">{value}</p>
                </div>
              ))}
            </div>

            <div className="card overflow-x-auto">
              <table className="data-table min-w-full">
                <thead>
                  <tr>
                    <th>Hospital</th>
                    {COLUMNS.map((c) => <th key={c.key} className="text-right">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium text-gray-800">{r.name}</td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="text-right tabular-nums">
                          {r.stats ? (c.get(r.stats) ?? 0) : <span className="text-gray-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 mt-3">
              {updated ? `Updated ${updated.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}. ` : ''}
              A hospital added since then shows "—" until the next refresh. Records from before the tenancy backfill aren't counted.
            </p>
          </>
        )}
      </div>
    </Layout>
  )
}
