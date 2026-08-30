import { MdInsights, MdAutoAwesome, MdCheckCircle } from 'react-icons/md'
import { MEANS_CATEGORIES, meansTestSuggestion } from '../utils/intakeSheet'

// Decision-support panel for the Unified Intake Sheet's side rail: turns the
// raw income / household / expenses the social worker enters into an
// at-a-glance financial picture, plus an ADVISORY means-test suggestion. The
// social worker always confirms the category (manual by design) — this only
// computes income ÷ household size vs the poverty line and offers it.

const peso = (n) => `₱${Math.round(Number(n) || 0).toLocaleString()}`
const shortLabel = (cat) => (MEANS_CATEGORIES.find(c => c.value === cat)?.label ?? cat).split('—')[0].trim()

export default function AssessmentSnapshot({ sheet, showMeansTest = true, canEdit = false, onApplyMeansTest }) {
  const income = Number(sheet?.monthlyIncome) || 0
  const size   = Number(sheet?.householdSize) || 0
  const totalExpenses = Object.values(sheet?.expenses ?? {}).reduce((s, v) => s + (Number(v) || 0), 0)
  const perCapita = size > 0 ? income / size : null
  const expRatio  = income > 0 ? Math.round((totalExpenses / income) * 100) : null
  const suggestion = meansTestSuggestion({ monthlyIncome: sheet?.monthlyIncome, householdSize: sheet?.householdSize })
  const current = sheet?.meansTestCategory

  // Nothing meaningful until at least income+size or some expenses exist.
  if (perCapita == null && totalExpenses === 0) return null

  return (
    <div className="card p-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
        <MdInsights size={13} /> Financial snapshot
      </p>

      <dl className="space-y-2 text-sm">
        {perCapita != null && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-gray-500">Income / person</dt>
            <dd className="tabular-nums font-medium text-gray-800">{peso(perCapita)}<span className="text-xs text-gray-400"> /mo</span></dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <dt className="text-gray-500">Expenses / income</dt>
          <dd className={`tabular-nums font-medium ${expRatio != null && expRatio > 100 ? 'text-red-600' : 'text-gray-800'}`}>
            {expRatio != null ? `${expRatio}%` : '—'}
          </dd>
        </div>
      </dl>

      {showMeansTest && suggestion && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-400 mb-1">Suggested means-test</p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-800">{shortLabel(suggestion.category)}</span>
            <span className="tabular-nums text-xs text-gray-400">{suggestion.ratio.toFixed(1)}× line</span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-gray-400">
            Advisory — from income ÷ household size. You confirm the category.
          </p>
          {canEdit && current !== suggestion.category && (
            <button type="button" onClick={() => onApplyMeansTest?.(suggestion.category)}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              <MdAutoAwesome size={13} /> Use suggestion
            </button>
          )}
          {current === suggestion.category && (
            <p className="mt-2 inline-flex items-center gap-1 text-xs text-green-600">
              <MdCheckCircle size={12} /> Matches your selection
            </p>
          )}
        </div>
      )}
    </div>
  )
}
