import { MdInsights, MdAutoAwesome, MdCheckCircle, MdTrendingDown } from 'react-icons/md'
import { MEANS_CATEGORIES, POVERTY_LINE_PER_CAPITA, meansTestSuggestion } from '../utils/intakeSheet'

// Decision-support panel for the Unified Intake Sheet's side rail: turns the
// raw income / household / expenses the social worker enters into an
// at-a-glance financial picture, plus an ADVISORY means-test suggestion. The
// social worker always confirms the category (manual by design) — this only
// computes income ÷ household size vs the poverty line and offers it.
//
// Layout follows the Magic Patterns "Financial snapshot" study: a sectioned
// card that reads top-to-bottom as two meters (income-vs-poverty-line, then
// expenses-vs-income) and the advisory category. Both meters carry the signal
// a raw ratio can't — a household several times underwater yields a percentage
// in the hundreds of thousands, which reads as broken and helps no one; the
// useful facts are how far under the line they sit and the peso shortfall.

const peso = (n) => `₱${Math.round(Number(n) || 0).toLocaleString()}`
const shortLabel = (cat) => (MEANS_CATEGORIES.find(c => c.value === cat)?.label ?? cat).split('—')[0].trim()

export default function AssessmentSnapshot({ sheet, showMeansTest = true, canEdit = false, onApplyMeansTest }) {
  const income = Number(sheet?.monthlyIncome) || 0
  const totalExpenses = Object.values(sheet?.expenses ?? {}).reduce((s, v) => s + (Number(v) || 0), 0)
  const suggestion = meansTestSuggestion({ monthlyIncome: sheet?.monthlyIncome, householdSize: sheet?.householdSize })
  // Reuse the suggestion's per-capita (single source of truth; null when income
  // or household size is blank, so an unfilled income isn't shown as ₱0).
  const perCapita = suggestion?.perCapita ?? null

  // Income vs poverty line.
  const povertyRatio = perCapita != null ? Math.min(perCapita / POVERTY_LINE_PER_CAPITA, 1) : null
  const belowLine    = suggestion != null && suggestion.ratio < 1
  const gapPct       = belowLine ? Math.round((1 - suggestion.ratio) * 100) : 0

  // Expenses vs income — both bars share a scale so the income marker sits in
  // the right place even when expenses dwarf income.
  const shortfall  = totalExpenses - income
  const overBudget = income > 0 && shortfall > 0
  const scale      = Math.max(income, totalExpenses, 1)
  const current    = sheet?.meansTestCategory

  // Nothing meaningful until at least income+size or some expenses exist.
  if (perCapita == null && totalExpenses === 0) return null

  return (
    <div className="card overflow-hidden p-0">
      <div className="flex items-baseline justify-between border-b border-gray-100 px-4 py-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-gray-400">
          <MdInsights size={13} /> Financial snapshot
        </p>
        <span className="text-[11px] font-medium text-gray-300">Auto-computed</span>
      </div>

      {/* Income per person vs the poverty line */}
      {perCapita != null && (
        <div className="px-4 py-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Income per person</p>
          <div className="mt-1 flex items-end gap-1.5">
            <p className="text-2xl font-semibold leading-none text-gray-900 tabular-nums">{peso(perCapita)}</p>
            <p className="pb-0.5 text-xs text-gray-400">/ month</p>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div className={`h-full rounded-full ${belowLine ? 'bg-red-500' : 'bg-brand-500'}`}
              style={{ width: `${Math.max(povertyRatio * 100, 4)}%` }} />
          </div>
          <p className="mt-2 text-xs text-gray-400 tabular-nums">Poverty line {peso(POVERTY_LINE_PER_CAPITA)} per person</p>
          {belowLine && (
            <p className="mt-3 inline-flex items-center rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-100 tabular-nums">
              Below poverty line — {gapPct}% under
            </p>
          )}
        </div>
      )}

      {/* Expenses vs income */}
      {(income > 0 || totalExpenses > 0) && (
        <div className="border-t border-gray-100 px-4 py-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Expenses vs income</p>
          <dl className="mt-2.5 space-y-1.5">
            <div className="flex items-baseline justify-between text-xs">
              <dt className="text-gray-500">Household income</dt>
              <dd className="font-medium text-gray-900 tabular-nums">{peso(income)}</dd>
            </div>
            <div className="flex items-baseline justify-between text-xs">
              <dt className="text-gray-500">Monthly expenses</dt>
              <dd className={`font-medium tabular-nums ${overBudget ? 'text-red-700' : 'text-gray-900'}`}>{peso(totalExpenses)}</dd>
            </div>
          </dl>
          <div className="relative mt-3 h-1.5 w-full rounded-full bg-gray-100">
            <div className={`h-full rounded-full ${overBudget ? 'bg-red-500' : 'bg-brand-500'}`}
              style={{ width: `${(totalExpenses / scale) * 100}%` }} />
            {income > 0 && (
              <div className="absolute -top-1 h-3.5 w-px bg-gray-400"
                style={{ left: `${(income / scale) * 100}%` }} aria-hidden="true" />
            )}
          </div>
          <p className="mt-2 text-[11px] text-gray-400">
            {income > 0 ? 'Marker shows income level' : 'No monthly income recorded'}
          </p>
          {overBudget && (
            <p className="mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-red-700 tabular-nums">
              <MdTrendingDown size={16} className="flex-shrink-0" />
              {peso(shortfall)} monthly shortfall
            </p>
          )}
        </div>
      )}

      {/* Advisory means-test category */}
      {showMeansTest && suggestion && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Suggested means-test</p>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-gray-900">{shortLabel(suggestion.category)}</span>
            {/* Floor to a tenth so the displayed multiple never rounds up across
                a band boundary (e.g. 0.96 shows 0.9×, not 1.0×, beside Indigent). */}
            <span className="tabular-nums text-xs text-gray-400">{(Math.floor(suggestion.ratio * 10) / 10).toFixed(1)}× line</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-gray-400">Advisory only — from income ÷ household size. You confirm the category.</p>
          {canEdit && current !== suggestion.category && (
            <button type="button" onClick={() => onApplyMeansTest?.(suggestion.category)}
              className="mt-3 inline-flex h-9 items-center gap-1 rounded-md border border-brand-200 bg-white px-3 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50">
              <MdAutoAwesome size={13} /> Use suggestion
            </button>
          )}
          {current === suggestion.category && (
            <p className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-green-600">
              <MdCheckCircle size={12} /> Matches your selection
            </p>
          )}
        </div>
      )}
    </div>
  )
}
