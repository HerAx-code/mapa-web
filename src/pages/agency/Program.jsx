import Layout from '../../components/Layout'
import AgencyAvatar from '../../components/AgencyAvatar'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection, query, where, onSnapshot,
  doc, updateDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { logAudit } from '../../utils/auditLog'
import {
  MdLocationOn, MdPhone, MdSchedule, MdCheckCircle,
  MdFavorite, MdDescription, MdEmail, MdAccessTime,
  MdPerson, MdEdit, MdSave, MdClose, MdVisibility,
  MdVisibilityOff, MdLock, MdInfo, MdGroup,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import { tsToDate } from '../../utils/dates'

const formatDate = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }) : null
}

// ── Reusable editable field row ───────────────────────────────────────────

function EditableField({ icon: Icon, label, value, placeholder, onSave, multiline, disabled }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value ?? '')
  const [saving, setSaving]   = useState(false)

  useEffect(() => setDraft(value ?? ''), [value])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(draft.trim())
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-start gap-3">
      {Icon && <Icon size={16} className="text-gray-400 flex-shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400 mb-1">{label}</p>
        {!editing ? (
          <p className="text-sm text-gray-800 break-words">
            {value?.trim() ? value : <span className="text-gray-300 italic">{placeholder ?? 'Not set'}</span>}
          </p>
        ) : multiline ? (
          <textarea className="input text-sm w-full resize-none" rows={3}
            value={draft} maxLength={300}
            onChange={e => setDraft(e.target.value)} />
        ) : (
          <input className="input text-sm w-full"
            placeholder={placeholder ?? ''}
            value={draft}
            onChange={e => setDraft(e.target.value)} />
        )}
      </div>
      {!disabled && (
        !editing ? (
          <button className="text-xs text-brand-500 hover:text-brand-600 font-medium flex items-center gap-0.5 flex-shrink-0"
            onClick={() => { setDraft(value ?? ''); setEditing(true) }}>
            <MdEdit size={13} /> Edit
          </button>
        ) : (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button className="btn-primary text-xs px-2.5 py-1 flex items-center gap-0.5"
              onClick={handleSave} disabled={saving}>
              <MdSave size={12} /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn-secondary text-xs px-2.5 py-1"
              onClick={() => { setEditing(false); setDraft(value ?? '') }}>
              <MdClose size={12} />
            </button>
          </div>
        )
      )}
    </div>
  )
}

// ── Read-only field row ───────────────────────────────────────────────────

