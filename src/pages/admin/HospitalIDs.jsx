import Layout from '../../components/Layout'
import { useState, useEffect, Fragment } from 'react'
import { MdSearch, MdAdd, MdDelete, MdRefresh, MdClose, MdWarning } from 'react-icons/md'
import { useAuth } from '../../contexts/AuthContext'
import { logAudit } from '../../utils/auditLog'
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../../firebase'
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
          status:    'available',
          usedBy:    null,
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
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function HospitalIDs() {
  const [hospitalIds,    setHospitalIds]    = useState([])
  const [loading,        setLoading]        = useState(true)
  const [statusFilter,   setStatusFilter]   = useState('all')
  const [search,         setSearch]         = useState('')
  const [showBulkAdd,    setShowBulkAdd]    = useState(false)
  const [confirmDelete,  setConfirmDelete]  = useState(null)
  const { user }      = useAuth()
  const isSuperAdmin  = user?.role === 'super_admin'

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'hospitalIds'), (snap) => {
      setHospitalIds(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => b.id.localeCompare(a.id))
      )
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

  // ── Actions ──────────────────────────────────────────────────────────

  const handleAddOne = async () => {
    try {
      const year  = new Date().getFullYear()
      const num   = String(nextNum).padStart(5, '0')
      const newId = `CRMC-${year}-${num}`
      await setDoc(doc(db, 'hospitalIds', newId), {
        status:    'available',
        usedBy:    null,
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
      const batch = writeBatch(db)
      batch.update(doc(db, 'hospitalIds', h.id), {
        status:    'available',
        usedBy:    null,
        patId:     null,
        date:      '',
        time:      '',
        revokedAt: serverTimestamp(),
      })
      if (h.patId) batch.update(doc(db, 'users', h.patId), { hospitalId: null })
      await batch.commit()
      logAudit(user, { action: 'hospitalid_revoked', targetType: 'hospitalId', targetId: h.id, targetName: h.id, details: `Previously used by ${h.usedBy ?? '—'}` })
      toast.success(`${h.id} reset to Available.`)
    } catch (err) { console.error(err); toast.error('Failed to reset Hospital ID. Please try again.') }
  }

  const handleDelete = async (h) => {
    try {
      // Atomic: delete the hospital ID doc + clear the user's hospitalId
      // field together. Previously these were two sequential updateDocs --
      // if deleteDoc failed after the user update, the patient was orphaned
      // from a code that still existed.
      const batch = writeBatch(db)
      if (h.patId) batch.update(doc(db, 'users', h.patId), { hospitalId: null })
      batch.delete(doc(db, 'hospitalIds', h.id))
      await batch.commit()
      logAudit(user, { action: 'hospitalid_deleted', targetType: 'hospitalId', targetId: h.id, targetName: h.id, details: h.usedBy ? `Was used by ${h.usedBy}` : 'Was available' })
      setConfirmDelete(null)
      toast.success(`${h.id} deleted.`)
    } catch (err) { console.error(err); toast.error('Failed to delete Hospital ID. Please try again.') }
  }

  return (
    <Layout breadcrumb="Patient Access Codes">
      <div className="p-4 sm:p-6">

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="page-title">Patient Access Codes</h1>
            <p className="page-sub">Generate and issue access codes for patients to register on the portal.</p>
          </div>
          <div className="flex gap-2">
            {isSuperAdmin && (
              <>
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

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 mb-5">
          {[
            { label: 'Total Codes', value: hospitalIds.length, color: 'text-gray-800',  filterKey: 'all'       },
            { label: 'Available', value: available.length,   color: 'text-green-600', filterKey: 'available' },
            { label: 'Used',      value: used.length,        color: 'text-brand-600', filterKey: 'used'      },
          ].map((m) => (
            <button key={m.filterKey}
              className={`card p-4 text-left w-full transition-colors hover:bg-gray-50 ${statusFilter === m.filterKey ? 'ring-2 ring-brand-400' : ''}`}
              onClick={() => setStatusFilter(statusFilter === m.filterKey ? 'all' : m.filterKey)}>
              <p className="text-xs text-gray-400 mb-1">{m.label}</p>
              <p className={`text-3xl font-semibold ${m.color}`}>{m.value}</p>
            </button>
          ))}
        </div>

        {/* Next ID preview — Super Admin only */}
        {isSuperAdmin && (
          <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 mb-5 flex items-center gap-2">
            <span className="text-xs text-gray-500">Next code to be generated:</span>
            <span className="font-mono text-sm font-semibold text-gray-800">
              CRMC-{new Date().getFullYear()}-{String(nextNum).padStart(5, '0')}
            </span>
          </div>
        )}

        {/* Status filter chips */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <span className="text-xs text-gray-400 flex-shrink-0">Status</span>
          {[
            { key: 'all',       label: 'All'       },
            { key: 'available', label: 'Available' },
            { key: 'used',      label: 'Used'      },
          ].map(f => (
            <button key={f.key}
              onClick={() => setStatusFilter(statusFilter === f.key && f.key !== 'all' ? 'all' : f.key)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                statusFilter === f.key
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input className="input pl-9 pr-10" placeholder="Search by access code or patient name..."
            value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
              <MdClose size={14} />
            </button>
          )}
        </div>

        {/* Table */}
        <div className="card overflow-x-auto">
          <table className="data-table min-w-full">
            <thead>
              <tr>
                <th>Access Code</th>
                <th>Status</th>
                <th>Used By</th>
                <th>Patient ID</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td><div className="h-3 bg-gray-100 rounded w-36 font-mono" /></td>
                  <td><div className="h-5 bg-gray-100 rounded-full w-20" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-28" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-24" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-20" /></td>
                  <td><div className="h-6 bg-gray-100 rounded w-16" /></td>
                </tr>
              ))}

              {!loading && filtered.map(h => {
                const isDeleting = confirmDelete?.id === h.id
                const isUsed     = h.status === 'used'

                return (
                  <Fragment key={h.id}>
                    <tr>
                      <td className="font-mono text-sm text-gray-700">{h.id}</td>
                      <td>
                        <span className={`badge text-xs ${isUsed ? 'badge-blue' : 'badge-green'}`}>
                          {isUsed ? 'Used' : 'Available'}
                        </span>
                      </td>
                      <td className="text-sm text-gray-700">{h.usedBy || '—'}</td>
                      <td className="text-xs text-gray-400 font-mono">{h.patId || '—'}</td>
                      <td className="text-xs text-gray-400">{fmtDate(h.createdAt)}</td>
                      <td>
                        {isSuperAdmin ? (
                          <div className="flex items-center gap-1">
                            {isUsed && (
                              <button
                                title="Reset to Available"
                                className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
                                onClick={() => handleRevoke(h)}>
                                <MdRefresh size={15} />
                              </button>
                            )}
                            <button
                              title="Delete ID"
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                              onClick={() => setConfirmDelete(h)}>
                              <MdDelete size={15} />
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">View only</span>
                        )}
                      </td>
                    </tr>

                    {/* Delete confirmation row */}
                    {isDeleting && (
                      <tr className="bg-red-50">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <MdWarning size={16} className="text-red-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-red-700">
                                Delete <strong className="font-mono">{h.id}</strong>?
                                {isUsed && (
                                  <span className="ml-1 font-normal">
                                    This ID is currently linked to <strong>{h.usedBy}</strong>. Their hospital ID will be cleared from their profile.
                                  </span>
                                )}
                              </p>
                            </div>
                            <button
                              className="text-xs text-gray-500 border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50 flex-shrink-0"
                              onClick={() => setConfirmDelete(null)}>Cancel</button>
                            <button
                              className="text-xs text-white bg-red-500 px-3 py-1.5 rounded-lg hover:bg-red-600 flex-shrink-0"
                              onClick={() => handleDelete(h)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8">
                    <p className="text-sm text-gray-400">
                      {search ? 'No IDs match your search.' : 'No hospital IDs found.'}
                    </p>
                    {search ? (
                      <button
                        onClick={() => setSearch('')}
                        className="mt-3 inline-flex items-center text-sm font-medium text-brand-500 hover:text-brand-600">
                        Clear search
                      </button>
                    ) : isSuperAdmin && (
                      <button
                        onClick={() => setShowBulkAdd(true)}
                        className="mt-3 btn-primary text-sm inline-flex items-center gap-1.5">
                        <MdAdd size={15} /> Generate Hospital IDs
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Bulk add modal */}
        {showBulkAdd && (
          <BulkAddModal nextNum={nextNum} onClose={() => setShowBulkAdd(false)} />
        )}
      </div>
    </Layout>
  )
}
