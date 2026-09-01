import Layout from '../../components/Layout'
import AgencyAvatar from '../../components/AgencyAvatar'
import AgencyCapacityOverview from '../../components/admin/AgencyCapacityOverview'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, onSnapshot, doc, updateDoc, deleteDoc, addDoc, serverTimestamp, query, where, getDocs, orderBy } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import { logAudit } from '../../utils/auditLog'
import { getOrCreateConversation } from '../../utils/messages'
import AddressPicker from '../../components/AddressPicker'
import {
  MdLocationOn, MdPhone, MdEdit, MdDelete, MdAdd,
  MdRefresh, MdClose, MdWarning, MdSearch, MdMessage, MdPerson,
  MdArrowUpward, MdArrowDownward,
} from 'react-icons/md'
import toast from 'react-hot-toast'

// ── Notification helpers ──────────────────────────────────────────────────

const notifyAgencyUser = async (agencyId, notification) => {
  try {
    const snap = await getDocs(
      query(collection(db, 'users'), where('agencyId', '==', agencyId), where('role', '==', 'agency'))
    )
    for (const d of snap.docs) await notify(d.id, notification)
  } catch (e) { console.error('notifyAgencyUser:', e) }
}

const notifyAllAdmins = async (notification) => {
  try {
    const snap = await getDocs(
      query(collection(db, 'users'), where('role', 'in', ['super_admin', 'staff_admin']))
    )
    for (const d of snap.docs) await notify(d.id, notification)
  } catch (e) { console.error('notifyAllAdmins:', e) }
}

// ── Color options ─────────────────────────────────────────────────────────

export const COLORS = [
  { value: 'bg-brand-500',  label: 'Teal'   },
  { value: 'bg-purple-600', label: 'Purple' },
  { value: 'bg-red-600',    label: 'Red'    },
  { value: 'bg-blue-600',   label: 'Blue'   },
  { value: 'bg-amber-600',  label: 'Amber'  },
  { value: 'bg-pink-600',   label: 'Pink'   },
  { value: 'bg-indigo-600', label: 'Indigo' },
  { value: 'bg-green-600',  label: 'Green'  },
]

const EMPTY_FORM = {
  name: '', initials: '', color: 'bg-brand-500',
  description: '', phone: '', procedure: '',
  processingTime: 'Same Day', slotsTotal: 25,
  logoUrl: '',
  // R32: structured location replaces the single free-text field.
  // `location` is derived ("{officeName}, {city}") + saved on submit
  // so old readers (agency cards, search filter, etc.) keep working.
  province: '', city: '', officeName: '',
}

// ── Agency Modal ──────────────────────────────────────────────────────────

