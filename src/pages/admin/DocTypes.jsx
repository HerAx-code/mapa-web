import Layout from '../../components/Layout'
import { useState, useEffect, Fragment } from 'react'
import {
  collection, onSnapshot, addDoc, deleteDoc, updateDoc,
  doc, serverTimestamp, writeBatch, getDocs, query, where, getCountFromServer,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { notify } from '../../utils/notifications'
import { logAudit } from '../../utils/auditLog'
import { useAuth } from '../../contexts/AuthContext'
import { MdAdd, MdDelete, MdDescription, MdSearch, MdEdit, MdClose, MdWarning } from 'react-icons/md'
import toast from 'react-hot-toast'

// ── Helpers ───────────────────────────────────────────────────────────────

const notifyAllAdmins = async (notification) => {
  try {
    const snap = await getDocs(query(collection(db, 'users'), where('role', 'in', ['super_admin', 'staff_admin'])))
    for (const d of snap.docs) await notify(d.id, notification)
  } catch (e) { console.error(e) }
}

// ── Add / Edit Modal ──────────────────────────────────────────────────────

function TypeForm({ type, maxOrder, allTypes, onClose }) {
  const isEdit    = !!type
  const { user }  = useAuth()
  const [form, setForm] = useState({
    name:        type?.name        ?? '',
    description: type?.description ?? '',
    required:    type?.required    ?? false,
    // Reusable docs (Valid ID) carry across a patient's future requests once
    // verified; per-request docs (Billing Statement) must be re-submitted.
    reusable:    type?.reusable    ?? false,
  })
  const [saving, setSaving] = useState(false)
  const set = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.value }))

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required.'); return }

    // Duplicate name check
    const duplicate = allTypes.find(t =>
      t.name.toLowerCase().trim() === form.name.toLowerCase().trim() &&
      t.id !== type?.id
    )
    if (duplicate) { toast.error(`"${form.name.trim()}" already exists.`); return }

    setSaving(true)
    try {
      if (isEdit) {
        await updateDoc(doc(db, 'documentTypes', type.id), {
          name:        form.name.trim(),
          description: form.description.trim(),
          required:    form.required,
          reusable:    form.reusable,
          updatedAt:   serverTimestamp(),
        })
        await notifyAllAdmins({
          type:  'doctype_updated',
          title: 'Document type updated',
          body:  `"${form.name.trim()}" has been updated by the administrator.`,
        })
        logAudit(user, { action: 'doctype_updated', targetType: 'documentType', targetName: form.name.trim(), details: 'Document type updated' })
        toast.success('Document type updated.')
      } else {
        await addDoc(collection(db, 'documentTypes'), {
          name:        form.name.trim(),
          description: form.description.trim(),
          required:    form.required,
          reusable:    form.reusable,
          order:       maxOrder + 1,
          createdAt:   serverTimestamp(),
        })
        await notifyAllAdmins({
          type:  'doctype_added',
          title: 'New document type added',
          body:  `"${form.name.trim()}" added as a ${form.required ? 'required' : 'optional'} document type.`,
        })
        logAudit(user, { action: 'doctype_added', targetType: 'documentType', targetName: form.name.trim(), details: `Added as ${form.required ? 'required' : 'optional'}` })
        toast.success('Document type added.')
      }
      onClose()
    } catch (err) { console.error(err); toast.error('Failed to save.') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? 'Edit Document Type' : 'Add Document Type'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Document Name <span className="text-red-400">*</span>
            </label>
            <input className="input" placeholder="e.g. Valid ID"
              value={form.name} onChange={set('name')} autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
            <input className="input" placeholder="Brief description of this document..."
              value={form.description} onChange={set('description')} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input type="checkbox" className="w-4 h-4 accent-brand-500"
              checked={form.required}
              onChange={e => setForm(p => ({ ...p, required: e.target.checked }))} />
            Mark as required document
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input type="checkbox" className="w-4 h-4 accent-brand-500 mt-0.5"
              checked={form.reusable}
              onChange={e => setForm(p => ({ ...p, reusable: e.target.checked }))} />
            <span>Reusable across requests
              <span className="block text-xs text-gray-400">Once verified, carries over to the patient's future requests (e.g. Valid ID). Leave off for per-request documents like a Billing Statement.</span>
            </span>
          </label>
        </div>
        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Document Type'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function DocTypes() {
  const { user }                        = useAuth()
  const isSuperAdmin                    = user?.role === 'super_admin'
  const [types, setTypes]               = useState([])
  const [docCounts, setDocCounts]       = useState({})
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [reqFilter, setReqFilter]       = useState('all')
  const [showForm, setShowForm]         = useState(false)
  const [editingType, setEditingType]   = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [selected, setSelected]         = useState(new Set())
  const [bulkDeleting,       setBulkDeleting]       = useState(false)
  const [removingDuplicates, setRemovingDuplicates] = useState(false)

  // Load document types sorted by order
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'documentTypes'), async (snap) => {
      let list = snap.docs.map(d => ({ id: d.id, ...d.data() }))

      // Initialize order field if missing
      const needsOrder = list.some(t => t.order === undefined)
      if (needsOrder) {
        const batch = writeBatch(db)
        list.forEach((t, i) => {
          if (t.order === undefined)
            batch.update(doc(db, 'documentTypes', t.id), { order: i })
        })
        await batch.commit()
        list = list.map((t, i) => ({ ...t, order: t.order ?? i }))
      }

      setTypes(list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))
      setLoading(false)
    }, (err) => {
      setLoading(false)
      console.error('[DocTypes] types snapshot error:', err)
      toast.error('Failed to load document types.')
    })
    return unsub
  }, [])

  // Count documents per type using getCountFromServer — no document data transferred
  useEffect(() => {
    if (types.length === 0) return
    const fetchCounts = async () => {
      const results = {}
      await Promise.all(types.map(async t => {
        const snap = await getCountFromServer(
          query(collection(db, 'documents'), where('documentTypeId', '==', t.id))
        )
        results[t.id] = snap.data().count
      }))
      setDocCounts(results)
    }
    fetchCounts()
  }, [types])

  // ── Reorder ──────────────────────────────────────────────────────────

  const handleMove = async (index, direction) => {
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= filtered.length) return
    const curr = filtered[index]
    const swap = filtered[swapIndex]
    const batch = writeBatch(db)
    batch.update(doc(db, 'documentTypes', curr.id), { order: swap.order ?? swapIndex })
    batch.update(doc(db, 'documentTypes', swap.id), { order: curr.order ?? index })
    await batch.commit()
  }

  // ── Delete single ─────────────────────────────────────────────────────

  const handleDelete = async (type) => {
    await deleteDoc(doc(db, 'documentTypes', type.id))
    await notifyAllAdmins({
      type:  'doctype_deleted',
      title: 'Document type removed',
      body:  `"${type.name}" has been removed from accepted document types.`,
    })
    setConfirmDelete(null)
    setSelected(prev => { const n = new Set(prev); n.delete(type.id); return n })
    logAudit(user, { action: 'doctype_deleted', targetType: 'documentType', targetName: type.name, details: 'Document type permanently removed' })
    toast.success(`"${type.name}" removed.`)
  }

  // ── Bulk delete ───────────────────────────────────────────────────────

  const handleBulkDelete = async () => {
    setBulkDeleting(true)
    const batch = writeBatch(db)
    const names = []
    for (const id of selected) {
      batch.delete(doc(db, 'documentTypes', id))
      const t = types.find(t => t.id === id)
      if (t) names.push(t.name)
    }
    await batch.commit()
    await notifyAllAdmins({
      type:  'doctype_deleted',
      title: `${selected.size} document type${selected.size !== 1 ? 's' : ''} removed`,
      body:  `Removed: ${names.join(', ')}.`,
    })
    setSelected(new Set())
    setBulkDeleting(false)
    logAudit(user, { action: 'doctype_deleted', targetType: 'documentType', targetName: names.join(', '), details: `Bulk deleted ${names.length} document type${names.length !== 1 ? 's' : ''}` })
    toast.success(`${names.length} document type${names.length !== 1 ? 's' : ''} deleted.`)
  }

  // ── Select ───────────────────────────────────────────────────────────

  const toggleSelect = (id) =>
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const selectAll = () =>
    setSelected(selected.size === filtered.length && filtered.length > 0
      ? new Set()
      : new Set(filtered.map(t => t.id))
    )

  // ── Filter ───────────────────────────────────────────────────────────

  const filtered = types.filter(t => {
    if (reqFilter === 'required' && !t.required) return false
    if (reqFilter === 'optional' &&  t.required) return false
    return !search ||
      t.name?.toLowerCase().includes(search.toLowerCase()) ||
      t.description?.toLowerCase().includes(search.toLowerCase())
  })

  const maxOrder = types.length > 0 ? Math.max(...types.map(t => t.order ?? 0)) : 0

  // Detect duplicate names
  const nameCounts = types.reduce((acc, t) => {
    const key = t.name.toLowerCase().trim()
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
  const duplicateNames = new Set(
    Object.entries(nameCounts).filter(([, c]) => c > 1).map(([n]) => n)
  )
  const hasDuplicates = duplicateNames.size > 0

  const handleRemoveDuplicates = async () => {
    setRemovingDuplicates(true)
    try {
      const groups = {}
      types.forEach(t => {
        const key = t.name.toLowerCase().trim()
        if (!groups[key]) groups[key] = []
        groups[key].push(t)
      })
      const toDelete = []
      Object.values(groups).forEach(group => {
        if (group.length <= 1) return
        const sorted = [...group].sort((a, b) =>
          (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0)
        )
        toDelete.push(...sorted.slice(1))
      })
      if (toDelete.length === 0) { toast.success('No duplicates found.'); return }
      const batch = writeBatch(db)
      toDelete.forEach(t => batch.delete(doc(db, 'documentTypes', t.id)))
      await batch.commit()
      logAudit(user, {
        action: 'doctype_deleted', targetType: 'documentType',
        targetName: toDelete.map(t => t.name).join(', '),
        details: `Removed ${toDelete.length} duplicate document type${toDelete.length !== 1 ? 's' : ''}`,
      })
      toast.success(`${toDelete.length} duplicate${toDelete.length !== 1 ? 's' : ''} removed. One of each type kept.`)
    } catch {
      toast.error('Failed to remove duplicates.')
    } finally {
      setRemovingDuplicates(false)
    }
  }

  return (
    <Layout breadcrumb="Document Types">
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="eyebrow">Configuration</p>
            <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Document Types</h1>
            <p className="text-sm text-gray-500 mt-1">Manage accepted document types for patient submissions.</p>
          </div>
          {isSuperAdmin && (
            <button className="btn-primary flex items-center gap-1.5"
              onClick={() => { setEditingType(null); setShowForm(true) }}>
              <MdAdd size={16} /> Add Type
            </button>
          )}
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 mb-5">
          {[
            { label: 'Total Types', value: types.length,                      color: 'text-gray-800' },
            { label: 'Required',    value: types.filter(t => t.required).length, color: 'text-red-500'  },
            { label: 'Optional',    value: types.filter(t => !t.required).length, color: 'text-gray-500' },
          ].map((m, i) => (
            <div key={i} className="card p-4">
              <p className="text-xs text-gray-400 mb-1">{m.label}</p>
              <p className={`text-3xl font-semibold ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>

        {/* Duplicate alert */}
        {hasDuplicates && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-3 mb-5">
            <MdWarning size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-xs text-red-700">
              <strong>Duplicate document types detected:</strong>{' '}
              {[...duplicateNames].map(n => `"${n}"`).join(', ')}.
              {' '}Duplicates appear multiple times in patients' upload dropdowns. The oldest entry of each name will be kept.
            </div>
            <button
              className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors disabled:opacity-60"
              onClick={handleRemoveDuplicates}
              disabled={removingDuplicates}>
              {removingDuplicates ? 'Removing...' : 'Remove Duplicates'}
            </button>
          </div>
        )}

        {/* Search + Filter */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input className="input pl-9" placeholder="Search document types..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-1">
            {[['all', 'All'], ['required', 'Required'], ['optional', 'Optional']].map(([key, label]) => (
              <button key={key} onClick={() => setReqFilter(key)}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  reqFilter === key
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Bulk action bar — Super Admin only */}
        {isSuperAdmin && selected.size > 0 && (
          <div className="flex items-center gap-3 mb-4 px-4 py-2.5 bg-brand-50 border border-brand-100 rounded-xl">
            <span className="text-sm text-brand-700 font-medium">{selected.size} selected</span>
            <button onClick={handleBulkDelete} disabled={bulkDeleting}
              className="flex items-center gap-1.5 text-xs text-red-500 border border-red-200 bg-white px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors ml-auto">
              <MdDelete size={14} /> {bulkDeleting ? 'Deleting...' : `Delete ${selected.size} selected`}
            </button>
            <button onClick={() => setSelected(new Set())}
              className="text-xs text-gray-500 hover:text-gray-700">
              <MdClose size={16} />
            </button>
          </div>
        )}

        {/* Reorder hint */}
        {!search && reqFilter === 'all' && types.length > 1 && (
          <p className="text-xs text-gray-400 mb-3">
            Use ▲ ▼ to reorder how document types appear to patients.
          </p>
        )}

        {/* Table */}
        <div className="card overflow-hidden">
          <table className="data-table w-full">
            <thead>
              <tr>
                <th className="w-10">
                  <input type="checkbox" className="w-4 h-4 accent-brand-500"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={selectAll} />
                </th>
                <th className="w-14">Order</th>
                <th>Document Type</th>
                <th>Description</th>
                <th>Required</th>
                <th>Usage</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td><div className="w-4 h-4 bg-gray-100 rounded" /></td>
                  <td><div className="h-6 bg-gray-100 rounded w-6" /></td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-gray-100 rounded flex-shrink-0" />
                      <div className="h-3 bg-gray-100 rounded w-32" />
                    </div>
                  </td>
                  <td><div className="h-3 bg-gray-100 rounded w-40" /></td>
                  <td><div className="h-5 bg-gray-100 rounded-full w-16" /></td>
                  <td><div className="h-3 bg-gray-100 rounded w-12" /></td>
                  <td><div className="h-6 bg-gray-100 rounded w-14" /></td>
                </tr>
              ))}
              {!loading && filtered.map((t, i) => {
                const usage       = docCounts[t.id] ?? 0
                const isDeleting  = confirmDelete?.id === t.id
                const isSelected  = selected.has(t.id)
                const isFirst     = i === 0
                const isLast      = i === filtered.length - 1
                const canReorder  = !search && reqFilter === 'all'
                const isDuplicate = duplicateNames.has(t.name.toLowerCase().trim())

                return (
                  <Fragment key={t.id}>
                    <tr className={
                      isDuplicate ? 'bg-red-50'
                      : isSelected ? 'bg-brand-50/40' : ''
                    }>
                      {/* Checkbox */}
                      <td onClick={() => toggleSelect(t.id)}>
                        <input type="checkbox" className="w-4 h-4 accent-brand-500"
                          checked={isSelected} onChange={() => {}} />
                      </td>

                      {/* Order */}
                      <td>
                        <div className="flex flex-col gap-0.5">
                          <button disabled={isFirst || !canReorder}
                            onClick={() => handleMove(i, 'up')}
                            className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-20 disabled:cursor-not-allowed leading-none px-1">▲</button>
                          <button disabled={isLast || !canReorder}
                            onClick={() => handleMove(i, 'down')}
                            className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-20 disabled:cursor-not-allowed leading-none px-1">▼</button>
                        </div>
                      </td>

                      {/* Name */}
                      <td>
                        <div className="flex items-center gap-2">
                          <MdDescription size={16} className="text-brand-500 flex-shrink-0" />
                          <p className="font-medium text-gray-800 text-sm">
                            {t.name}
                            {isDuplicate && (
                              <span className="ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">
                                Duplicate
                              </span>
                            )}
                          </p>
                        </div>
                      </td>

                      {/* Description */}
                      <td className="text-xs text-gray-500">{t.description || '—'}</td>

                      {/* Required */}
                      <td>
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className={`badge text-xs ${t.required ? 'badge-red' : 'badge-gray'}`}>
                            {t.required ? 'Required' : 'Optional'}
                          </span>
                          {t.reusable && <span className="badge badge-blue text-xs">Reusable</span>}
                        </div>
                      </td>

                      {/* Usage */}
                      <td>
                        {usage > 0
                          ? <span className="text-xs text-gray-600 font-medium">{usage} doc{usage !== 1 ? 's' : ''}</span>
                          : <span className="text-xs text-gray-300">—</span>
                        }
                      </td>

                      {/* Actions */}
                      <td>
                        {isSuperAdmin ? (
                          <div className="flex items-center gap-1">
                            <button title="Edit"
                              className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                              onClick={() => { setEditingType(t); setShowForm(true) }}>
                              <MdEdit size={15} />
                            </button>
                            <button title="Delete"
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                              onClick={() => setConfirmDelete(t)}>
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
                        <td colSpan={7} className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <MdWarning size={16} className="text-red-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-red-700">
                                Delete <strong>"{t.name}"</strong>?
                                {usage > 0 && (
                                  <span className="ml-1 font-normal text-red-600">
                                    {usage} patient document{usage !== 1 ? 's' : ''} uploaded under this type will be unclassified.
                                  </span>
                                )}
                              </p>
                            </div>
                            <button className="text-xs text-gray-500 border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50 flex-shrink-0"
                              onClick={() => setConfirmDelete(null)}>Cancel</button>
                            <button className="text-xs text-white bg-red-500 px-3 py-1.5 rounded-lg hover:bg-red-600 flex-shrink-0"
                              onClick={() => handleDelete(t)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12">
                    <MdDescription size={36} className="text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">
                      {search || reqFilter !== 'all'
                        ? 'No document types match your filter.'
                        : 'No document types yet. Click "Add Type" to create one.'}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Form modal */}
        {showForm && (
          <TypeForm
            type={editingType}
            maxOrder={maxOrder}
            allTypes={types}
            onClose={() => { setShowForm(false); setEditingType(null) }}
          />
        )}
      </div>
    </Layout>
  )
}
