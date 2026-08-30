import { MdCheck, MdLock } from 'react-icons/md'

// Horizontal stage rail for the CRMC request workspace (redesign Phase 1).
// Renders the verify → assess → interview → endorse progression from the
// requestStage model, so an operator sees at a glance where a request is and
// which step is current. Presentational — takes the already-derived `stage`
// (from deriveRequestStage); terminal requests show no rail.
export default function RequestStageRail({ stage }) {
  if (!stage || stage.terminal) return null
  const { stages } = stage

  return (
    // `isolate` contains the circles' z-10 in this card's own stacking context
    // so they never paint over sticky chrome (e.g. the detail sub-header).
    <div className="card p-4 sm:p-5 isolate">
      <div className="flex items-start" role="list" aria-label="Processing stages">
        {stages.map((s, i) => (
          <div key={s.key} role="listitem" className="relative flex flex-1 flex-col items-center min-w-0">
            {/* Connector into this node — brand once the previous stage is done. */}
            {i > 0 && (
              <span aria-hidden="true"
                className={`absolute top-3.5 -left-1/2 h-0.5 w-full -translate-y-1/2 ${
                  stages[i - 1].done ? 'bg-brand-400' : 'bg-gray-200'
                }`} />
            )}
            <span className={`relative z-10 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              s.status === 'done'     ? 'bg-brand-500 text-white'
              : s.status === 'current' ? 'bg-brand-500 text-white ring-4 ring-brand-100'
              : 'bg-gray-100 text-gray-400'
            }`}>
              {s.status === 'done' ? <MdCheck size={15} aria-label="done" />
                : s.status === 'blocked' ? <MdLock size={13} aria-label="blocked" />
                : i + 1}
            </span>
            <p className={`mt-1.5 text-center text-xs font-semibold leading-tight ${
              s.status === 'current' ? 'text-brand-700'
              : s.status === 'done'  ? 'text-gray-800'
              : 'text-gray-400'
            }`}>{s.label}</p>
            <p className="mt-0.5 max-w-full truncate text-center text-[11px] text-gray-400">{s.detail}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
