import { COARSE_TABS, COARSE_LABELS } from '../../../utils/queueBuckets'

// The request-queue categorization tabs (Magic Patterns adoption). The
// top-level tabs are the coarse action-oriented set (Needs action / Under
// review / Awaiting agency / Resolved / All); each row still shows its fine
// stage chip. Presentational — the container owns the active tab + counts.
export default function QueueTabs({ active, counts, onChange }) {
  return (
    <div role="tablist" aria-label="Request queues" className="flex flex-wrap items-center gap-1">
      {COARSE_TABS.map(key => {
        const selected = key === active
        return (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(key)}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
              selected
                ? 'bg-brand-700 font-semibold text-white'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}>
            {COARSE_LABELS[key]}
            <span className={`tabular-nums rounded px-1.5 text-xs font-semibold ${
              selected ? 'bg-white/20 text-white' : 'bg-gray-200/70 text-gray-600'
            }`}>
              {counts[key] ?? 0}
            </span>
          </button>
        )
      })}
    </div>
  )
}
