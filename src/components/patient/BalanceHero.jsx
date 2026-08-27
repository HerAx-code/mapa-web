import { MdArrowForward } from 'react-icons/md'
import StatusBadge from '../ui/StatusBadge'

// Shared dark-teal "balance" hero — the signature centrepiece for an active
// request, used on both the patient Dashboard and My Application (TrackStatus)
// so the two read as one flow. All figures come from computeFunding over the
// request's slices (committed + outstanding) against amountNeeded — the caller
// passes the computed `funding` object so this component stays presentational.
const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`

function HeroLegend({ swatch, label, value }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${swatch}`} aria-hidden="true" />
      <dt className="text-brand-200">{label}</dt>
      <dd className="font-semibold tabular-nums text-white">{value}</dd>
    </div>
  )
}

export default function BalanceHero({ request, funding, t, navigate }) {
  const need = Number(request.amountNeeded) || 0
  const { committed, outstanding, headroom, balance } = funding
  const pctOf = (v) => (need > 0 ? `${Math.min(100, (v / need) * 100)}%` : '0%')
  return (
    <div className="card-hero">
      <div className="p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-200">{t('patient.dashboard.hero.eyebrow')}</p>
            <h2 className="mt-2 text-sm font-medium text-brand-100">{t('patient.dashboard.hero.remainingLabel')}</h2>
            <p className="mt-1 text-4xl sm:text-5xl font-bold tracking-tight tabular-nums">{peso(balance)}</p>
            <p className="mt-2 text-sm text-brand-200">
              {t('patient.dashboard.hero.fromTotal', { total: peso(need), approved: peso(committed) })}
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end flex-shrink-0">
            <StatusBadge status={request.status} kind="request" />
            <span className="font-mono text-xs text-brand-200">{request.requestId}</span>
          </div>
        </div>

        <div className="mt-6">
          <div className="flex h-3 w-full gap-1 overflow-hidden rounded-full bg-white/10">
            {committed   > 0 && <div className="bg-brand-300 rounded-full"    style={{ width: pctOf(committed) }} />}
            {outstanding > 0 && <div className="bg-brand-300/50 rounded-full" style={{ width: pctOf(outstanding) }} />}
          </div>
          <dl className="mt-3.5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <HeroLegend swatch="bg-brand-300"    label={t('patient.dashboard.hero.approved')} value={peso(committed)} />
            <HeroLegend swatch="bg-brand-300/50" label={t('patient.dashboard.hero.inReview')} value={peso(outstanding)} />
            <HeroLegend swatch="bg-white/25"     label={t('patient.dashboard.hero.unfunded')} value={peso(headroom)} />
          </dl>
        </div>

        <button onClick={() => navigate('/patient/status')}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-brand-800 hover:bg-brand-50 transition-colors">
          {t('patient.nav.myApplication')} <MdArrowForward size={16} />
        </button>
      </div>
    </div>
  )
}
