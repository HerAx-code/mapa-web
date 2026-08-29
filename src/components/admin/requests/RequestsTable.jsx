import { MdKeyboardArrowDown, MdChevronRight, MdWarningAmber } from 'react-icons/md'
import { computeFunding } from '../../../utils/requests'
import { tsToDate } from '../../../utils/dates'
import { bucketOf, docCounts } from '../../../utils/queueBuckets'
import StatusBadge from '../../ui/StatusBadge'

// Local peso formatter (mirrors the one in admin/Requests.jsx — not exported).
const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`

// Scannable, sortable request queue row (adopted from the Magic Patterns
// reference, remapped to MAPA's design system + data model). Presentational:
// the container passes the already-filtered-and-sorted list plus the slice map
// and the coverage-warning helper. Read-only — opening a row is the only action.

const initials = (name) =>
  (name ?? '').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '—'

// Short chip label + colour per stage bucket (the long tab labels are too wide
// for a row chip).
const CHIP = {
  verify:    { label: 'Verify docs', cls: 'bg-blue-100 text-blue-700' },
  assess:    { label: 'Assess',      cls: 'bg-amber-100 text-amber-700' },
  interview: { label: 'Interview',   cls: 'bg-purple-100 text-purple-700' },
  endorse:   { label: 'Ready',       cls: 'bg-brand-100 text-brand-700' },
  endorsed:  { label: 'Endorsed',    cls: 'bg-indigo-100 text-indigo-700' },
  completed: { label: 'Done',        cls: 'bg-gray-100 text-gray-500' },
}

// Relative "waiting" duration from submittedAt.
const waitingLabel = (ts) => {
  const d = tsToDate(ts)
  if (!d) return '—'
  const ms = Date.now() - d.getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `${days}d`
  const hrs = Math.floor(ms / 3_600_000)
  return hrs >= 1 ? `${hrs}h` : 'just now'
}

function SortHeader({ label, sortKey, sort, onSort, align = 'left' }) {
  const active = sort === sortKey
  return (
    <th className={align === 'right' ? 'text-right' : 'text-left'}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-0.5 ${align === 'right' ? 'flex-row-reverse' : ''} ${
          active ? 'text-gray-900' : 'text-gray-500 hover:text-gray-800'
        }`}>
        {label}
        <MdKeyboardArrowDown size={14} className={active ? 'text-brand-600' : 'text-transparent'} />
      </button>
    </th>
  )
}

// The two-tone coverage bar: committed (secured) + outstanding (in-flight).
function CoverageBar({ funding }) {
  const outPct = funding.balance > 0 && (funding.committed + funding.outstanding) > 0
    ? Math.min(100 - funding.pct, Math.round((funding.outstanding / (funding.committed + funding.balance || 1)) * 100))
    : 0
  return (
    <div className="flex items-center gap-2">
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200 flex" aria-hidden="true">
        <span className="h-full bg-brand-500" style={{ width: `${funding.pct}%` }} />
        <span className="h-full bg-brand-200" style={{ width: `${outPct}%` }} />
      </span>
      <span className="tabular-nums text-xs text-gray-500">{funding.pct}%</span>
    </div>
  )
}

