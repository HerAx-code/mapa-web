// Horizontal magnitude bars — one measure (₱) across categories. Single brand
// hue (magnitude = one hue, not categorical), thin baseline-anchored bars with
// 4px rounded ends and a direct value label per row. The label+value text
// doubles as the accessible table, so no separate legend is needed.

const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`

export default function BarList({ data = [], valueKey = 'amount', max, format = peso, emptyText = 'No data yet.' }) {
  if (!data.length) {
    return <p className="text-sm text-gray-500 italic py-4">{emptyText}</p>
  }
  const peak = max ?? Math.max(...data.map(d => Number(d[valueKey]) || 0), 1)

  return (
    <ul className="space-y-3">
      {data.map((d) => {
        const v = Number(d[valueKey]) || 0
        const pct = Math.max(2, Math.round((v / peak) * 100)) // floor so tiny values still show
        return (
          <li key={d.key ?? d.label}>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="text-sm text-gray-700 truncate">{d.label}</span>
              <span className="text-sm font-semibold text-gray-900 tabular-nums whitespace-nowrap">
                {format(v)}
                {d.count != null && <span className="text-gray-400 font-normal"> · {d.count}</span>}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-brand-500 transition-[width] duration-500"
                style={{ width: `${pct}%` }}
                role="img"
                aria-label={`${d.label}: ${format(v)}`}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
