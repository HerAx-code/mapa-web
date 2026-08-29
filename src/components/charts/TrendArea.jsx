// Monthly ₱ trend — a single-series area + line. 2px brand line, a faint
// area fill, recessive gridlines, and an emphasized endpoint. Points carry a
// native <title> tooltip (accessible, no JS). Renders responsively via a
// viewBox; the parent controls width.

const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`

export default function TrendArea({ data = [], height = 200, labelFor = (d) => d.key, emptyText = 'No data yet.' }) {
  if (!data.length) {
    return <p className="text-sm text-gray-500 italic py-4">{emptyText}</p>
  }

  const W = 640, H = height, padX = 12, padTop = 16, padBot = 28
  const peak = Math.max(...data.map(d => Number(d.amount) || 0), 1)
  const innerW = W - padX * 2
  const innerH = H - padTop - padBot
  // A single point sits centered; otherwise spread across the inner width.
  const x = (i) => data.length === 1 ? W / 2 : padX + (i / (data.length - 1)) * innerW
  const y = (v) => padTop + innerH - (Math.max(0, v) / peak) * innerH

  const pts = data.map((d, i) => [x(i), y(Number(d.amount) || 0)])
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${pts[pts.length - 1][0].toFixed(1)},${(padTop + innerH).toFixed(1)} L${pts[0][0].toFixed(1)},${(padTop + innerH).toFixed(1)} Z`

  // 3 recessive gridlines (0, 50%, 100% of peak).
  const grid = [0, 0.5, 1].map(f => padTop + innerH - f * innerH)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full text-brand-500" style={{ height }} role="img"
      aria-label="Assistance facilitated per month">
      {grid.map((gy, i) => (
        <line key={i} x1={padX} x2={W - padX} y1={gy} y2={gy} stroke="currentColor" strokeOpacity="0.1" strokeWidth="1" />
      ))}
      <path d={areaPath} fill="currentColor" fillOpacity="0.08" />
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => {
        const last = i === pts.length - 1
        return (
          <g key={i}>
            <circle cx={p[0]} cy={p[1]} r={last ? 4 : 3} fill="currentColor"
              stroke="#fff" strokeWidth={last ? 2 : 1.5}>
              <title>{`${labelFor(data[i])}: ${peso(data[i].amount)}`}</title>
            </circle>
            <text x={p[0]} y={H - 9} textAnchor="middle" className="fill-gray-400" style={{ fontSize: 10 }}>
              {labelFor(data[i])}
            </text>
          </g>
        )
      })}
      {/* Direct-label the endpoint value. */}
      <text x={pts[pts.length - 1][0]} y={Math.max(12, pts[pts.length - 1][1] - 8)} textAnchor="end"
        className="fill-gray-900" style={{ fontSize: 11, fontWeight: 600 }}>
        {peso(data[data.length - 1].amount)}
      </text>
    </svg>
  )
}
