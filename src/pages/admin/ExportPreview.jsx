import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import Layout from '../../components/Layout'
import ConfirmModal from '../../components/ConfirmModal'
import {
  collection, query, where, getDocs, getDoc, doc, Timestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { exportToCSV, dateStamp, readableFileType, openPrintTab } from '../../utils/export'
import { logAudit } from '../../utils/auditLog'
import { tsToDate } from '../../utils/dates'
import {
  MdArrowBack, MdSearch, MdRefresh, MdDownload, MdClose,
} from 'react-icons/md'
import toast from 'react-hot-toast'

// Past this row count, an export will visibly chug the browser tab
// (CSV string build + Blob copy) and Excel/Sheets will struggle to
// open the file. Operators rarely need 10K+ rows in a single CSV --
// usually it's because they forgot to date-filter. Confirm intent.
const LARGE_EXPORT_THRESHOLD = 10000

// ── Column definitions ────────────────────────────────────────────────────

const fmtDate = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleDateString() : '—'
}


const SECTION_CONFIG = {
  documents: {
    title:       'Document Review',
    collection:  'documents',
    statusField: 'status',
    extraConstraints: [],
    searchFields: ['name', 'patientName'],
    statuses: [
      { key: 'all',      label: 'All'      },
      { key: 'pending',  label: 'Pending'  },
      { key: 'verified', label: 'Verified' },
      { key: 'rejected', label: 'Rejected' },
    ],
    cols: [
      { label: '#',               getValue: (d, i) => i + 1 },
      { label: 'Document Name',   getValue: d => d.name ?? '—' },
      { label: 'Patient',         getValue: d => d.patientName ?? '—' },
      { label: 'File Type',       getValue: d => readableFileType(d.type) },
      { label: 'Size',            getValue: d => d.size ?? '—' },
      { label: 'Submitted',       getValue: d => d.date ?? '—' },
      { label: 'Status',          getValue: d => d.status ?? '—' },
      { label: 'Rejection Reason',getValue: d => d.rejectionReason ?? '—' },
    ],
  },
  'applications-full': {
    title:       'Applications (Full Record)',
    collection:  'applications',
    statusField: 'status',
    extraConstraints: [],
    searchFields: ['patientName', 'agencyName', 'appId'],
    // Co-funding slice statuses first; legacy (pending / interview) kept
    // last so pre-redesign data is still exportable but the active set
    // leads the list.
    statuses: [
      { key: 'all',           label: 'All'                },
      { key: 'endorsed',      label: 'Endorsed'           },
      { key: 'reviewing',     label: 'For Funding'        },
      { key: 'awaiting_info', label: 'Needs Info'         },
      { key: 'approved',      label: 'Approved'           },
      { key: 'certificate',   label: 'Guarantee Letter'   },
      { key: 'rejected',      label: 'Rejected'           },
      { key: 'pending',       label: 'Pending (legacy)'   },
      { key: 'interview',     label: 'Interview (legacy)' },
    ],
    cols: [
      { label: '#',           getValue: (d, i) => i + 1 },
      { label: 'App ID',      getValue: d => d.appId ?? '—' },
      { label: 'Patient',     getValue: d => d.patientName ?? '—' },
      { label: 'Contact',     getValue: d => d.patientContact ?? '—' },
      { label: 'Agency',      getValue: d => d.agencyName ?? '—' },
      { label: 'Status',      getValue: d => d.status ?? '—' },
      { label: 'Submitted',   getValue: d => d.submittedAt?.toDate?.().toLocaleDateString() ?? '—' },
      { label: 'Last Updated',getValue: d => d.updatedAt?.toDate?.().toLocaleDateString() ?? '—' },
    ],
  },
  'applications-log': {
    title:       'Applications (Log View)',
    collection:  'applications',
    statusField: 'status',
    extraConstraints: [],
    searchFields: ['patientName', 'agencyName', 'appId'],
    statuses: [
      { key: 'all',           label: 'All'                },
      { key: 'endorsed',      label: 'Endorsed'           },
      { key: 'reviewing',     label: 'For Funding'        },
      { key: 'awaiting_info', label: 'Needs Info'         },
      { key: 'approved',      label: 'Approved'           },
      { key: 'certificate',   label: 'Guarantee Letter'   },
      { key: 'rejected',      label: 'Rejected'           },
      { key: 'pending',       label: 'Pending (legacy)'   },
    ],
    cols: [
      { label: '#',               getValue: (d, i) => i + 1 },
      { label: 'Application ID',  getValue: d => d.appId ?? d.id ?? '—' },
      { label: 'Patient',         getValue: d => d.patientName ?? '—' },
      { label: 'Agency',          getValue: d => d.agencyName ?? '—' },
      { label: 'Status',          getValue: d => d.status ?? '—' },
      { label: 'Submitted',       getValue: d => fmtDate(d.submittedAt) },
    ],
  },
  reports: {
    title:       'Problem Reports',
    collection:  'reports',
    statusField: 'status',
    extraConstraints: [],
    searchFields: ['reporterName', 'category', 'description'],
    statuses: [
      { key: 'all',         label: 'All'         },
      { key: 'open',        label: 'Open'        },
      { key: 'in_progress', label: 'In Progress' },
      { key: 'resolved',    label: 'Resolved'    },
    ],
    cols: [
      { label: '#',          getValue: (d, i) => i + 1 },
      { label: 'Category',   getValue: d => d.category ?? '—' },
      { label: 'Description',getValue: d => d.description ?? '—' },
      { label: 'Reporter',   getValue: d => d.reporterName ?? '—' },
      { label: 'Role',       getValue: d => d.reporterRole ?? '—' },
      { label: 'Submitted',  getValue: d => d.createdAt?.toDate?.().toLocaleDateString() ?? '—' },
      { label: 'Status',     getValue: d => d.status ?? 'open' },
    ],
  },
  patients: {
    title:            'Patients',
    collection:       'users',
    statusField:      null,
    extraConstraints: [where('role', '==', 'patient')],
    extraClientFilter: d => d.role === 'patient',
    searchFields:     ['name', 'email', 'contact', 'hospitalId'],
    statuses:         [{ key: 'all', label: 'All' }],
    cols: [
      { label: '#',               getValue: (d, i) => i + 1 },
      { label: 'Hospital ID',     getValue: d => d.hospitalId ?? '—' },
      { label: 'Name',            getValue: d => d.name ?? '—' },
      { label: 'Email',           getValue: d => d.email ?? '—' },
      { label: 'Contact',         getValue: d => d.contact ?? '—' },
      { label: 'Address',         getValue: d => d.address ?? '—' },
      { label: 'Date Registered', getValue: d => fmtDate(d.createdAt) },
      { label: 'Status',          getValue: d => d.deletion ? 'Marked for Deletion' : 'Active' },
    ],
  },
  hospitalids: {
    title:       'Patient Access Codes',
    collection:  'hospitalIds',
    statusField: 'status',
    extraConstraints: [],
    searchFields: ['id', 'usedBy'],
    statuses: [
      { key: 'all',       label: 'All'       },
      { key: 'used',      label: 'Used'      },
      { key: 'available', label: 'Available' },
    ],
    cols: [
      { label: '#',          getValue: (d, i) => i + 1 },
      { label: 'Access Code',getValue: d => d.id ?? '—' },
      { label: 'Status',     getValue: d => d.status === 'used' ? 'Used' : 'Available' },
      { label: 'Used By',    getValue: d => d.usedBy ?? '—' },
      { label: 'Patient ID', getValue: d => d.patId ?? '—' },
      { label: 'Date',       getValue: d => d.date ?? '—' },
    ],
  },
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function ExportPreview() {
  const { type }      = useParams()
  const navigate      = useNavigate()
  const [searchParams] = useSearchParams()
  const { user }      = useAuth()

  const config = SECTION_CONFIG[type]

  const [docs,             setDocs]             = useState([])
  const [loading,          setLoading]          = useState(true)
  const [selected,         setSelected]         = useState(searchParams.get('status') ?? 'all')
  const [search,           setSearch]           = useState('')
  const [startDate,        setStartDate]        = useState('')
  const [endDate,          setEndDate]          = useState('')
  const [showDateFilter,   setShowDateFilter]   = useState(false)
  const [checkedIds,       setCheckedIds]       = useState(new Set())
  const [clientFilterVals, setClientFilterVals] = useState({})

  const hasDateRange = !!(startDate || endDate)

  const loadData = async () => {
    if (!config) return
    setLoading(true)
    setCheckedIds(new Set())
    try {
      const hasStatusFilter = selected !== 'all' && !!config.statusField
      // When a date range is active, skip extraConstraints in the Firestore query —
      // combining them with createdAt range filters requires composite indexes.
      // Apply extraClientFilter client-side instead.
      const constraints = [
        ...(!hasDateRange ? config.extraConstraints : []),
        ...(!hasDateRange && hasStatusFilter ? [where(config.statusField, '==', selected)] : []),
        ...(startDate ? [where('createdAt', '>=', Timestamp.fromDate(new Date(startDate)))] : []),
        ...(endDate   ? [where('createdAt', '<=', Timestamp.fromDate(new Date(`${endDate}T23:59:59`)))] : []),
      ]
      const snap = await getDocs(query(collection(db, config.collection), ...constraints))
      let data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      if (hasDateRange && config.extraClientFilter) {
        data = data.filter(config.extraClientFilter)
      }
      if (hasDateRange && hasStatusFilter) {
        data = data.filter(d => d[config.statusField] === selected)
      }
      // Phase 0.3: the `usedBy` patient-name field moved off the parent
      // hospitalIds doc into /privateInfo/details. For the hospitalids
      // export, fan out one getDoc per claimed code to fetch the sub-doc
      // and merge `usedBy` back into the row so the CSV column still
      // works. Bounded read count -- only 'used' codes have a sub-doc.
      if (config.collection === 'hospitalIds') {
        const usedRows = data.filter(d => d.status === 'used')
        const infoSnaps = await Promise.all(
          usedRows.map(d => getDoc(doc(db, 'hospitalIds', d.id, 'privateInfo', 'details')))
        )
        const infoMap = {}
        infoSnaps.forEach((s, i) => { if (s.exists()) infoMap[usedRows[i].id] = s.data() })
        data = data.map(d => ({ ...d, usedBy: infoMap[d.id]?.usedBy ?? d.usedBy ?? null }))
      }
      data.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
      setDocs(data)
    } catch (err) { console.error(err); toast.error('Failed to load data. Please try again.') }
    finally { setLoading(false) }
  }

  useEffect(() => { if (config) loadData() }, [type, selected, startDate, endDate])
  useEffect(() => { setClientFilterVals({}) }, [type])

  // ── Filtered (client-side search + client filters) ───────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return docs.filter(d => {
      // Client filters (e.g. category chips on audit log)
      if (config.clientFilters) {
        for (const cf of config.clientFilters) {
          const val = clientFilterVals[cf.key] ?? 'all'
          if (!cf.test(d, val)) return false
        }
      }
      // Search — use searchFn if defined, else field-based
      if (!q) return true
      if (config.searchFn) return config.searchFn(d, q)
      return (config.searchFields ?? []).some(f => String(d[f] ?? '').toLowerCase().includes(q))
    })
  }, [docs, search, config, clientFilterVals])

  // ── Row selection ─────────────────────────────────────────────────────
  const allChecked = filtered.length > 0 && filtered.every(d => checkedIds.has(d.id))

  const toggleAll = () => {
    if (allChecked) setCheckedIds(new Set())
    else setCheckedIds(new Set(filtered.map(d => d.id)))
  }

  const toggleRow = (id) =>
    setCheckedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // ── Downloads ─────────────────────────────────────────────────────────
  const label = `${config?.title} — ${config?.statuses.find(s => s.key === selected)?.label ?? 'All'}`

  // Pending-export shape lets ConfirmModal pull the rows + filename
  // without closing over a stale `filtered` between renders.
  const [pendingExport, setPendingExport] = useState(null)

  const runExport = ({ rows, filename }) => {
    exportToCSV(filename, config.cols, rows)
    // RA 10173: a CSV of personal / financial records is leaving the system —
    // record who exported which dataset, how many rows, and when.
    logAudit(user, {
      action:     'data_exported',
      targetType: 'export',
      targetName: config.title ?? type,
      details:    `${rows.length} row${rows.length === 1 ? '' : 's'} · ${filename}`,
    })
  }

  const requestExport = ({ rows, filename }) => {
    if (rows.length === 0) return
    if (rows.length >= LARGE_EXPORT_THRESHOLD) {
      setPendingExport({ rows, filename })
    } else {
      runExport({ rows, filename })
    }
  }

  const downloadAll = () =>
    requestExport({
      rows:     filtered,
      filename: `${type}-all-${dateStamp()}.csv`,
    })

  const downloadSelected = () => {
    const rows = filtered.filter(d => checkedIds.has(d.id))
    requestExport({
      rows,
      filename: `${type}-selected-${dateStamp()}.csv`,
    })
  }

  const printAll = () =>
    openPrintTab(filtered, label, config.cols, user?.name ?? 'Admin')

  const printSelected = () => {
    const rows = filtered.filter(d => checkedIds.has(d.id))
    openPrintTab(rows, `${label} — ${selectedCount} selected`, config.cols, user?.name ?? 'Admin')
  }

  const clearDates = () => { setStartDate(''); setEndDate(''); setShowDateFilter(false) }

  // ── 404 guard ─────────────────────────────────────────────────────────
  if (!config) {
    return (
      <Layout breadcrumb="Export">
        <div className="flex flex-col items-center justify-center flex-1 p-8 text-center">
          <MdSearch className="mx-auto mb-3 text-gray-300" size={32} />
          <p className="text-sm font-medium text-gray-700 mb-1">Unknown export type</p>
          <p className="text-xs text-gray-400 mb-5">The export type "{type}" does not exist.</p>
          <button className="btn-secondary text-sm" onClick={() => navigate('/admin/export')}>
            Back to Export
          </button>
        </div>
      </Layout>
    )
  }

  const selectedCount = checkedIds.size

  // ── O(1) row index lookup ─────────────────────────────────────────────
  const docIndexMap = useMemo(() => {
    const m = new Map()
    docs.forEach((d, i) => m.set(d.id, i))
    return m
  }, [docs])

  return (
    <Layout breadcrumb="Export">
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

        {/* ── Sub-header ── */}
        <div className="bg-white border-b border-gray-100 px-5 py-3 flex items-center gap-3 flex-shrink-0">
          <button
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors flex-shrink-0"
            onClick={() => navigate('/admin/export')}>
            <MdArrowBack size={16} /> Back to Export
          </button>
          <div className="h-4 w-px bg-gray-200 flex-shrink-0" />
          <p className="text-sm font-semibold text-gray-900 flex-1 truncate">{config.title}</p>
          <p className="text-xs text-gray-400 flex-shrink-0">
            {loading ? '—' : `${docs.length} record${docs.length !== 1 ? 's' : ''} loaded`}
          </p>
          <button className="btn-secondary text-sm flex items-center gap-1.5 flex-shrink-0"
            onClick={loadData} disabled={loading}>
            <MdRefresh size={15} /> Refresh
          </button>
        </div>

        {/* ── Filter bar ── */}
        <div className="bg-white border-b border-gray-100 px-5 py-3 space-y-2.5 flex-shrink-0">

          {/* Status chips */}
          {config.statuses.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {config.statuses.map(s => (
                <button key={s.key}
                  onClick={() => setSelected(s.key)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    selected === s.key
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Client filter chips (e.g. category on audit log) */}
          {config.clientFilters?.map(cf => (
            <div key={cf.key} className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400 flex-shrink-0">{cf.label}</span>
              {cf.options.map(opt => {
                const active = (clientFilterVals[cf.key] ?? 'all') === opt.key
                return (
                  <button key={opt.key}
                    onClick={() => setClientFilterVals(prev => ({ ...prev, [cf.key]: opt.key }))}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-brand-500 text-white border-brand-500'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}>
                    {opt.label}
                  </button>
                )
              })}
            </div>
          ))}

          {/* Search + date filter toggle */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input className="input pl-9 py-1.5 text-sm" placeholder="Search records…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {/* Date range — collapsed by default */}
            {!showDateFilter && !hasDateRange ? (
              <button
                className="text-xs text-gray-400 hover:text-brand-500 transition-colors flex-shrink-0"
                onClick={() => setShowDateFilter(true)}>
                + Add date filter
              </button>
            ) : (
              <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-gray-400">From</label>
                  <input type="date" className="input py-1 text-xs w-36"
                    value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-gray-400">To</label>
                  <input type="date" className="input py-1 text-xs w-36"
                    value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
                <button className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                  onClick={clearDates}>
                  <MdClose size={14} />
                </button>
              </div>
            )}

            {search && (
              <p className="text-xs text-gray-400 flex-shrink-0">
                {filtered.length} of {docs.length} shown
              </p>
            )}
          </div>
        </div>

        {/* ── Table ── */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex gap-4 animate-pulse">
                  <div className="w-4 h-4 bg-gray-100 rounded flex-shrink-0 mt-0.5" />
                  {Array.from({ length: config.cols.length }).map((_, j) => (
                    <div key={j} className="h-3 bg-gray-100 rounded flex-1" />
                  ))}
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-20 text-center">
              <MdSearch className="mx-auto mb-3 text-gray-300" size={32} />
              <p className="text-sm font-medium text-gray-600 mb-1">No records found</p>
              <p className="text-xs text-gray-400">
                {search
                  ? 'No records match your search. Try clearing the search.'
                  : hasDateRange
                    ? 'No records in this date range. Try widening the filter.'
                    : 'No records available for this selection.'
                }
              </p>
              {(search || hasDateRange) && (
                <button
                  onClick={() => { setSearch(''); clearDates() }}
                  className="mt-3 inline-flex items-center text-sm font-medium text-brand-500 hover:text-brand-600">
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <table className="data-table min-w-full">
              <thead className="sticky top-0 z-10 bg-white">
                <tr>
                  <th className="w-10">
                    <input type="checkbox" className="w-4 h-4 accent-brand-500"
                      checked={allChecked}
                      onChange={toggleAll} />
                  </th>
                  {config.cols.map(c => <th key={c.label}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const isChecked   = checkedIds.has(d.id)
                  const originalIdx = docIndexMap.get(d.id) ?? 0
                  return (
                    <tr key={d.id}
                      className={`cursor-pointer ${isChecked ? 'bg-brand-50/40' : ''}`}
                      onClick={() => toggleRow(d.id)}>
                      <td onClick={e => e.stopPropagation()}>
                        <input type="checkbox" className="w-4 h-4 accent-brand-500"
                          checked={isChecked}
                          onChange={() => toggleRow(d.id)} />
                      </td>
                      {config.cols.map(c => (
                        <td key={c.label}>{c.getValue(d, originalIdx) ?? '—'}</td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Sticky footer ── */}
        <div className="bg-white border-t border-gray-100 px-5 py-3 flex items-center justify-between gap-4 flex-shrink-0">
          <div className="min-w-0">
            {selectedCount > 0 ? (
              <p className="text-sm font-medium text-brand-600">
                {selectedCount} row{selectedCount !== 1 ? 's' : ''} selected
                <button className="ml-2 text-xs text-gray-400 hover:text-gray-600 font-normal"
                  onClick={() => setCheckedIds(new Set())}>
                  Clear
                </button>
              </p>
            ) : (
              <p className="text-sm text-gray-500">
                {filtered.length} record{filtered.length !== 1 ? 's' : ''}
                {search && ` matching "${search}"`}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-0.5">
              All exported files are protected under RA 10173 — handle with care.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button className="btn-secondary text-sm flex items-center gap-1.5"
              disabled={filtered.length === 0}
              onClick={downloadAll}>
              <MdDownload size={15} />
              {selectedCount > 0 ? 'Download All CSV' : 'Download CSV'}
            </button>
            {selectedCount > 0 && (
              <button className="btn-secondary text-sm flex items-center gap-1.5"
                onClick={downloadSelected}>
                <MdDownload size={15} /> Download Selected ({selectedCount})
              </button>
            )}
            <button className="btn-primary text-sm flex items-center gap-1.5"
              disabled={filtered.length === 0}
              onClick={selectedCount > 0 ? printSelected : printAll}>
              {selectedCount > 0 ? `Print Selected (${selectedCount})` : 'Print Report'}
            </button>
          </div>
        </div>

      </div>

      {/* Large-export confirmation. Triggered when filtered (or
          selected) row count crosses LARGE_EXPORT_THRESHOLD. The
          warning prevents an accidental 50K-row export from chugging
          the browser tab and producing a CSV Excel can't open. */}
      <ConfirmModal
        open={!!pendingExport}
        tone="warning"
        title={`Export ${pendingExport?.rows.length.toLocaleString() ?? ''} rows?`}
        body={
          <>
            <p className="mb-2">
              You're about to download <strong>{pendingExport?.rows.length.toLocaleString()}</strong> rows
              as a single CSV. Files this size can:
            </p>
            <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
              <li>Take several seconds to generate (the tab will look frozen)</li>
              <li>Exceed Excel's row limit on older versions (1,048,576 rows in modern Excel, fine here, but Numbers/Sheets are slower)</li>
              <li>Be slow to email or attach to a report</li>
            </ul>
            <p className="text-sm text-gray-600 mt-3">
              Consider narrowing with a date range or status filter before downloading. Continue anyway?
            </p>
          </>
        }
        confirmLabel="Download anyway"
        confirmLabelBusy="Generating CSV…"
        onClose={() => setPendingExport(null)}
        onConfirm={async () => {
          runExport(pendingExport)
          setPendingExport(null)
        }}
      />
    </Layout>
  )
}
