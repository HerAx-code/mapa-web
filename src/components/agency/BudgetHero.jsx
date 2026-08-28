// Dark "funding capacity" hero for the agency workspace — the staff parallel
// to the patient BalanceHero. Reads agency.budget only (allocated / committed /
// disbursed); never writes. Renders nothing when no budget is allocated.
const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`

const PERIOD_ADJ = { monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual', weekly: 'Weekly' }

function Legend({ swatch, label, value }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${swatch}`} aria-hidden="true" />
      <dt className="text-brand-200">{label}</dt>
      <dd className="font-semibold tabular-nums text-white">{value}</dd>
    </div>
  )
}

export default function BudgetHero({ agency }) {
  const budget    = agency?.budget ?? {}
  const allocated = Number(budget.allocated) || 0
  if (allocated <= 0) return null

  const committed = Number(budget.committed) || 0
  const disbursed = Number(budget.disbursed) || 0
  const remaining = Math.max(0, allocated - committed)
  const util      = Math.round((committed / allocated) * 100)
  const period    = PERIOD_ADJ[budget.period] ?? 'Period'

  // Utilisation pill + bar tone: green under 70%, amber 70–89%, red 90%+.
  const pillTone = util >= 90 ? 'bg-red-500/25 text-red-100 ring-red-300/40'
                 : util >= 70 ? 'bg-amber-400/25 text-amber-50 ring-amber-200/40'
                 : 'bg-white/10 text-brand-100 ring-white/20'
  const barTone  = util >= 90 ? 'bg-red-400' : util >= 70 ? 'bg-amber-300' : 'bg-brand-300'

  return (
    <div className="card-hero mb-5">
      <div className="p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-200">{period} budget</p>
            <h2 className="mt-2 text-sm font-medium text-brand-100">Remaining to commit</h2>
            <p className="mt-1 text-4xl sm:text-5xl font-bold tracking-tight tabular-nums">{peso(remaining)}</p>
            <p className="mt-2 text-sm text-brand-200">of {peso(allocated)} allocated · {peso(committed)} committed</p>
          </div>
          <span className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${pillTone}`}>{util}% used</span>
        </div>

        <div className="mt-6">
          <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
            <div className={`h-full rounded-full ${barTone} transition-all`} style={{ width: `${Math.min(100, util)}%` }} />
          </div>
          <dl className="mt-3.5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Legend swatch="bg-brand-300"    label="Committed" value={peso(committed)} />
            <Legend swatch="bg-brand-300/60" label="Disbursed" value={peso(disbursed)} />
            <Legend swatch="bg-white/25"     label="Remaining" value={peso(remaining)} />
          </dl>
        </div>

        {budget.fundSource && (
          <p className="mt-4 text-xs text-brand-200">Source: <span className="font-medium text-brand-100">{budget.fundSource}</span></p>
        )}
      </div>
    </div>
  )
}
