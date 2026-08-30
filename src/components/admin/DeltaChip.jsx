import { MdArrowUpward, MdArrowDownward } from 'react-icons/md'

// Period-over-period delta pill (▲ +N% / ▼ −N%). `invert` flips the good/bad
// colour for metrics where down is better (e.g. turnaround time). Renders
// nothing when value is null (no prior-period baseline).
export default function DeltaChip({ value, invert = false, className = '' }) {
  if (value == null) return null
  const up = value > 0
  const flat = value === 0
  const good = invert ? !up : up
  const cls = flat ? 'text-gray-400 bg-gray-100'
    : good ? 'text-green-700 bg-green-50'
    : 'text-red-600 bg-red-50'
  const Icon = up ? MdArrowUpward : MdArrowDownward
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${cls} ${className}`}
      title="vs. the previous period of the same length">
      {!flat && <Icon size={11} />}{value > 0 ? '+' : ''}{value}%
    </span>
  )
}