export function AgencyModal({ agency, onClose, onSave }) {
  const isEdit = !!agency
  const [form, setForm] = useState(
    isEdit ? {
      name:           agency.name,
      initials:       agency.initials,
      color:          agency.color,
      description:    agency.description,
      phone:          agency.phone,
      procedure:      agency.procedure ?? '',
      processingTime: agency.processingTime,
      slotsTotal:     agency.slots?.total ?? 25,
      logoUrl:        agency.logoUrl ?? '',
      // R32: existing agencies were saved with a single legacy `location`
      // string. On first edit, structured fields start empty and the
      // operator picks them; the previous string is shown as helper
      // text below so they have a reference.
      province:       agency.province   ?? '',
      city:           agency.city       ?? '',
      officeName:     agency.officeName ?? '',
    } : { ...EMPTY_FORM }
  )
  const [selectedTypes, setSelectedTypes] = useState(new Set(agency?.assistanceTypes ?? []))
  const [selectedReqs,  setSelectedReqs]  = useState(new Set(agency?.requirements ?? []))
  const [typesList,     setTypesList]     = useState([])
  const [docTypesList,  setDocTypesList]  = useState([])
  const [saving,        setSaving]        = useState(false)
  const set = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }))

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, 'assistanceTypes'), orderBy('order', 'asc'))),
      getDocs(query(collection(db, 'documentTypes'),   orderBy('order', 'asc'))),
    ]).then(([typesSnap, docsSnap]) => {
      setTypesList(typesSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setDocTypesList(docsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    }).catch(() => {})
  }, [])

  const toggleType = (name) =>
    setSelectedTypes(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })

  const toggleReq = (name) =>
    setSelectedReqs(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })

  // R32: derive the legacy `location` string from structured fields.
  const derivedLocation = [form.officeName?.trim(), form.city]
    .filter(Boolean)
    .join(', ')

  const handleSave = async () => {
    if (!form.name.trim())     { toast.error('Agency name is required.'); return }
    if (!form.initials.trim()) { toast.error('Initials are required.'); return }
    if (!form.province)        { toast.error('Province is required.'); return }
    if (!form.city)            { toast.error('City / Municipality is required.'); return }
    if (form.slotsTotal < 1)   { toast.error('Daily slots must be at least 1.'); return }
    // Logo URL is optional but, if provided, must be HTTPS. Local file
    // uploads are blocked by the Spark plan (Cloud Storage not available);
    // external HTTPS URLs are the only path today.
    const logoUrl = form.logoUrl.trim()
    if (logoUrl && !/^https:\/\//.test(logoUrl)) {
      toast.error('Logo URL must start with https://')
      return
    }
    setSaving(true)
    try {
      await onSave({
        name:            form.name.trim(),
        initials:        form.initials.trim().toUpperCase().slice(0, 3),
        color:           form.color,
        description:     form.description.trim(),
        // R32: save both structured + derived.
        province:        form.province,
        city:            form.city,
        officeName:      form.officeName.trim(),
        location:        derivedLocation,
        phone:           form.phone.trim(),
        procedure:       form.procedure.trim(),
        processingTime:  form.processingTime.trim(),
        requirements:    [...selectedReqs],
        assistanceTypes: [...selectedTypes],
        // Empty string -> null so an unset logo doesn't accidentally
        // match {merge:true} writes elsewhere.
        logoUrl:         logoUrl || null,
        slots: {
          total:     Number(form.slotsTotal),
          remaining: isEdit ? agency.slots?.remaining ?? Number(form.slotsTotal) : Number(form.slotsTotal),
        },
        enabled: isEdit ? agency.enabled : true,
      })
      toast.success(isEdit ? 'Agency updated.' : 'Agency added.')
      onClose()
    } catch (err) { console.error(err); toast.error('Failed to save agency.') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{isEdit ? 'Edit Agency' : 'Add New Agency'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
            {/* Preview reflects what the avatar will look like after save -
                including the live logo URL so the operator catches a typo
                / broken image before committing. */}
            <AgencyAvatar
              agency={{
                name:     form.name || 'Agency Name',
                initials: form.initials || '??',
                color:    form.color,
                logoUrl:  form.logoUrl.trim() || null,
              }}
              className="w-12 h-12 rounded-xl text-sm"
            />
            <div>
              <p className="text-sm font-semibold text-gray-800">{form.name || 'Agency Name'}</p>
              <p className="text-xs text-gray-400">{derivedLocation || 'Location'}</p>
            </div>
          </div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Basic Info</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Agency Name <span className="text-red-400">*</span></label>
              <input className="input" placeholder="Malasakit Center" value={form.name} onChange={set('name')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Initials <span className="text-red-400">*</span></label>
              <input className="input" placeholder="MC" maxLength={3} value={form.initials} onChange={set('initials')} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
            <textarea className="input resize-none" rows={2} placeholder="Brief description..."
              value={form.description} onChange={set('description')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Procedure / Instructions for Patients</label>
            <textarea className="input resize-none" rows={2}
              placeholder="What the patient must do once endorsed (e.g. bring valid ID + this GL to the PCSO desk, window 3)..."
              value={form.procedure} onChange={set('procedure')} />
            <p className="text-xs text-gray-400 mt-1">Shown to patients when they're endorsed to this agency.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">Avatar Color</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button key={c.value} type="button"
                  onClick={() => setForm(f => ({ ...f, color: c.value }))}
                  className={`w-7 h-7 rounded-lg ${c.value} border-2 transition-all ${form.color === c.value ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                  title={c.label} />
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">Used as the avatar background when no logo is set.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Logo URL <span className="text-gray-400 font-normal">— optional</span></label>
            <input className="input" type="url" inputMode="url"
              placeholder="https://your-agency.gov.ph/logo.png"
              value={form.logoUrl} onChange={set('logoUrl')} />
            <p className="text-xs text-gray-400 mt-1">
              HTTPS link to your official logo (PNG / SVG / JPG). Replaces the
              colored initials avatar everywhere. Leave blank to keep using
              initials. A broken URL automatically falls back to initials.
            </p>
          </div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Contact & Location</p>
          {/* R32 (refactored R39): shared AddressPicker -- same component
              the patient registration, Account Settings, and AddAgency
              forms now use. Barangay is intentionally hidden; the office's
              fine-grained location is the "Office / Building" field. */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2 flex items-center gap-1">
              <MdLocationOn size={12} className="text-gray-400" /> Office Location <span className="text-red-400">*</span>
            </label>
            <AddressPicker
              showBarangay={false}
              value={{ province: form.province, city: form.city, barangay: '' }}
              onChange={({ province, city }) =>
                setForm(p => ({ ...p, province, city }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-1"><MdLocationOn size={12} className="text-gray-400" /> Office / Building <span className="text-gray-400 font-normal">— optional</span></label>
              <input className="input" placeholder="CRMC Ground Floor"
                value={form.officeName} onChange={set('officeName')} />
              {/* On edit, surface the legacy free-text location so the
                  operator can see what was there before. Only relevant
                  when migrating from the old single-field schema. */}
              {isEdit && agency.location && !agency.city && (
                <p className="text-xs text-amber-600 mt-0.5">Previously: {agency.location}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-1"><MdPhone size={12} className="text-gray-400" /> Phone</label>
              <input className="input" placeholder="064-421-2500" value={form.phone} onChange={set('phone')} />
            </div>
          </div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Operations</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Processing Time</label>
              <select className="input" value={form.processingTime} onChange={set('processingTime')}>
                {['Same Day', '1–2 Days', '3–5 Days', '5–7 Days', '1–2 Weeks'].map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Daily Slot Capacity</label>
              <input type="number" className="input" min={1} max={500} value={form.slotsTotal} onChange={set('slotsTotal')} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">Requirements</label>
            {docTypesList.length === 0 ? (
              <p className="text-xs text-gray-400 italic">
                No document types defined. Add them in the Document Types page first.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {docTypesList.map(t => (
                  <label key={t.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer select-none transition-colors">
                    <input type="checkbox" className="w-4 h-4 accent-brand-500 flex-shrink-0"
                      checked={selectedReqs.has(t.name)}
                      onChange={() => toggleReq(t.name)} />
                    <span className="text-xs text-gray-700">{t.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">Assistance Types</label>
            {typesList.length === 0 ? (
              <p className="text-xs text-gray-400 italic">
                No assistance types defined. Add them in the Assistance Types page first.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {typesList.map(t => (
                  <label key={t.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer select-none transition-colors">
                    <input type="checkbox" className="w-4 h-4 accent-brand-500 flex-shrink-0"
                      checked={selectedTypes.has(t.name)}
                      onChange={() => toggleType(t.name)} />
                    <span className="text-xs text-gray-700">{t.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="px-5 pb-4 pt-2 flex gap-2 justify-end border-t border-gray-50 flex-shrink-0">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Agency'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function Agencies() {
  const navigate            = useNavigate()
  const { user }            = useAuth()
  const isSuperAdmin        = user?.role === 'super_admin'
  const [agencies,     setAgencies]     = useState([])
  const [appStats,     setAppStats]     = useState({})
  const [agencyUsers,  setAgencyUsers]  = useState([])
  const [loading,      setLoading]      = useState(true)
  const [modal, setModal]               = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [editSlots, setEditSlots]       = useState(null)
  const [newTotal, setNewTotal]         = useState(0)
  const [search, setSearch]             = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy]             = useState('name')
  const [sortDir, setSortDir]           = useState('asc')
  const [expanded, setExpanded]         = useState(new Set())

  const toggleExpand = (id) =>
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'agencies'), snap => {
      setAgencies(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, () => {
      setLoading(false)
      toast.error('Failed to load agencies. Please refresh the page.')
    })
    return unsub
  }, [])

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'agency')),
      snap => setAgencyUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() }))),
      () => {}
    )
    return unsub
  }, [])

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'applications'), snap => {
      const stats = {}
      snap.docs.forEach(d => {
        const { agencyId, status } = d.data()
        if (!agencyId) return
        if (!stats[agencyId]) stats[agencyId] = { total: 0, approved: 0, rejected: 0, pending: 0 }
        stats[agencyId].total++
        if (status === 'approved' || status === 'certificate') stats[agencyId].approved++
        else if (status === 'rejected') stats[agencyId].rejected++
        else stats[agencyId].pending++
      })
      setAppStats(stats)
    }, () => {})
    return unsub
  }, [])

  // ── Action handlers ──────────────────────────────────────────────────

  const toggleEnabled = async (agency) => {
    try {
      const nowEnabled = !agency.enabled
      await updateDoc(doc(db, 'agencies', agency.id), { enabled: nowEnabled })
      await notifyAgencyUser(agency.id, {
        type:  nowEnabled ? 'agency_enabled' : 'agency_disabled',
        title: nowEnabled ? 'Agency Enabled' : 'Agency Disabled',
        body:  nowEnabled
          ? `${agency.name} has been re-enabled. You are now accepting patient applications.`
          : `${agency.name} has been disabled. Patient applications are temporarily suspended.`,
      })
      logAudit(user, { action: nowEnabled ? 'agency_enabled' : 'agency_disabled', targetType: 'agency', targetId: agency.id, targetName: agency.name, details: `Agency ${nowEnabled ? 're-enabled' : 'disabled'}` })
      toast.success(`${agency.name} ${nowEnabled ? 'enabled' : 'disabled'}.`)
    } catch (err) { console.error(err); toast.error('Failed to update agency status. Please try again.') }
  }

  const handleSaveSlots = async (agency) => {
    if (newTotal < 1) { toast.error('Must be at least 1.'); return }
    try {
      await updateDoc(doc(db, 'agencies', agency.id), { 'slots.total': newTotal })
      await notifyAgencyUser(agency.id, {
        type: 'agency_updated', title: 'Slot Capacity Updated',
        body: `Daily slot capacity updated from ${agency.slots?.total ?? '?'} to ${newTotal} by the administrator.`,
      })
      logAudit(user, { action: 'agency_updated', targetType: 'agency', targetId: agency.id, targetName: agency.name, details: `Slot capacity changed to ${newTotal}` })
      setEditSlots(null)
      toast.success('Slot capacity updated.')
    } catch (err) { console.error(err); toast.error('Failed to update slot capacity. Please try again.') }
  }

  const handleResetSlots = async (agency) => {
    try {
      const total = agency.slots?.total ?? 25
      await updateDoc(doc(db, 'agencies', agency.id), { 'slots.remaining': total })
      await notifyAgencyUser(agency.id, {
        type: 'agency_updated', title: 'Slots Manually Reset',
        body: `Slots for ${agency.name} were manually reset to ${total} outside the normal midnight cycle.`,
      })
      toast.success(`Slots reset to ${total}.`)
    } catch (err) { console.error(err); toast.error('Failed to reset slots. Please try again.') }
  }

  const handleDelete = async (id) => {
    try {
      const agency = agencies.find(a => a.id === id)
      await deleteDoc(doc(db, 'agencies', id))
      await notifyAllAdmins({
        type: 'agency_deleted', title: 'Agency Deleted',
        body: `"${agency?.name}" has been permanently deleted from the portal.`,
      })
      logAudit(user, { action: 'agency_deleted', targetType: 'agency', targetId: id, targetName: agency?.name, details: 'Agency permanently deleted' })
      setConfirmDelete(null)
      toast.success('Agency deleted.')
    } catch (err) { console.error(err); toast.error('Failed to delete agency. Please try again.') }
  }

  const handleSaveAgency = async (data) => {
    if (typeof modal === 'object' && modal !== null) {
      await updateDoc(doc(db, 'agencies', modal.id), { ...data, updatedAt: serverTimestamp() })
      logAudit(user, { action: 'agency_updated', targetType: 'agency', targetId: modal.id, targetName: data.name, details: 'Agency details updated' })
    } else {
      const ref = await addDoc(collection(db, 'agencies'), { ...data, createdAt: serverTimestamp() })
      await notifyAllAdmins({
        type: 'new_agency', title: 'New Agency Added',
        body: `"${data.name}" has been registered as a new medical assistance agency.`,
      })
      logAudit(user, { action: 'agency_created', targetType: 'agency', targetId: ref.id, targetName: data.name, details: 'New agency registered' })
    }
  }

  const handleMessageAgency = async (agency) => {
    try {
      const snap = await getDocs(
        query(collection(db, 'users'), where('agencyId', '==', agency.id), where('role', '==', 'agency'))
      )
      if (snap.empty) { toast.error('No user account linked to this agency.'); return }
      const agencyUser = { uid: snap.docs[0].id, ...snap.docs[0].data() }
      await getOrCreateConversation(user.uid, agencyUser.uid, {
        names:   { [user.uid]: user.name, [agencyUser.uid]: agencyUser.name },
        roles:   { [user.uid]: user.role, [agencyUser.uid]: 'agency' },
        subject: `Admin Message — ${agency.name}`,
      })
      navigate('/admin/messages')
      toast.success('Conversation opened in Messages.')
    } catch (err) { console.error(err); toast.error('Failed to open conversation.') }
  }

  // ── Filter + Sort ────────────────────────────────────────────────────

  const filtered = agencies
    .filter(a => {
      if (statusFilter === 'active'   && !a.enabled) return false
      if (statusFilter === 'disabled' &&  a.enabled) return false
      if (statusFilter === 'funded'   && (a.budget?.allocated ?? 0) === 0) return false
      if (statusFilter === 'unfunded' && (a.budget?.allocated ?? 0) > 0)   return false
      const q = search.toLowerCase()
      return !q || a.name?.toLowerCase().includes(q) || a.location?.toLowerCase().includes(q)
    })
    .sort((a, b) => {
      // Base comparator is always ascending; sortDir flips it. This keeps
      // the asc/desc toggle consistent across every sort key.
      let cmp = 0
      if (sortBy === 'name')   cmp = (a.name ?? '').localeCompare(b.name ?? '')
      else if (sortBy === 'status') cmp = (a.enabled ? 1 : 0) - (b.enabled ? 1 : 0)
      else if (sortBy === 'slots') {
        const pctA = a.slots?.total ? ((a.slots.total - a.slots.remaining) / a.slots.total) : 0
        const pctB = b.slots?.total ? ((b.slots.total - b.slots.remaining) / b.slots.total) : 0
        cmp = pctA - pctB
      }
      else if (sortBy === 'apps') cmp = (appStats[a.id]?.total ?? 0) - (appStats[b.id]?.total ?? 0)
      return sortDir === 'asc' ? cmp : -cmp
    })

  // ── Helpers ──────────────────────────────────────────────────────────

  const usedSlots  = (a) => (a.slots?.total ?? 0) - (a.slots?.remaining ?? 0)
  const slotPct    = (a) => a.slots?.total > 0 ? Math.round((usedSlots(a) / a.slots.total) * 100) : 0
  const barColor   = (p) => p >= 100 ? 'bg-red-400' : p >= 75 ? 'bg-amber-400' : 'bg-brand-500'

  // Map agencyId → array of linked user accounts
  const coordinatorMap = agencyUsers.reduce((acc, u) => {
    if (!u.agencyId) return acc
    if (!acc[u.agencyId]) acc[u.agencyId] = []
    acc[u.agencyId].push(u)
    return acc
  }, {})

  return (
    <Layout breadcrumb="Agencies">
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="eyebrow">Directory</p>
            <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Agencies</h1>
            <p className="text-sm text-gray-500 mt-1">Manage and monitor all registered medical assistance agencies.</p>
          </div>
          {isSuperAdmin && (
            <button className="btn-primary flex items-center gap-1.5" onClick={() => navigate('/admin/agencies/new')}>
              <MdAdd size={16} /> Add Agency
            </button>
          )}
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
          {[
            { label: 'Total Agencies', value: agencies.length,                                                            color: 'text-gray-800',  filterKey: 'all'      },
            { label: 'Active',         value: agencies.filter(a => a.enabled).length,                                     color: 'text-green-600', filterKey: 'active'   },
            { label: 'Funded',         value: agencies.filter(a => (a.budget?.allocated ?? 0) > 0).length,                color: 'text-blue-600',  filterKey: 'funded'   },
            { label: 'Unfunded',       value: agencies.filter(a => (a.budget?.allocated ?? 0) === 0).length,              color: 'text-amber-600', filterKey: 'unfunded' },
          ].map((m) => (
            <button key={m.filterKey}
              className={`card p-4 text-left w-full transition-colors hover:bg-gray-50 ${statusFilter === m.filterKey ? 'ring-2 ring-brand-400' : ''}`}
              onClick={() => setStatusFilter(statusFilter === m.filterKey ? 'all' : m.filterKey)}>
              <p className="text-xs text-gray-400 mb-1">{m.label}</p>
              <p className={`text-3xl font-semibold ${m.color}`}>{m.value}</p>
            </button>
          ))}
        </div>

        {/* Fund-capacity overview — program-wide budget utilisation + the
            agencies whose funds are nearly exhausted (Magic Patterns adoption). */}
        <AgencyCapacityOverview agencies={agencies} />

        {/* Search + Filter + Sort */}
        <div className="flex gap-3 mb-5 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input className="input pl-9" placeholder="Search by name or location..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-1 flex-wrap">
            {[['all', 'All'], ['active', 'Active'], ['disabled', 'Disabled'], ['funded', 'Funded'], ['unfunded', 'No budget']].map(([key, label]) => (
              <button key={key} onClick={() => setStatusFilter(key)}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${statusFilter === key ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <select className="input w-40" value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="name">Sort: Name</option>
              <option value="status">Sort: Status</option>
              <option value="slots">Sort: Slot Usage</option>
              <option value="apps">Sort: Applications</option>
            </select>
            <button
              type="button"
              onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
              title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
              aria-label={sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}
              className="px-2.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors flex items-center justify-center flex-shrink-0">
              {sortDir === 'asc' ? <MdArrowUpward size={16} /> : <MdArrowDownward size={16} />}
            </button>
          </div>
        </div>

        {loading && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gray-100 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-gray-100 rounded w-40" />
                    <div className="h-2.5 bg-gray-100 rounded w-56" />
                  </div>
                  <div className="h-5 bg-gray-100 rounded-full w-16" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Agency cards — 2-column grid on wide screens so the list fills the
            width and shows twice as many agencies at a glance. */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
          {filtered.map(agency => {
            const stats          = appStats[agency.id]
            const appCount       = stats?.total ?? 0
            const isDeleting     = confirmDelete === agency.id
            const coordinators   = coordinatorMap[agency.id] ?? []
            const hasCoordinator = coordinators.length > 0
            const activeCoord    = coordinators.find(u => u.active !== false)

            return (
              <div key={agency.id} className={`card overflow-hidden ${!agency.enabled ? 'opacity-60' : ''}`}>

                {/* Clickable row → detail page */}
                <div className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors select-none"
                  onClick={() => navigate(`/admin/agencies/${agency.id}`)}>

                  <AgencyAvatar agency={agency} className="w-10 h-10 rounded-xl text-sm" />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-gray-800">{agency.name}</h3>
                      <span className={`badge text-xs ${agency.enabled ? 'badge-green' : 'badge-red'}`}>
                        {agency.enabled ? 'Active' : 'Disabled'}
                      </span>
                      {(agency.budget?.allocated ?? 0) > 0 ? (
                        <span className="badge badge-blue text-xs" title={`₱${(agency.budget?.allocated ?? 0).toLocaleString()} allocated this ${agency.budget?.period ?? 'period'}`}>
                          Funded
                        </span>
                      ) : (
                        <span className="badge badge-amber text-xs" title="Agency administrator has not allocated a budget yet">
                          No budget
                        </span>
                      )}
                      {appCount > 0 && (
                        <span className="badge badge-blue text-xs">
                          {appCount} app{appCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400 flex-wrap">
                      <span className="flex items-center gap-1"><MdLocationOn size={11} />{agency.location}</span>
                      <span className="flex items-center gap-1"><MdPhone size={11} />{agency.phone}</span>
                      <span>· {agency.processingTime}</span>
                      <span>· {agency.slots?.remaining ?? 0}/{agency.slots?.total ?? 0} slots</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      {!hasCoordinator ? (
                        <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                          <MdWarning size={12} /> No coordinator assigned
                        </span>
                      ) : activeCoord ? (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <MdPerson size={12} />
                          {coordinators.length === 1
                            ? activeCoord.name
                            : `${activeCoord.name} +${coordinators.length - 1} more`}
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 ml-0.5" />
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-red-400 font-medium">
                          <MdPerson size={12} /> {coordinators[0].name} — deactivated
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Quick actions — stop propagation so row click doesn't also fire */}
                  <div className="flex items-center gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    <button className="p-1.5 text-gray-400 hover:text-brand-500 hover:bg-brand-50 rounded-lg transition-colors" title="Message"
                      onClick={() => handleMessageAgency(agency)}><MdMessage size={16} /></button>
                    {isSuperAdmin && (
                      <>
                        <button
                          className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${agency.enabled ? 'border-red-200 text-red-500 hover:bg-red-50' : 'border-green-200 text-green-600 hover:bg-green-50'}`}
                          onClick={() => toggleEnabled(agency)}>
                          {agency.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Delete"
                          onClick={() => setConfirmDelete(agency.id)}><MdDelete size={16} /></button>
                      </>
                    )}
                  </div>
                </div>

                {/* Delete confirmation */}
                {isDeleting && (
                  <div className="border-t border-red-100 flex items-start gap-3 bg-red-50 px-5 py-3">
                    <MdWarning size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-red-700">Delete "{agency.name}"?</p>
                      <p className="text-xs text-red-500 mt-0.5">This cannot be undone. Patients will no longer see this agency.</p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button className="text-xs text-gray-500 border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50"
                        onClick={() => setConfirmDelete(null)}>Cancel</button>
                      <button className="text-xs text-white bg-red-500 px-3 py-1.5 rounded-lg hover:bg-red-600"
                        onClick={() => handleDelete(agency.id)}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {!loading && filtered.length === 0 && (
            <div className="card p-10 text-center xl:col-span-2">
              {search || statusFilter !== 'all'
            ? <MdSearch className="mx-auto mb-3 text-gray-300" size={32} />
            : <MdLocationOn className="mx-auto mb-3 text-gray-300" size={32} />}
              <p className="text-sm font-medium text-gray-600 mb-1">
                {search || statusFilter !== 'all' ? 'No agencies match your filter' : 'No agencies yet'}
              </p>
              <p className="text-xs text-gray-400 mb-4">
                {search || statusFilter !== 'all'
                  ? 'Try changing your search or filter.'
                  : 'Add your first agency or run the seed script.'}
              </p>
              {!search && statusFilter === 'all' && (
                <button className="btn-primary text-sm mx-auto" onClick={() => setModal('add')}>
                  <MdAdd size={15} className="inline mr-1" /> Add First Agency
                </button>
              )}
              {(search || statusFilter !== 'all') && (
                <button
                  onClick={() => { setSearch(''); setStatusFilter('all') }}
                  className="inline-flex items-center text-sm font-medium text-brand-500 hover:text-brand-600">
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>

        {modal && (
          <AgencyModal
            agency={modal === 'add' ? null : modal}
            onClose={() => setModal(null)}
            onSave={handleSaveAgency}
          />
        )}

      </div>
    </Layout>
  )
}
