import { MdKeyboardArrowDown, MdChevronRight, MdWarningAmber, MdDescription } from 'react-icons/md'
import { computeFunding } from '../../../utils/requests'
import { docCounts } from '../../../utils/queueBuckets'
import { slaState, slaLabel } from '../../../utils/sla'
import StatusBadge from '../../ui/StatusBadge'

// The admin request queue table, reproduced column-for-column from the Magic
// Patterns reference (checkbox · REQUEST · CATEGORY · BALANCE · COVERAGE · DOCS
// · OFFICER · STATUS · WAITING), remapped to MAPA's design tokens + data.
// Presentational: the container passes the already-filtered-and-sorted page,
// the slice map, the selection set, and the coverage-warning helper.

const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`

const initials = (name) =>
  (name ?? '').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '—'

// submittedAt → epoch-ms across Timestamp / { seconds } / Date / ISO shapes.
const toMs = (ts) => {
  if (!ts) return null
  if (typeof ts.toDate === 'function') return ts.toDate().getTime()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

const waitingLabel = (ts) => {
  const t = toMs(ts)
  if (t == null) return '—'
  const ms = Date.now() - t
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `${days}d`
  const hrs = Math.floor(ms / 3_600_000)
  return hrs >= 1 ? `${hrs}h` : 'just now'
}

const SLA_TEXT = { ok: 'text-gray-600', due_soon: 'text-amber-700', overdue: 'text-red-700' }

function SortHeader({ label, sortKey, sort, onSort, align = 'left' }) {
  const active = sort === sortKey
  return (
    <th scope="col" className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${active ? 'text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}>
        {label}
        <MdKeyboardArrowDown size={13} className={active ? 'text-brand-600' : 'text-transparent'} />
      </button>
    </th>
  )
}

// Two-tone coverage bar: committed (secured) + outstanding (in-flight).
function CoverageBar({ funding }) {
  const total = funding.committed + funding.balance || 1
  const outPct = Math.max(0, Math.min(100 - funding.pct, Math.round((funding.outstanding / total) * 100)))
  return (
    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200 flex" aria-hidden="true">
      <span className="h-full bg-brand-500" style={{ width: `${funding.pct}%` }} />
      <span className="h-full bg-brand-200" style={{ width: `${outPct}%` }} />
    </span>
  )
}

const th = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500'

export default function RequestsTable({
  requests, slicesByRequest, sort, onSort, onOpen, coverageWarning,
  selected, onToggle, onToggleAll,
}) {
  const allSelected = requests.length > 0 && requests.every(r => selected?.has(r.id))

  const rowData = (r) => {
    const needed  = Number(r.amountNeeded) || 0
    const funding = computeFunding(needed, slicesByRequest.get(r.id) ?? [])
    const dc      = docCounts(r)
    const warning = coverageWarning(r)
    const sla     = slaState(r)
    return { needed, funding, dc, warning, sla }
  }

  return (
    <>
      {/* Desktop table */}
      <div className="card overflow-x-auto hidden sm:block">
        <table className="w-full min-w-[1000px] border-collapse text-sm">
          <thead className="border-b border-gray-100 bg-gray-50">
            <tr>
              <th scope="col" className="w-10 px-3 py-2">
                <input type="checkbox" checked={allSelected} onChange={onToggleAll}
                  aria-label="Select all requests in view"
                  className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
              </th>
              <th scope="col" className={th}>Request</th>
              <th scope="col" className={th}>Category</th>
              <SortHeader label="Balance" sortKey="balance" sort={sort} onSort={onSort} align="right" />
              <SortHeader label="Coverage" sortKey="coverage" sort={sort} onSort={onSort} />
              <th scope="col" className={th}>Docs</th>
              <th scope="col" className={th}>Officer</th>
              <th scope="col" className={th}>Status</th>
              <SortHeader label="Waiting" sortKey="waiting" sort={sort} onSort={onSort} align="right" />
              <th scope="col" className="w-10 px-3"><span className="sr-only">Open request</span></th>
            </tr>
          </thead>
          <tbody>
            {requests.map(r => {
              const { funding, dc, warning, sla } = rowData(r)
              const isSelected = !!selected?.has(r.id)
              return (
                <tr key={r.id} onClick={() => onOpen(r)}
                  className={`cursor-pointer border-b border-gray-100 transition-colors ${isSelected ? 'bg-brand-50/60' : 'bg-white hover:bg-gray-50'}`}>
                  <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={() => onToggle(r.id)}
                      aria-label={`Select ${r.requestId}`}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                  </td>

                  <td className="px-3 py-3">
                    <div className="flex items-start gap-2">
                      {r.priority === 'urgent' && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" title="Urgent" aria-label="Urgent" />}
                      <span className="min-w-0">
                        <span className="block font-semibold text-gray-900 truncate">{r.patientName}{r.filedBy && <span className="ml-1 text-xs font-normal text-amber-600">(rep)</span>}</span>
                        <span className="tabular-nums block text-[11px] text-gray-500 truncate">{r.requestId} · {r.facility ?? r.assistanceType}</span>
                      </span>
                    </div>
                  </td>

                  <td className="whitespace-nowrap px-3 py-3 text-gray-600">{r.assistanceType}</td>

                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    <span className="tabular-nums block font-semibold text-gray-900">{peso(funding.balance)}</span>
                    <span className="tabular-nums block text-[11px] text-gray-500">of {peso(r.totalBill ?? funding.committed + funding.balance)}</span>
                  </td>

                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <CoverageBar funding={funding} />
                      <span className="tabular-nums text-[11px] text-gray-600">{funding.pct}%</span>
                    </div>
                    <span className="tabular-nums mt-0.5 block text-[11px] text-gray-400">{peso(funding.committed)} committed</span>
                  </td>

                  <td className="px-3 py-3">
                    <span className={`tabular-nums inline-flex items-center gap-1 text-[11px] font-medium ${dc.blocking ? 'text-red-600' : 'text-gray-600'}`}>
                      {dc.blocking ? <MdWarningAmber size={13} /> : <MdDescription size={13} className="text-gray-400" />}
                      {dc.verified}/{dc.total}
                    </span>
                  </td>

                  <td className="whitespace-nowrap px-3 py-3">
                    {r.assignee ? (
                      <span className="flex items-center gap-1.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-600">{initials(r.assignee)}</span>
                        <span className="text-[11px] text-gray-600">{r.assignee}</span>
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium text-amber-700">Unassigned</span>
                    )}
                  </td>

                  <td className="whitespace-nowrap px-3 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={r.status} kind="request" />
                      {warning && <span className={`inline-block whitespace-nowrap text-[11px] font-medium px-1.5 py-0.5 rounded ${warning.cls}`}>{warning.label}</span>}
                    </div>
                  </td>

                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    <span className={`tabular-nums block text-sm font-medium ${SLA_TEXT[sla]}`}>{waitingLabel(r.submittedAt)}</span>
                    <span className={`block text-[11px] ${sla === 'overdue' ? 'text-red-600' : sla === 'due_soon' ? 'text-amber-600' : 'text-gray-400'}`}>
                      {sla === 'overdue' && <MdWarningAmber size={11} className="inline mb-0.5" />} {slaLabel(sla)}
                    </span>
                  </td>

                  <td className="px-3 py-3 text-right"><MdChevronRight size={16} className="text-gray-300 inline" /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="grid grid-cols-1 gap-3 sm:hidden">
        {requests.map(r => {
          const { funding, dc, warning } = rowData(r)
          return (
            <button key={r.id} onClick={() => onOpen(r)} className="card p-4 text-left hover:shadow-md transition-all w-full">
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-sm font-semibold text-gray-800 truncate">{r.patientName}{r.filedBy && <span className="ml-1 text-xs text-amber-600">(rep)</span>}</p>
                <StatusBadge status={r.status} kind="request" className="flex-shrink-0" />
              </div>
              <p className="text-xs text-gray-400 mb-2">{r.requestId} · {r.assistanceType}</p>
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-gray-400">Balance <span className="tabular-nums font-semibold text-gray-700">{peso(funding.balance)}</span></span>
                <span className="text-[11px] text-gray-500">{r.assignee ?? 'Unassigned'}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2"><CoverageBar funding={funding} /><span className="tabular-nums text-[11px] text-gray-600">{funding.pct}%</span></div>
                <span className={`tabular-nums text-[11px] font-medium ${dc.blocking ? 'text-red-600' : 'text-gray-400'}`}>docs {dc.verified}/{dc.total}</span>
              </div>
              {warning && <div className="mt-2"><span className={`inline-block whitespace-nowrap text-xs font-medium px-2 py-0.5 rounded ${warning.cls}`}>{warning.label}</span></div>}
            </button>
          )
        })}
      </div>
    </>
  )
}