export default function RequestsTable({ requests, slicesByRequest, sort, onSort, onOpen, coverageWarning }) {
  const rowData = (r) => {
    const needed  = Number(r.amountNeeded) || 0
    const funding = computeFunding(needed, slicesByRequest.get(r.id) ?? [])
    const chip    = CHIP[bucketOf(r)] ?? CHIP.verify
    const dc      = docCounts(r)
    const warning = coverageWarning(r)
    const mismatch = r.status === 'fully_funded' && needed > 0 && funding.committed < needed
    const needsAction = ['verify', 'assess', 'interview', 'endorse'].includes(bucketOf(r))
    return { needed, funding, chip, dc, warning, mismatch, needsAction }
  }

  return (
    <>
      {/* Desktop table */}
      <div className="card overflow-x-auto hidden sm:block">
        <table className="data-table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Category</th>
              <SortHeader label="Balance"  sortKey="balance"  sort={sort} onSort={onSort} align="right" />
              <SortHeader label="Coverage" sortKey="coverage" sort={sort} onSort={onSort} />
              <th>Docs</th>
              <th>Stage</th>
              <SortHeader label="Waiting"  sortKey="waiting"  sort={sort} onSort={onSort} align="right" />
              <th className="text-right"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {requests.map(r => {
              const { funding, chip, dc, warning, mismatch, needsAction } = rowData(r)
              return (
                <tr key={r.id} className="cursor-pointer group" onClick={() => onOpen(r)}>
                  <td className={needsAction || warning ? 'border-l-2 border-brand-400' : 'border-l-2 border-transparent'}>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-brand-50 text-brand-600 border-2 border-brand-200 flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {initials(r.patientName)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-800 truncate">{r.patientName}{r.filedBy && <span className="ml-1 text-xs text-amber-600">(rep)</span>}</p>
                        <p className="text-xs text-gray-400 truncate">{r.requestId} · {r.assistanceType}</p>
                      </div>
                    </div>
                  </td>
                  <td className="text-gray-600 whitespace-nowrap">{r.assistanceType}</td>
                  <td className="text-right">
                    <p className="tabular-nums font-medium text-gray-800 whitespace-nowrap">{peso(funding.balance)}</p>
                    <p className="tabular-nums text-xs text-gray-400 whitespace-nowrap">of {peso(r.totalBill ?? funding.committed + funding.balance)}</p>
                  </td>
                  <td><CoverageBar funding={funding} /></td>
                  <td>
                    <span className={`tabular-nums inline-flex items-center gap-1 text-xs font-medium ${dc.blocking ? 'text-red-600' : 'text-gray-600'}`}>
                      {dc.blocking && <MdWarningAmber size={14} />}
                      {dc.verified}/{dc.total}
                    </span>
                  </td>
                  <td>
                    <div className="flex flex-col items-start gap-1">
                      <span className={`inline-block whitespace-nowrap text-xs font-semibold px-2.5 py-0.5 rounded-full ${chip.cls}`}>{chip.label}</span>
                      {warning && <span className={`inline-block whitespace-nowrap text-xs font-medium px-2 py-0.5 rounded ${warning.cls}`}>{warning.label}</span>}
                      {mismatch && (
                        <span className="inline-block whitespace-nowrap text-xs font-medium px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
                          title={`Funded status but only ${peso(funding.committed)} of ${peso(r.amountNeeded)} is actually secured. Likely legacy data — investigate or re-derive.`}>
                          ⚠ data check
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="text-right">
                    <p className="tabular-nums text-sm font-medium text-gray-700 whitespace-nowrap">{waitingLabel(r.submittedAt)}</p>
                  </td>
                  <td className="text-right"><MdChevronRight size={18} className="text-gray-300 group-hover:text-brand-500 inline" /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="grid grid-cols-1 gap-3 sm:hidden">
        {requests.map(r => {
          const { funding, chip, dc, warning, mismatch } = rowData(r)
          return (
            <button key={r.id} onClick={() => onOpen(r)} className="card p-4 text-left hover:shadow-md transition-all w-full">
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-sm font-semibold text-gray-800 truncate">{r.patientName}{r.filedBy && <span className="ml-1 text-xs text-amber-600">(rep)</span>}</p>
                <StatusBadge status={r.status} kind="request" className="flex-shrink-0" />
              </div>
              <p className="text-xs text-gray-400 mb-2">{r.requestId} · {r.assistanceType}</p>
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-gray-400">Balance <span className="tabular-nums font-semibold text-gray-700">{peso(funding.balance)}</span></span>
                <span className={`inline-block whitespace-nowrap text-xs font-semibold px-2 py-0.5 rounded-full ${chip.cls}`}>{chip.label}</span>
              </div>
              <div className="flex items-center gap-3">
                <CoverageBar funding={funding} />
                <span className={`tabular-nums text-xs font-medium ${dc.blocking ? 'text-red-600' : 'text-gray-400'}`}>docs {dc.verified}/{dc.total}</span>
              </div>
              {warning && <div className="mt-2"><span className={`inline-block whitespace-nowrap text-xs font-medium px-2 py-0.5 rounded ${warning.cls}`}>{warning.label}</span></div>}
              {mismatch && <div className="mt-2"><span className="inline-block whitespace-nowrap text-xs font-medium px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">⚠ data check — only {peso(funding.committed)} secured</span></div>}
            </button>
          )
        })}
      </div>
    </>
  )
}
