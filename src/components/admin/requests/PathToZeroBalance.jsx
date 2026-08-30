// "Path to zero balance" — a consolidated, read-only breakdown of every funding
// source on a request, in the order they apply against the bill (Magic Patterns
// detail adoption, remapped to MAPA's co-funding model). MAPA funds in two
// layers: coverage-first (PhilHealth → other prior aid reduce the bill to the
// residual the agencies co-fund), then endorsed agency slices toward zero.
// Presentational — reads request fields + the request's slices + computeFunding.

const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`

// A slice's contribution + how to badge its state.
const SLICE_STATE = {
  approved:     { label: 'approved', cls: 'text-green-700' },
  certificate:  { label: 'approved', cls: 'text-green-700' },
  reviewing:    { label: 'pending',  cls: 'text-amber-700' },
  endorsed:     { label: 'pending',  cls: 'text-amber-700' },
  awaiting_info:{ label: 'needs info', cls: 'text-amber-700' },
  rejected:     { label: 'declined', cls: 'text-gray-400' },
}

export default function PathToZeroBalance({ request, slices = [], agencies = [], funding }) {
  const totalBill = Number(request.totalBill ?? request.amountNeeded) || 0
  const ph        = Number(request.philhealthCovered) || 0
  const other     = Number(request.otherCovered) || 0
  const needed    = Number(request.amountNeeded) || 0
  const agencyName = (id) => agencies.find(a => a.id === id)?.name ?? 'Agency'

  // % of the FULL bill covered by every source (coverage-first + committed slices).
  const coveredPct = totalBill > 0
    ? Math.min(100, Math.round(((ph + other + funding.committed) / totalBill) * 100))
    : 0

  const sliceRows = [...slices].sort((a, b) => (b.amountApproved ?? b.amountRequested ?? 0) - (a.amountApproved ?? a.amountRequested ?? 0))

  const Row = ({ label, sub, amount, sign = '', strong = false, top = false, muted = false }) => (
    <li className={`flex items-center justify-between gap-3 py-2 ${top ? 'border-t border-gray-100' : ''}`}>
      <span className={`min-w-0 ${strong ? 'font-semibold text-gray-900' : muted ? 'text-gray-400' : 'text-gray-700'}`}>
        <span className="truncate">{label}</span>
        {sub && <span className="ml-1.5 text-[11px] font-medium">{sub}</span>}
      </span>
      <span className={`tabular-nums whitespace-nowrap ${strong ? 'font-semibold text-gray-900' : muted ? 'text-gray-400' : 'text-gray-700'}`}>
        {sign}{peso(amount)}
      </span>
    </li>
  )

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-gray-800">Path to zero balance</h3>
        <span className="tabular-nums text-xs text-gray-400">{coveredPct}% of {peso(totalBill)} covered</span>
      </div>

      <ul className="text-sm divide-y-0">
        <Row label="Total bill" amount={totalBill} />
        {ph > 0    && <Row label="PhilHealth" sub={<span className="text-green-700">applied</span>} amount={ph} sign="− " />}
        {other > 0 && <Row label="Other prior aid" sub={<span className="text-green-700">applied</span>} amount={other} sign="− " />}
        <Row label="Needed from agencies" amount={needed} top strong={false} muted />

        {sliceRows.length === 0 && (
          <li className="py-2 text-sm text-gray-400 border-t border-gray-100">No agency endorsed yet.</li>
        )}
        {sliceRows.map(s => {
          const st = SLICE_STATE[s.status] ?? { label: s.status, cls: 'text-gray-400' }
          const amount = s.amountApproved ?? s.amountRequested ?? 0
          // Only APPROVED funding actually reduces the balance (balance =
          // needed − committed). Pending is a reserved cap, declined is nothing
          // — so neither carries the "−" sign, and the visible "−" rows sum to
          // the stated Remaining balance.
          const isApproved = st.label === 'approved'
          return (
            <Row key={s.id}
              label={agencyName(s.agencyId)}
              sub={<span className={st.cls}>{st.label}</span>}
              amount={amount}
              sign={isApproved ? '− ' : ''}
              muted={st.label === 'declined'} />
          )
        })}

        <Row label="Remaining balance" amount={funding.balance} sign="" top strong />
      </ul>
    </div>
  )
}
