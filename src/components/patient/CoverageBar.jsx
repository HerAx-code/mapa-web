import { useTranslation } from 'react-i18next'
import { computeFunding } from '../../utils/requests'
import { peso } from '../../utils/format'

// Per-agency "path to zero balance" — makes co-funding (many agencies, one
// bill) legible at a glance for a low-literacy patient (benchmark F). Mirrors
// the admin PathToZeroBalance: one bar to amountNeeded, segmented per slice
// (committed solid, in-review hatched), then a plain per-agency list. All
// figures come from computeFunding over the request's slices — no extra query.
const COMMITTED = ['approved', 'certificate']
const IN_REVIEW = ['endorsed', 'reviewing', 'awaiting_info']

export default function CoverageBar({ request, slices = [] }) {
  const { t } = useTranslation()
  const need = Number(request?.amountNeeded) || 0
  if (need <= 0 || slices.length === 0) return null

  const { committed, outstanding, balance } = computeFunding(need, slices)
  const pct = (v) => (need > 0 ? `${Math.min(100, (v / need) * 100)}%` : '0%')
  const agencyCount = new Set(slices.map((s) => s.agencyId)).size

  return (
    <div className="card p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">
        {t('patient.dashboard.coverageBar.title', { total: peso(need) })}
      </h3>

      {/* Stacked bar: each slice a segment (committed solid / in-review hatched) */}
      <div className="flex h-3.5 w-full gap-1 overflow-hidden rounded-full bg-gray-100">
        {slices.map((s) => {
          const secured = COMMITTED.includes(s.status)
          const inReview = IN_REVIEW.includes(s.status)
          if (!secured && !inReview) return null
          const amt = secured ? (Number(s.amountApproved) || 0) : (Number(s.amountRequested) || 0)
          if (amt <= 0) return null
          return (
            <div
              key={s.id}
              className={`${s.agencyColor ?? 'bg-brand-400'} rounded-full ${inReview ? 'opacity-50' : ''}`}
              style={{ width: pct(amt) }}
              title={`${s.agencyName} · ${peso(amt)}`}
            />
          )
        })}
      </div>

      <p className="mt-2 text-xs text-gray-500">
        {t('patient.dashboard.coverageBar.summary', {
          approved: peso(committed), review: peso(outstanding),
        })}{' '}
        · <span className="font-semibold text-gray-700">{t('patient.dashboard.coverageBar.toGo', { amount: peso(balance) })}</span>
        {' '}· {t('patient.dashboard.coverageBar.agencies', { count: agencyCount })}
      </p>

      {/* Per-agency rows */}
      <div className="mt-3 space-y-2">
        {slices.map((s) => {
          const secured = COMMITTED.includes(s.status)
          const amt = secured ? (Number(s.amountApproved) || s.amountRequested) : s.amountRequested
          const chip = secured
            ? { cls: 'badge-green', label: t('patient.dashboard.coverageBar.approved') }
            : { cls: 'badge-amber', label: t('patient.dashboard.coverageBar.forFunding') }
          return (
            <div key={s.id} className="flex items-center gap-2.5">
              <span className={`h-6 w-6 flex-shrink-0 rounded-lg ${s.agencyColor ?? 'bg-gray-400'} text-white text-[10px] font-bold flex items-center justify-center`}>
                {s.agencyInitials}
              </span>
              <span className="flex-1 min-w-0 truncate text-sm text-gray-700">{s.agencyName}</span>
              <span className="text-sm tabular-nums text-gray-800">{peso(Number(amt) || 0)}</span>
              <span className={`badge ${chip.cls} text-xs flex-shrink-0`}>{chip.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
