import { MdInsights, MdAutoAwesome, MdCheckCircle, MdTrendingDown } from 'react-icons/md'
import {
  meansCategoryLabel, sheetSuggestion, povertyBasis, billIncomeMonths, maifipCatastrophic, shortfallLabel,
} from '../utils/intakeSheet'

// AO 2021-0044 band edges, as multiples of the poverty line, drawn as ticks
// on the income bar (the bar spans 0 to 2.5× the line).
const BAND_TICKS = [1.4, 1.8, 2.2]
const BAR_MAX = 2.5

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
const shortLabel = meansCategoryLabel

// settings: the hospital's hospitalSettings (poverty line), used when the
// sheet has no stored basis yet.
export default function AssessmentSnapshot({ sheet, bill, settings = null, showMeansTest = true, canEdit = false, onApplyMeansTest }) {
  const billMonths = billIncomeMonths({ bill, monthlyIncome: sheet?.monthlyIncome })
  const maifip = maifipCatastrophic({ bill, monthlyIncome: sheet?.monthlyIncome })
  const income = Number(sheet?.monthlyIncome) || 0
  const totalExpenses = Object.values(sheet?.expenses ?? {}).reduce((s, v) => s + (Number(v) || 0), 0)
  const basis = povertyBasis(sheet, settings)
  const suggestion = sheetSuggestion(sheet, settings)
  const size = Number(sheet?.householdSize)
  const perCapita = sheet?.monthlyIncome !== '' && sheet?.monthlyIncome != null && size > 0
    ? (Number(sheet.monthlyIncome) || 0) / size : null
  const ratio = perCapita != null && basis ? perCapita / basis.povertyLine : null

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
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-gray-500">
          <MdInsights size={13} /> Financial snapshot
        </p>
        <span className="text-[11px] font-medium text-gray-300">Auto-computed</span>
      </div>

      {/* Income per person vs the poverty line */}
      {perCapita != null && (
        <div className="px-4 py-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Income per person</p>
          <div className="mt-1 flex items-end gap-1.5">
            <p className="text-2xl font-semibold leading-none text-gray-900 tabular-nums">{peso(perCapita)}</p>
            <p className="pb-0.5 text-xs text-gray-500">/ month</p>
          </div>
          {ratio != null ? (
            <>
              {/* Ticks at 140 / 180 / 220% of the line: the AO 2021-0044 bands. */}
              <div className="relative mt-3 h-1.5 w-full rounded-full bg-gray-100">
                <div className={`h-full rounded-full ${ratio < 1.4 ? 'bg-red-500' : 'bg-brand-500'}`}
                  style={{ width: `${Math.max(Math.min(ratio / BAR_MAX, 1) * 100, 4)}%` }} />
                {BAND_TICKS.map(t => (
                  <div key={t} className="absolute -top-1 h-3.5 w-px bg-gray-400" style={{ left: `${(t / BAR_MAX) * 100}%` }} aria-hidden="true" />
                ))}
              </div>
              <div className="relative mt-1 h-3 text-[10px] text-gray-500 tabular-nums" aria-hidden="true">
                {BAND_TICKS.map(t => (
                  <span key={t} className="absolute -translate-x-1/2" style={{ left: `${(t / BAR_MAX) * 100}%` }}>{Math.round(t * 100)}%</span>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500 tabular-nums">
                {Math.round(ratio * 100)}% of the poverty line ({peso(basis.povertyLine)}/person{basis.region || basis.year ? ` · ${[basis.region, basis.year].filter(Boolean).join(' ')}` : ''})
              </p>
              {basis.citationShort && <p className="mt-1 text-[11px] text-gray-500">Source: {basis.citationShort}</p>}
              {basis.status === 'interim' && (
                <p className="mt-1 text-[11px] text-amber-700">Interim figure — a newer PSA release exists.</p>
              )}
            </>
          ) : (
            <p className="mt-2 text-xs text-amber-700">Poverty line not set — ask your Hospital Admin (Hospital Settings).</p>
          )}
        </div>
      )}

      {/* Expenses vs income */}
      {(income > 0 || totalExpenses > 0) && (
        <div className="border-t border-gray-100 px-4 py-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Expenses vs income</p>
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
          <p className="mt-2 text-[11px] text-gray-500">
            {income > 0 ? 'Marker shows income level' : 'No monthly income recorded'}
          </p>
          {overBudget && (
            <p className="mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-red-700 tabular-nums">
              <MdTrendingDown size={16} className="flex-shrink-0" />
              {peso(shortfall)} monthly shortfall
            </p>
          )}
          {overBudget && (
            <p className="mt-1.5 text-xs text-gray-600 leading-snug">
              {(sheet?.shortfallCoverage ?? []).length
                ? <>Covered by: <strong className="text-gray-800">
                    {sheet.shortfallCoverage.filter(v => v !== 'other').map(shortfallLabel)
                      .concat(sheet.shortfallCoverage.includes('other') && sheet.shortfallCoverageOther?.trim() ? [sheet.shortfallCoverageOther.trim()] : [])
                      .join(', ')}
                  </strong></>
                : <span className="italic">Patient hasn't said how the shortfall is covered — ask during the assessment.</span>}
            </p>
          )}
        </div>
      )}

      {/* Bill vs income — financial incapacity even above the poverty line */}
      {billMonths && (
        <div className="border-t border-gray-100 px-4 py-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Bill vs income</p>
          <div className="mt-1 flex items-end gap-1.5">
            <p className="text-2xl font-semibold leading-none text-gray-900 tabular-nums">
              {Number.isFinite(billMonths.months) ? (Math.round(billMonths.months * 10) / 10).toLocaleString() : '—'}
            </p>
            <p className="pb-0.5 text-xs text-gray-500">
              {Number.isFinite(billMonths.months) ? 'months of household income' : 'no household income'}
            </p>
          </div>
          <p className="mt-2 text-xs text-gray-500 tabular-nums">Amount needed {peso(bill)}</p>
          {maifip && (
            <p className="mt-3 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-100 leading-snug">
              Over 10% of a year&apos;s household income — may qualify for MAIFIP as financially incapacitated (catastrophic spending, DOH AO 2026-0031).
            </p>
          )}
        </div>
      )}

      {/* Advisory means-test category */}
      {showMeansTest && suggestion && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Suggested means-test</p>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-gray-900">{shortLabel(suggestion.category)}</span>
            {/* Floor to a whole percent so the figure never rounds across a band edge. */}
            {suggestion.ratio != null && (
              <span className="tabular-nums text-xs text-gray-500">{Math.floor(suggestion.ratio * 100)}% of line</span>
            )}
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-gray-500">
            {suggestion.via4Ps
              ? 'Advisory only — 4Ps member (Pantawid ID seen). You confirm the category.'
              : 'Advisory only — from income ÷ household size (DOH AO 2021-0044). You confirm the category.'}
          </p>
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
