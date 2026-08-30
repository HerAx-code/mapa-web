import { MdWarningAmber } from 'react-icons/md'

// Fund-capacity overview for the admin Agencies page (Magic Patterns adoption,
// remapped to MAPA). Aggregates every agency's budget (allocated / committed /
// disbursed) into a program-wide capacity read, and surfaces the agencies whose
// funds are nearly exhausted — a super-admin can step in before a fund runs dry
// and starts blocking Guarantee Letters. Read-only; renders nothing until at
// least one agency has an allocation.
const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0)

export default function AgencyCapacityOverview({ agencies = [] }) {
  const funded = agencies.filter(a => (Number(a.budget?.allocated) || 0) > 0)
  const allocated = funded.reduce((s, a) => s + (Number(a.budget?.allocated) || 0), 0)
  const committed = funded.reduce((s, a) => s + (Number(a.budget?.committed) || 0), 0)
  const disbursed = funded.reduce((s, a) => s + (Number(a.budget?.disbursed) || 0), 0)
  const remaining = Math.max(0, allocated - committed)
  const used = pct(committed, allocated)

  // Slots come from active agencies only — a disabled agency can't take a
  // patient today, so its residual slots shouldn't inflate the figure shown
  // beside the active-agency count.
  const active         = agencies.filter(a => a.enabled)
  const activeCount    = active.length
  const slotsRemaining = active.reduce((s, a) => s + (Number(a.slots?.remaining) || 0), 0)
  const slotsTotal     = active.reduce((s, a) => s + (Number(a.slots?.total) || 0), 0)

  // Near depletion: funded agencies ≥85% committed against their allocation.
  const atRisk = funded
    .map(a => ({ a, u: pct(Number(a.budget?.committed) || 0, Number(a.budget?.allocated) || 0) }))
    .filter(x => x.u >= 85)
    .sort((x, y) => y.u - x.u)

  if (allocated === 0) return null

  return (
    <div className="grid gap-4 lg:grid-cols-3 mb-5">
      {/* Capacity (2 cols) */}
      <div className="card p-5 lg:col-span-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Remaining fund capacity</p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-gray-900 tabular-nums">{peso(remaining)}</p>
            <p className="mt-1 text-sm text-gray-500">
              {peso(committed)} committed of {peso(allocated)} allocated · {peso(disbursed)} disbursed
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-2xl font-semibold text-gray-800 tabular-nums">{used}%</p>
            <p className="text-xs text-gray-400">committed</p>
          </div>
        </div>
        <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div className="h-full bg-brand-600" style={{ width: `${pct(disbursed, allocated)}%` }} title="Disbursed" />
          <div className="h-full bg-brand-300" style={{ width: `${pct(Math.max(0, committed - disbursed), allocated)}%` }} title="Committed, not yet disbursed" />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-600" /> Disbursed {peso(disbursed)}</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-300" /> Committed {peso(committed)}</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-gray-200" /> Available {peso(remaining)}</span>
        </div>
      </div>

      {/* Right: quick stats + near-depletion watchlist */}
      <div className="flex flex-col gap-4">
        <div className="card p-4 grid grid-cols-2 gap-3">
          <div>
            <p className="text-xl font-semibold text-gray-900 tabular-nums">{activeCount}</p>
            <p className="mt-0.5 text-xs text-gray-400">Active agencies</p>
          </div>
          <div className="border-l border-gray-100 pl-3">
            <p className="text-xl font-semibold text-gray-900 tabular-nums">{slotsRemaining}<span className="text-sm font-normal text-gray-400">/{slotsTotal}</span></p>
            <p className="mt-0.5 text-xs text-gray-400">Slots left today</p>
          </div>
        </div>
        <div className="card p-4 border-amber-200">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
            <MdWarningAmber size={14} /> Near depletion
          </p>
          {atRisk.length === 0 ? (
            <p className="mt-2 text-sm text-gray-400">No agency funds are running low.</p>
          ) : (
            <ul className="mt-2.5 space-y-1.5">
              {atRisk.slice(0, 3).map(({ a, u }) => (
                <li key={a.id} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-800">{a.name}</span>
                    <span className="block text-xs text-gray-400 tabular-nums">
                      {peso(Math.max(0, (Number(a.budget?.allocated) || 0) - (Number(a.budget?.committed) || 0)))} left
                    </span>
                  </span>
                  <span className={`text-sm font-semibold tabular-nums ${u >= 100 ? 'text-red-600' : 'text-amber-600'}`}>{u}%</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
