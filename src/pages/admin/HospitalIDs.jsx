import Layout from '../../components/Layout'
import { useState, useEffect } from 'react'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { MdSearch, MdAdd, MdDelete, MdRefresh, MdClose, MdWarning, MdPrint } from 'react-icons/md'
import { useAuth } from '../../contexts/AuthContext'
import { logAudit } from '../../utils/auditLog'
import { collection, onSnapshot, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../../firebase'
import { tsToDate } from '../../utils/dates'
import toast from 'react-hot-toast'

// ── Helpers ───────────────────────────────────────────────────────────────

// Fix: use max existing number instead of count to avoid collisions
const getNextNum = (ids) => {
  if (ids.length === 0) return 1
  const nums = ids.map(h => {
    const parts = h.id.split('-')
    return parseInt(parts[parts.length - 1], 10) || 0
  })
  return Math.max(...nums) + 1
}

// ── Bulk Add Modal ────────────────────────────────────────────────────────

function BulkAddModal({ nextNum, onClose }) {
  const [count, setCount]   = useState(10)
  const [adding, setAdding] = useState(false)
  useEscapeKey(onClose, !adding)
  const { user }            = useAuth()
  const year     = new Date().getFullYear()
  const startNum = nextNum
  const endNum   = nextNum + Math.max(count, 1) - 1
  const preview  = `CRMC-${year}-${String(startNum).padStart(5, '0')} → CRMC-${year}-${String(endNum).padStart(5, '0')}`

  const handleAdd = async () => {
    const n = Number(count)
    if (!n || n < 1)   { toast.error('Count must be at least 1.'); return }
    if (n > 100)        { toast.error('Maximum 100 IDs per batch.'); return }
    setAdding(true)
    try {
      const batch = writeBatch(db)
      for (let i = 0; i < n; i++) {
        const num   = String(startNum + i).padStart(5, '0')
        const newId = `CRMC-${year}-${num}`
        batch.set(doc(db, 'hospitalIds', newId), {
          // Phase 0.3: parent doc no longer carries usedBy (PII moved
          // to /privateInfo/details on claim).
          status:    'available',
          patId:     null,
          date:      new Date().toLocaleDateString(),
          time:      '',
          createdAt: serverTimestamp(),
        })
      }
      await batch.commit()
      const first = `CRMC-${year}-${String(startNum).padStart(5, '0')}`
      const last  = `CRMC-${year}-${String(endNum).padStart(5, '0')}`
      logAudit(user, { action: 'hospitalid_bulk', targetType: 'hospitalId', targetName: `${first} → ${last}`, details: `Bulk added ${n} hospital ID${n !== 1 ? 's' : ''}` })
      toast.success(`${n} Hospital ID${n !== 1 ? 's' : ''} added.`)
      onClose()
    } catch (err) { console.error(err); toast.error('Failed to add IDs.') }
    finally { setAdding(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Bulk Add Patient Access Codes</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Number of codes to add <span className="text-red-400">*</span>
            </label>
            <input
              type="number" min={1} max={100}
              className="input"
              value={count}
              onChange={e => setCount(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">Maximum 100 per batch.</p>
          </div>

          {/* Preview */}
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs font-medium text-gray-500 mb-1">Preview</p>
            <p className="text-sm font-mono text-gray-800">{preview}</p>
            <p className="text-xs text-gray-400 mt-1">
              {Number(count) || 0} ID{Number(count) !== 1 ? 's' : ''} will be created as <span className="font-medium text-green-600">Available</span>
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
            IDs are generated sequentially from the highest existing number, preventing duplicates even if previous IDs were deleted.
          </div>
        </div>

        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm" onClick={handleAdd} disabled={adding}>
            {adding ? 'Adding...' : `Add ${Number(count) || 0} IDs`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

const fmtDate = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
}

export default function HospitalIDs() {
  const [hospitalIds,    setHospitalIds]    = useState([])
  const [loading,        setLoading]        = useState(true)
  const [statusFilter,   setStatusFilter]   = useState('all')
  const [search,         setSearch]         = useState('')
  const [showBulkAdd,    setShowBulkAdd]    = useState(false)
  const [confirmDelete,  setConfirmDelete]  = useState(null)
  // Phase 4.8: confirmation gate for revoke. Previously the icon click
  // committed immediately -- too easy to misclick on a destructive,
  // patient-affecting action (it clears the patient's hospitalId field
  // and the PII sub-doc atomically). Modal shows the patient name +
  // what will happen before commit.
  const [confirmRevoke,  setConfirmRevoke]  = useState(null)
  const { user }      = useAuth()
  const isSuperAdmin  = user?.role === 'super_admin'

  useEffect(() => {
    // Phase 0.3: patient name (`usedBy`) moved off the parent hospitalIds
    // doc to /privateInfo/details to stop public enumeration. The admin
    // table still needs the name, so on each parent snapshot we fan out
    // one getDoc per claimed code to fetch its sub-doc and merge the
    // `usedBy` field back into the row for display. Only 'used' codes
    // have a sub-doc; available codes skip the read. Read count is
    // bounded by the active claim set (a few hundred at pilot scale).
    const unsub = onSnapshot(collection(db, 'hospitalIds'), async (snap) => {
      const docs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => b.id.localeCompare(a.id))
      try {
        const usedIds = docs.filter(d => d.status === 'used').map(d => d.id)
        const infoSnaps = await Promise.all(
          usedIds.map(id => getDoc(doc(db, 'hospitalIds', id, 'privateInfo', 'details')))
        )
        const infoMap = {}
        infoSnaps.forEach((s, i) => { if (s.exists()) infoMap[usedIds[i]] = s.data() })
        // Merge so the rest of the component keeps reading `h.usedBy` as
        // before. Falls back to the row's own value for any legacy doc
        // still pre-migration.
        setHospitalIds(docs.map(d => ({ ...d, usedBy: infoMap[d.id]?.usedBy ?? d.usedBy ?? null })))
      } catch (err) {
        console.error('[HospitalIDs] privateInfo fetch failed:', err)
        setHospitalIds(docs)
      }
      setLoading(false)
    }, () => {
      setLoading(false)
      toast.error('Failed to load Hospital IDs. Please refresh the page.')
    })
    return unsub
  }, [])

  const used      = hospitalIds.filter(h => h.status === 'used')
  const available = hospitalIds.filter(h => h.status === 'available')
  const nextNum   = getNextNum(hospitalIds)

  const filtered = hospitalIds.filter(h => {
    if (statusFilter !== 'all' && h.status !== statusFilter) return false
    const q = search.toLowerCase()
    return h.id.toLowerCase().includes(q) ||
      (h.usedBy && h.usedBy.toLowerCase().includes(q))
  })

  const isFiltered = search || statusFilter !== 'all'
  const statusGroups = [
    { key: 'available', label: 'Available' },
    { key: 'used', label: 'Used' },
  ].map(g => ({ ...g, entries: filtered.filter(h => h.status === g.key) })).filter(g => g.entries.length > 0)

  // ── Actions ──────────────────────────────────────────────────────────

  const handleAddOne = async () => {
    try {
      const year  = new Date().getFullYear()
      const num   = String(nextNum).padStart(5, '0')
      const newId = `CRMC-${year}-${num}`
      await setDoc(doc(db, 'hospitalIds', newId), {
        // Phase 0.3: usedBy no longer lives on the parent doc; it's
        // created in /privateInfo/details by the claim transaction in
        // Register.jsx. Available codes have no sub-doc.
        status:    'available',
        patId:     null,
        date:      new Date().toLocaleDateString(),
        time:      '',
        createdAt: serverTimestamp(),
      })
      logAudit(user, { action: 'hospitalid_added', targetType: 'hospitalId', targetId: newId, targetName: newId, details: 'Single ID added' })
      toast.success(`${newId} added.`)
    } catch (err) { console.error(err); toast.error('Failed to add Hospital ID. Please try again.') }
  }

  const handleRevoke = async (h) => {
    try {
      // Atomic: reset the hospital ID doc + clear the user's hospitalId
      // field together. If either fails, neither happens -- so we never
      // end up with the code reset but the user's profile still pointing
      // at it (or vice-versa).
      // Phase 0.3: reset the parent + clear the PII sub-doc together so
      // a revoked code carries no leftover name. Also clear the user's
      // hospitalId field; all three writes commit atomically.
      const batch = writeBatch(db)
      batch.update(doc(db, 'hospitalIds', h.id), {
        status:    'available',
        patId:     null,
        date:      '',
        time:      '',
        revokedAt: serverTimestamp(),
      })
      batch.delete(doc(db, 'hospitalIds', h.id, 'privateInfo', 'details'))
      if (h.patId) batch.update(doc(db, 'users', h.patId), { hospitalId: null })
      await batch.commit()
      logAudit(user, { action: 'hospitalid_revoked', targetType: 'hospitalId', targetId: h.id, targetName: h.id, details: `Previously used by ${h.usedBy ?? '—'}` })
      toast.success(`${h.id} reset to Available.`)
    } catch (err) { console.error(err); toast.error('Failed to reset Hospital ID. Please try again.') }
  }

  // Print the currently-filtered available codes as a tear-off batch.
  // Medical Social Services issues these in person -- without a print
  // view they'd have to hand-copy each code, which doesn't scale past a
  // handful. 4-up on A4 keeps each card large enough to read at arm's
  // length and gives a clean dashed border for scissors.
  const handlePrintAvailable = () => {
    const codes = filtered.filter(h => h.status === 'available')
    if (codes.length === 0) {
      toast.error('No available codes in the current view. Filter to "Available" or generate codes first.')
      return
    }
    const win = window.open('', '_blank', 'width=900,height=900')
    if (!win) {
      toast.error('Could not open the print window. Check your browser pop-up settings.')
      return
    }
    const registerUrl = `${window.location.origin}/register`
    const today = new Date().toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
    const escape = (s) => String(s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ))
    const cards = codes.map(c => `
      <div class="card">
        <div class="header">
          <div class="brand">MAPA</div>
          <div class="sub">Cotabato Regional Medical Center</div>
        </div>
        <div class="label">Patient Access Code</div>
        <div class="code">${escape(c.id)}</div>
        <div class="instructions">
          <p>Register online at:</p>
          <p class="url">${escape(registerUrl)}</p>
          <p class="note">Use this code once during sign-up.<br/>Keep it private — do not share.</p>
        </div>
        <div class="issued">Issued ${escape(today)} · Medical Social Services</div>
      </div>
    `).join('')
    // Self-contained HTML so the popup doesn't depend on app CSS that
    // won't be loaded in the new window context.
    win.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>MAPA Patient Access Codes (${codes.length})</title>
  <style>
    @page { size: A4; margin: 1cm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; color: #1f2937; }
    .toolbar { padding: 12px 16px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; display: flex; gap: 8px; align-items: center; }
    .toolbar button { font: inherit; font-size: 14px; padding: 6px 14px; border: 1px solid #d1d5db; background: white; border-radius: 6px; cursor: pointer; }
    .toolbar button.primary { background: #0d9488; color: white; border-color: #0d9488; }
    .toolbar .count { font-size: 13px; color: #6b7280; margin-left: auto; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5cm; padding: 0.5cm; }
    .card { border: 1px dashed #9ca3af; border-radius: 8px; padding: 0.8cm 0.6cm; text-align: center; page-break-inside: avoid; min-height: 8.5cm; display: flex; flex-direction: column; justify-content: space-between; }
    .header .brand { font-size: 22pt; font-weight: 700; color: #0f766e; letter-spacing: 0.05em; }
    .header .sub { font-size: 9pt; color: #6b7280; margin-top: 2px; }
    .label { font-size: 9pt; color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 8px; }
    .code { font-family: 'Courier New', monospace; font-size: 20pt; font-weight: 700; letter-spacing: 0.08em; color: #111827; margin: 6px 0 12px; }
    .instructions p { margin: 4px 0; font-size: 10pt; color: #374151; }
    .instructions .url { font-family: 'Courier New', monospace; font-size: 9pt; color: #0f766e; word-break: break-all; }
    .instructions .note { font-size: 8.5pt; color: #6b7280; margin-top: 8px; line-height: 1.4; }
    .issued { font-size: 7.5pt; color: #9ca3af; margin-top: 8px; border-top: 1px solid #f3f4f6; padding-top: 6px; }
    @media print {
      .toolbar { display: none; }
      .grid { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="primary" onclick="window.print()">Print</button>
    <button onclick="window.close()">Close</button>
    <span class="count">${codes.length} access code${codes.length === 1 ? '' : 's'} · A4 · 4 per page</span>
  </div>
  <div class="grid">${cards}</div>
</body>
</html>`)
    win.document.close()
    // Best-effort auto-print so the operator skips one click on the common
    // case. The toolbar's manual Print button stays available if the auto
    // call is suppressed by the browser (popup-from-popup heuristics).
    win.onload = () => { try { win.focus(); win.print() } catch { /* manual */ } }
    logAudit(user, {
      action: 'hospitalid_printed',
      targetType: 'hospitalId',
      targetName: `${codes.length} code${codes.length === 1 ? '' : 's'}`,
      details: `Printed available codes (filter: ${statusFilter})`,
    })
  }

  const handleDelete = async (h) => {
    try {
      // Atomic: delete the hospital ID doc + clear the user's hospitalId
      // field together. Previously these were two sequential updateDocs --
      // if deleteDoc failed after the user update, the patient was orphaned
      // from a code that still existed.
      // Phase 0.3: also delete the PII sub-doc. Firestore doesn't cascade
      // sub-collections on parent delete; without this explicit delete
      // the privateInfo/details doc would orphan as an unreachable record.
      const batch = writeBatch(db)
      if (h.patId) batch.update(doc(db, 'users', h.patId), { hospitalId: null })
      batch.delete(doc(db, 'hospitalIds', h.id, 'privateInfo', 'details'))
      batch.delete(doc(db, 'hospitalIds', h.id))
      await batch.commit()
      logAudit(user, { action: 'hospitalid_deleted', targetType: 'hospitalId', targetId: h.id, targetName: h.id, details: h.usedBy ? `Was used by ${h.usedBy}` : 'Was available' })
      setConfirmDelete(null)
      toast.success(`${h.id} deleted.`)
    } catch (err) { console.error(err); toast.error('Failed to delete Hospital ID. Please try again.') }
  }

  return (
    <Layout breadcrumb="Patient Access Codes">
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="eyebrow">Access</p>
            <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Patient Access Codes</h1>
            <p className="text-sm text-gray-500 mt-1">Generate and issue access codes for patients to register on the portal.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {isSuperAdmin && (
              <>
                {/* Print is staff_admin + super_admin friendly (it doesn't
                    write anything destructive). Show count of what'll print
                    based on the current filter so the operator knows
                    they're about to hand out exactly that batch. */}
                {(() => {
                  const printable = filtered.filter(h => h.status === 'available').length
                  if (printable === 0) return null
                  return (
                    <button
                      className="btn-secondary flex items-center gap-1.5"
                      onClick={handlePrintAvailable}
                      title="Open a print-friendly view of the available codes in the current filter">
                      <MdPrint size={16} /> Print ({printable})
                    </button>
                  )
                })()}
                <button className="btn-secondary flex items-center gap-1.5" onClick={handleAddOne}>
                  <MdAdd size={16} /> Add One
                </button>
                <button className="btn-primary flex items-center gap-1.5" onClick={() => setShowBulkAdd(true)}>
                  <MdAdd size={16} /> Bulk Add
                </button>
              </>
            )}
          </div>
        </div>

        {/* Two-pane: facet sidebar + codes grouped by status. */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-5 items-start">

          {/* ── Filter sidebar ── */}
          <aside className="lg:sticky lg:top-[68px] space-y-4">
            <div className="card grid grid-cols-3 divide-x divide-gray-100 overflow-hidden text-center">
              {[
                { label: 'Total',     value: hospitalIds.length, color: 'text-gray-800'  },
                { label: 'Available', value: available.length,   color: 'text-green-600' },
                { label: 'Used',      value: used.length,        color: 'text-brand-600' },
              ].map((m, i) => (
                <div key={i} className="px-2 py-2.5">
                  <p className={`text-lg font-semibold tabular-nums ${m.color}`}>{m.value}</p>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 mt-0.5">{m.label}</p>
                </div>
              ))}
            </div>

            <div className="relative">
              <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input className="input pl-9 text-sm" placeholder="Code or patient name" value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Status</p>
              <ul className="-mx-1.5 space-y-px">
                {[
                  ['all', 'All codes', hospitalIds.length],
                  ['available', 'Available', available.length],
                  ['used', 'Used', used.length],
                ].map(([key, label, n]) => {
                  const active = statusFilter === key
                  return (
                    <li key={key}>
                      <button onClick={() => setStatusFilter(key)} aria-current={active ? 'true' : undefined}
                        className={`flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-left text-[13px] transition-colors ${active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                        <span>{label}</span>
                        <span className={`tabular-nums text-xs ${active ? 'text-brand-600' : 'text-gray-400'}`}>{n}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>

            {isSuperAdmin && (
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Next code</p>
                <p className="font-mono text-sm font-semibold text-gray-800">CRMC-{new Date().getFullYear()}-{String(nextNum).padStart(5, '0')}</p>
              </div>
            )}

            <button onClick={() => { setSearch(''); setStatusFilter('all') }} disabled={!isFiltered}
              className={`text-xs font-medium underline underline-offset-2 ${isFiltered ? 'text-gray-500 hover:text-brand-600' : 'text-gray-300 cursor-default'}`}>
              Clear filters
            </button>
          </aside>

          {/* ── Code stream, grouped by status ── */}
          <div className="min-w-0">
            <p className="text-xs text-gray-400 mb-3">{filtered.length} code{filtered.length !== 1 ? 's' : ''}{isFiltered ? ` of ${hospitalIds.length}` : ''}</p>

            <div className="card overflow-hidden">
              {loading && (
                <div className="divide-y divide-gray-50">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3.5 animate-pulse">
                      <div className="h-3 bg-gray-100 rounded w-40" />
                      <div className="h-5 bg-gray-100 rounded-full w-16 ml-auto" />
                    </div>
                  ))}
                </div>
              )}

              {!loading && statusGroups.map(group => (
                <section key={group.key}>
                  <div className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-gray-100 bg-gray-50/95 px-4 py-2 backdrop-blur">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-700">{group.label}</h3>
                    <span className="ml-auto text-[11px] text-gray-400 tabular-nums">{group.entries.length} {group.entries.length === 1 ? 'code' : 'codes'}</span>
                  </div>
                  <ul className="divide-y divide-gray-50">
                    {group.entries.map(h => {
                      const isDeleting = confirmDelete?.id === h.id
                      const isRevoking = confirmRevoke?.id === h.id
                      const isUsed     = h.status === 'used'
                      return (
                        <li key={h.id}>
                          <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                            <span className="font-mono text-sm text-gray-700 flex-shrink-0">{h.id}</span>
                            <span className={`badge text-xs flex-shrink-0 ${isUsed ? 'badge-blue' : 'badge-green'}`}>{isUsed ? 'Used' : 'Available'}</span>
                            <div className="flex-1 min-w-0 text-sm text-gray-600 truncate">
                              {isUsed ? <>{h.usedBy || '—'}{h.patId && <span className="ml-1.5 font-mono text-xs text-gray-400">{h.patId}</span>}</> : <span className="text-gray-300">Unclaimed</span>}
                            </div>
                            <span className="text-xs text-gray-400 flex-shrink-0 hidden sm:block">{fmtDate(h.createdAt)}</span>
                            {isSuperAdmin ? (
                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                {isUsed && (
                                  <button title="Reset to Available (revoke from current patient)" className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors" onClick={() => setConfirmRevoke(h)}><MdRefresh size={15} /></button>
                                )}
                                <button title="Delete code" className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" onClick={() => setConfirmDelete(h)}><MdDelete size={15} /></button>
                              </div>
                            ) : <span className="text-xs text-gray-300 flex-shrink-0">View only</span>}
                          </div>
                          {isRevoking && (
                            <div className="flex items-center gap-3 border-t border-amber-100 bg-amber-50 px-4 py-3">
                              <MdWarning size={16} className="text-amber-500 flex-shrink-0" />
                              <p className="text-sm text-amber-800 flex-1">Reset <strong className="font-mono">{h.id}</strong> to Available? <span className="font-normal">Currently linked to <strong>{h.usedBy ?? '—'}</strong>. They lose access; the code returns to the pool. Their profile remains; only the hospitalId link is cleared.</span></p>
                              <button className="text-xs text-gray-500 border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50 flex-shrink-0" onClick={() => setConfirmRevoke(null)}>Cancel</button>
                              <button className="text-xs text-white bg-amber-500 px-3 py-1.5 rounded-lg hover:bg-amber-600 flex-shrink-0" onClick={async () => { await handleRevoke(h); setConfirmRevoke(null) }}>Reset to Available</button>
                            </div>
                          )}
                          {isDeleting && (
                            <div className="flex items-center gap-3 border-t border-red-100 bg-red-50 px-4 py-3">
                              <MdWarning size={16} className="text-red-500 flex-shrink-0" />
                              <p className="text-sm text-red-700 flex-1">Delete <strong className="font-mono">{h.id}</strong>?{isUsed && <span className="font-normal"> Linked to <strong>{h.usedBy}</strong> — their hospital ID will be cleared from their profile.</span>}</p>
                              <button className="text-xs text-gray-500 border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50 flex-shrink-0" onClick={() => setConfirmDelete(null)}>Cancel</button>
                              <button className="text-xs text-white bg-red-500 px-3 py-1.5 rounded-lg hover:bg-red-600 flex-shrink-0" onClick={() => handleDelete(h)}>Delete</button>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}

              {!loading && filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <MdSearch size={32} className="text-gray-200 mb-2" />
                  <p className="text-sm text-gray-400">{search || statusFilter !== 'all' ? 'No codes match your filter.' : 'No access codes yet.'}</p>
                  {(search || statusFilter !== 'all') ? (
                    <button onClick={() => { setSearch(''); setStatusFilter('all') }} className="mt-3 inline-flex items-center text-sm font-medium text-brand-500 hover:text-brand-600">Clear filters</button>
                  ) : isSuperAdmin && (
                    <button onClick={() => setShowBulkAdd(true)} className="mt-3 btn-primary text-sm inline-flex items-center gap-1.5"><MdAdd size={15} /> Generate codes</button>
                  )}
                </div>
              )}
            </div>
          </div>{/* /code stream */}
        </div>{/* /two-pane grid */}

        {/* Bulk add modal */}
        {showBulkAdd && (
          <BulkAddModal nextNum={nextNum} onClose={() => setShowBulkAdd(false)} />
        )}
      </div>
    </Layout>
  )
}