function ReadOnlyField({ icon: Icon, label, value, hint }) {
  return (
    <div className="bg-gray-50/60 rounded-xl px-4 py-3 flex items-start gap-3 border border-gray-100">
      {Icon && <Icon size={16} className="text-gray-400 flex-shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400 mb-1 flex items-center gap-1">
          {label}
          <MdLock size={10} className="text-gray-300" />
        </p>
        <p className="text-sm text-gray-700 break-words">{value || <span className="text-gray-300 italic">—</span>}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
    </div>
  )
}

// ── Patient-view preview ──────────────────────────────────────────────────

function PatientPreview({ agency }) {
  const slots = agency.slots ?? { total: 0, remaining: 0 }
  const slotPct = slots.total > 0 ? (slots.remaining / slots.total) : 0
  const slotsLabel = slots.remaining === 0 ? 'Full'
    : slotPct <= 0.25 ? 'Limited'
    : `${slots.remaining} slots`
  const slotBadgeCls = slots.remaining === 0 ? 'badge-red'
    : slotPct <= 0.25 ? 'badge-amber'
    : 'badge-green'

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <MdVisibility size={16} className="text-purple-500" />
        <p className="text-sm font-semibold text-gray-800">Patient's view</p>
        <span className="text-xs text-gray-400">— exactly what patients see on Medical Programs</span>
      </div>

      {/* Mock patient-side program card */}
      <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 bg-white">
        <div className="flex items-start gap-3">
          <AgencyAvatar agency={agency} className="w-12 h-12 rounded-xl text-base" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
              <h3 className="text-base font-bold text-gray-900">{agency.name}</h3>
              <span className={`badge ${slotBadgeCls} text-xs`}>{slotsLabel}</span>
            </div>
            {agency.description && (
              <p className="text-sm text-gray-600 leading-relaxed mb-2">{agency.description}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-gray-500">
              {agency.location && (
                <span className="flex items-center gap-1"><MdLocationOn size={12} /> {agency.location}</span>
              )}
              {agency.phone && (
                <span className="flex items-center gap-1"><MdPhone size={12} /> {agency.phone}</span>
              )}
              {agency.processingTime && (
                <span className="flex items-center gap-1"><MdSchedule size={12} /> {agency.processingTime}</span>
              )}
              {agency.officeHours && (
                <span className="flex items-center gap-1"><MdAccessTime size={12} /> {agency.officeHours}</span>
              )}
              {agency.publicEmail && (
                <span className="flex items-center gap-1"><MdEmail size={12} /> {agency.publicEmail}</span>
              )}
            </div>

            {agency.assistanceTypes?.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-gray-400 mb-1">Assistance types:</p>
                <div className="flex flex-wrap gap-1">
                  {agency.assistanceTypes.map((t, i) => (
                    <span key={i} className="badge badge-blue text-xs">{t}</span>
                  ))}
                </div>
              </div>
            )}

            {agency.requirements?.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-gray-400 mb-1">Required documents:</p>
                <ul className="space-y-0.5">
                  {agency.requirements.map((r, i) => (
                    <li key={i} className="flex items-start gap-1 text-xs text-gray-600">
                      <MdCheckCircle size={12} className="text-green-400 flex-shrink-0 mt-0.5" />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function AgencyProfile() {
  const { user }                    = useAuth()
  const navigate                    = useNavigate()
  const [agency, setAgency]         = useState(null)
  const [coordinators, setCoords]   = useState([])
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    if (!user?.agencyId) return
    const unsub = onSnapshot(doc(db, 'agencies', user.agencyId), snap => {
      if (snap.exists()) setAgency({ id: snap.id, ...snap.data() })
      setLoading(false)
    }, () => { setLoading(false); toast.error('Failed to load agency profile.') })
    return unsub
  }, [user?.agencyId])

  useEffect(() => {
    if (!user?.agencyId) return
    const q = query(
      collection(db, 'users'),
      where('agencyId', '==', user.agencyId),
      where('role', '==', 'agency'),
    )
    const unsub = onSnapshot(q,
      snap => setCoords(snap.docs.map(d => ({ uid: d.id, ...d.data() }))),
      (err) => console.error('[Program] coordinators snapshot error:', err),
    )
    return unsub
  }, [user?.agencyId])

  const handleSaveField = (field, label) => async (newValue) => {
    if ((agency[field] ?? '') === newValue) return
    try {
      await updateDoc(doc(db, 'agencies', agency.id), {
        [field]:           newValue,
        profileUpdatedAt:  serverTimestamp(),
        profileUpdatedBy:  user.name,
      })
      logAudit(user, {
        action: 'agency_self_edit',
        targetType: 'agency',
        targetId:   agency.id,
        targetName: agency.name,
        details:    `Updated ${label}`,
      })
      toast.success(`${label} updated.`)
    } catch (err) {
      console.error(err)
      toast.error(`Failed to update ${label}.`)
    }
  }

  if (loading) return (
    <Layout breadcrumb="Agency Profile">
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="card p-5 animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-40 mb-3" />
            <div className="h-3 bg-gray-100 rounded w-64 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-48" />
          </div>
        ))}
      </div>
    </Layout>
  )

  if (!agency) return (
    <Layout breadcrumb="Agency Profile">
      <div className="p-4 sm:p-6 text-center text-sm text-gray-400">
        No agency profile found. Contact the administrator.
      </div>
    </Layout>
  )

  return (
    <Layout breadcrumb="Agency Profile">
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">

        {/* Header */}
        <div className="mb-5 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="eyebrow">Public profile</p>
            <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Agency Profile</h1>
            <p className="text-sm text-gray-500 mt-1">Manage the information patients see about your agency.</p>
          </div>
        </div>

        {/* Split: editable / info cards on the left; a live patient-view preview
            pinned on the right so edits read as patients will see them. On mobile
            the preview stacks on top. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] gap-5 items-start">

          {/* Right — live patient preview */}
          <aside className="order-1 lg:order-2 lg:sticky lg:top-[68px]">
            <PatientPreview agency={agency} />
          </aside>

          {/* Left — the editable / info cards */}
          <div className="order-2 lg:order-1 min-w-0">

        {/* Agency identity card (read-only — admin sets) */}
        <div className="card p-5 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <MdInfo size={16} className="text-gray-400" />
            <p className="text-sm font-semibold text-gray-800">Identity</p>
            <span className="text-xs text-gray-400">— set by system administrator</span>
          </div>
          <div className="flex items-center gap-4 mb-4">
            <AgencyAvatar agency={agency} className="w-14 h-14 rounded-2xl text-lg" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-gray-900">{agency.name}</h2>
                <span className={`badge text-xs ${agency.enabled ? 'badge-green' : 'badge-red'}`}>
                  {agency.enabled ? 'Active' : 'Disabled'}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Agency name, branding, and active status can only be changed by the administrator.
              </p>
            </div>
          </div>
        </div>

        {/* Editable: Public info */}
        <div className="card p-5 mb-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <MdEdit size={16} className="text-brand-500" />
              <p className="text-sm font-semibold text-gray-800">Public information</p>
              <span className="text-xs text-gray-400">— you can edit this</span>
            </div>
            {agency.profileUpdatedAt && (
              <span className="text-xs text-gray-400">
                Last edited {agency.profileUpdatedBy ? `by ${agency.profileUpdatedBy} ` : ''}on {formatDate(agency.profileUpdatedAt)}
              </span>
            )}
          </div>

          <div className="space-y-2">
            <EditableField
              icon={MdDescription} label="Description" multiline
              value={agency.description}
              placeholder="Brief description of what your agency does (max 300 chars)"
              onSave={handleSaveField('description', 'Description')}
            />
            <EditableField
              icon={MdLocationOn} label="Location"
              value={agency.location}
              placeholder="e.g. CRMC Ground Floor, Cotabato City"
              onSave={handleSaveField('location', 'Location')}
            />
            <EditableField
              icon={MdPhone} label="Phone"
              value={agency.phone}
              placeholder="e.g. 064-421-2500"
              onSave={handleSaveField('phone', 'Phone')}
            />
            <EditableField
              icon={MdEmail} label="Public contact email"
              value={agency.publicEmail}
              placeholder="e.g. malasakit@crmc.gov.ph"
              onSave={handleSaveField('publicEmail', 'Public email')}
            />
            <EditableField
              icon={MdSchedule} label="Processing time"
              value={agency.processingTime}
              placeholder="e.g. Same Day, 3–5 Days"
              onSave={handleSaveField('processingTime', 'Processing time')}
            />
            <EditableField
              icon={MdAccessTime} label="Office hours"
              value={agency.officeHours}
              placeholder="e.g. Mon–Fri, 8:00 AM – 5:00 PM"
              onSave={handleSaveField('officeHours', 'Office hours')}
            />
          </div>
        </div>

        {/* Editable: Default signatory */}
        <div className="card p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <MdPerson size={16} className="text-brand-500" />
            <p className="text-sm font-semibold text-gray-800">Default conducting social worker</p>
          </div>
          <p className="text-xs text-gray-500 mb-3 leading-relaxed">
            Pre-fills the "Conducting Social Worker" field when scheduling interviews. This name also appears as the signatory on printed Guarantee Letters when no other interviewer is recorded.
          </p>
          <EditableField
            icon={MdPerson} label="Default signatory"
            value={agency.defaultSignatory}
            placeholder={`Leave blank to use the current logged-in coordinator (${user.name})`}
            onSave={handleSaveField('defaultSignatory', 'Default signatory')}
          />
        </div>

        {/* Read-only: System-managed catalog */}
        <div className="card p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <MdLock size={14} className="text-gray-400" />
            <p className="text-sm font-semibold text-gray-800">System-managed catalog</p>
            <span className="text-xs text-gray-400">— set by administrator</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ReadOnlyField
              icon={MdDescription} label="Document requirements"
              hint={`${agency.requirements?.length ?? 0} required document${agency.requirements?.length === 1 ? '' : 's'}`}
              value={
                agency.requirements?.length > 0
                  ? agency.requirements.join(' · ')
                  : null
              }
            />
            <ReadOnlyField
              icon={MdFavorite} label="Assistance types"
              hint={`${agency.assistanceTypes?.length ?? 0} type${agency.assistanceTypes?.length === 1 ? '' : 's'} offered`}
              value={
                agency.assistanceTypes?.length > 0
                  ? agency.assistanceTypes.join(' · ')
                  : null
              }
            />
          </div>
          <p className="text-xs text-gray-400 mt-3 leading-relaxed">
            To change document requirements or assistance types, ask the administrator. These tie into the patient application form and certificate templates.
          </p>
        </div>

        {/* Coordinators (read-only) */}
        <div className="card p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <MdGroup size={16} className="text-gray-400" />
            <p className="text-sm font-semibold text-gray-800">Coordinators</p>
            <span className="text-xs text-gray-400">{coordinators.length} linked account{coordinators.length === 1 ? '' : 's'}</span>
          </div>
          {coordinators.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No coordinator accounts linked to this agency.</p>
          ) : (
            <div className="space-y-2">
              {coordinators.map(c => {
                const isMe = c.uid === user.uid
                const isActive = c.active !== false
                return (
                  <div key={c.uid} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${isActive ? 'bg-gray-50' : 'bg-red-50/40'}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${isActive ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
                      {c.name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">
                        {c.name} {isMe && <span className="text-xs text-gray-400">(you)</span>}
                      </p>
                      <p className="text-xs text-gray-400 truncate">{c.email}</p>
                    </div>
                    {!isActive && <span className="badge badge-red text-xs">Deactivated</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="card p-4 bg-blue-50/40 border-blue-100">
          <p className="text-xs text-blue-700 leading-relaxed">
            <strong>Need to change something locked?</strong> Use <strong>Report a Problem</strong> in the user menu, or message your system administrator directly. Slot capacity changes are on the <button className="underline" onClick={() => navigate('/agency/slots')}>Slot Management</button> page.
          </p>
        </div>

          </div>{/* /left column */}
        </div>{/* /split grid */}

      </div>
    </Layout>
  )
}
