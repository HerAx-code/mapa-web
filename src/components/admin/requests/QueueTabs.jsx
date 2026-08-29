import { QUEUE_TABS, BUCKET_LABELS } from '../../../utils/queueBuckets'

// The request-queue categorization tabs (redesign Phase 2). Presentational —
// the container owns the active bucket + counts. Buckets come from the shared
// queueBuckets / requestStage model, so the tabs stay in lock-step with the
// per-row stage chip and the detail's endorse blockers.
export default function QueueTabs({ active, counts, onChange }) {
  return (
    <div role="tablist" aria-label="Request queues" className="flex gap-1 overflow-x-auto">
      {QUEUE_TABS.map(key => {
        const selected = key === active
        return (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(key)}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
              selected
                ? 'bg-brand-500 text-white border-brand-500'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}>
            {BUCKET_LABELS[key]}
            <span className={`tabular-nums text-xs font-semibold rounded px-1.5 ${
              selected ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
            }`}>
              {counts[key] ?? 0}
            </span>
          </button>
        )
      })}
    </div>
  )
}
