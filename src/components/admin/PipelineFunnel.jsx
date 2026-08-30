// Request pipeline distribution for the admin dashboard (Magic Patterns
// "where requests slow down" adoption, remapped to MAPA). Shows how the active
// CRMC requests are distributed across the lifecycle stages, so an operator
// sees at a glance where the workload is piling up. Presentational — the
// container passes the already-counted stages. Live figures, no new data model.
export default function PipelineFunnel({ stages = [], onOpenQueue }) {
  const total = stages.reduce((n, s) => n + s.count, 0)
  const max = Math.max(1, ...stages.map(s => s.count))

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Request pipeline</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Active requests by stage · <span className="tabular-nums font-medium text-gray-700">{total}</span> open
          </p>
        </div>
        {onOpenQueue && (
          <button onClick={onOpenQueue} className="text-xs font-medium text-brand-500 hover:text-brand-600 flex-shrink-0">
            Open queue →
          </button>
        )}
      </div>

      {total === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">No active requests in the pipeline.</p>
      ) : (
        <ol className="space-y-3">
          {stages.map((s, i) => (
            <li key={s.key}>
              <div className="flex items-baseline gap-3">
                <span className="text-sm font-medium text-gray-700">{s.label}</span>
                <span className="ml-auto text-sm font-semibold tabular-nums text-gray-900">{s.count}</span>
              </div>
              <div className="mt-1.5 h-2.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${i === 0 ? 'bg-brand-700' : 'bg-brand-500'}`}
                  style={{ width: `${Math.round((s.count / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
