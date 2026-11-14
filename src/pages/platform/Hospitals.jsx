import { useState, useEffect, useMemo, useRef } from 'react'
import { collection, query, where, onSnapshot, doc, getDoc, updateDoc, deleteField, serverTimestamp, writeBatch } from 'firebase/firestore'
import {
  MdAdd, MdEdit, MdClose, MdLocalHospital, MdPersonAdd, MdVisibility, MdVisibilityOff, MdBlock, MdCheckCircle,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import Layout from '../../components/Layout'
import ConfirmModal from '../../components/ConfirmModal'
import SearchableSelect from '../../components/ui/SearchableSelect'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { logAudit } from '../../utils/auditLog'
import { syncHospitalPublic } from '../../utils/hospitalsPublic'
import { createStaffAccount } from '../../utils/staffAccounts'
import { DEFAULT_HOSPITAL_ID } from '../../config/org'
import { agencyPartnersWith } from '../../utils/hospitals'
import {
  emptyHospitalForm, validateHospital, hospitalDocFromForm, normalizeHospitalId, HOSPITAL_FORM_FIELDS,
  normalizePrefix, suggestHospitalId,
} from '../../utils/hospitalConfig'

// Network operator view (multi-hospital Phase 6, docs/multi-hospital-network-plan.md).
// Onboard a hospital (its tenant doc + access-code prefix), edit it, and create
// its first administrator — after which that hospital's super admin runs its own
// staff from Admin Accounts. No patient data is read here: the rules deny the
// platform admin every hospital record.

function ModalShell({ title, labelId, onClose, children, footer }) {
  const panelRef = useRef(null)
  useEscapeKey(onClose)
  useFocusTrap(panelRef, true)
  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={labelId} tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden outline-none">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 id={labelId} className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-600"><MdClose size={20} /></button>
        </div>
        <div className="px-5 py-4 space-y-4 overflow-y-auto">{children}</div>
        <div className="px-5 py-3 flex gap-2 justify-end border-t border-gray-100">{footer}</div>
      </div>
    </div>
  )
}

function Field({ label, required, error, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {error
        ? <p className="text-xs text-red-500 mt-1">{error}</p>
        : hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}

function HospitalModal({ hospital, hospitals, onClose }) {
  const { user } = useAuth()
  const isEdit = !!hospital
  const [form, setForm] = useState(() => (isEdit ? { ...emptyHospitalForm(), ...hospital } : emptyHospitalForm()))
  const [idTouched, setIdTouched] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)

  const errors = validateHospital(form, hospitals, isEdit ? hospital.id : null)
  const err = (k) => (showErrors ? errors[k] : undefined)

  const set = (key) => (e) => {
    const value = e.target.value
    setForm((p) => {
      const next = { ...p, [key]: value }
      // Keep the ID following the name until the operator edits it by hand.
      if (key === 'facilityName' && !isEdit && !idTouched) next.id = suggestHospitalId(value)
      return next
    })
  }

  const handleSave = async () => {
    setShowErrors(true)
    if (Object.keys(errors).length) return
    setSaving(true)
    try {
      const data = hospitalDocFromForm(form)
      const id = isEdit ? hospital.id : form.id
      // Phase 8: a prefix is claimed once, network-wide (accessCodePrefixes),
      // in the same batch as the hospital — the rules require it. Retired
      // prefixes stay claimed, so check before writing for a clear message.
      const prefixChanged = !isEdit || data.accessCodePrefix !== hospital.accessCodePrefix
      let needClaim = false
      if (prefixChanged) {
        const claim = await getDoc(doc(db, 'accessCodePrefixes', data.accessCodePrefix))
        if (claim.exists() && claim.data().tenantId !== id) {
          toast.error(`The prefix ${data.accessCodePrefix} is reserved by another hospital (current or past codes).`)
          return
        }
        needClaim = !claim.exists()
      }
      const batch = writeBatch(db)
      if (needClaim) batch.set(doc(db, 'accessCodePrefixes', data.accessCodePrefix), { tenantId: id, createdAt: serverTimestamp() })
      if (isEdit) {
        // An optional field cleared in the form is removed, not left stale.
        const cleared = Object.fromEntries(HOSPITAL_FORM_FIELDS
          .filter((k) => !(k in data) && k in hospital)
          .map((k) => [k, deleteField()]))
        batch.update(doc(db, 'hospitals', id), { ...data, ...cleared, updatedAt: serverTimestamp() })
        await batch.commit()
        const after = { ...Object.fromEntries(Object.entries(hospital).filter(([k]) => !(k in cleared))), ...data }
        await syncHospitalPublic(id, after)
        logAudit(user, { action: 'hospital_updated', targetType: 'hospital', targetId: id, targetName: data.facilityName, details: prefixChanged ? `Hospital details updated (access-code prefix now ${data.accessCodePrefix})` : 'Hospital details updated' })
        toast.success('Hospital updated.')
      } else {
        batch.set(doc(db, 'hospitals', id), { ...data, enabled: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
        await batch.commit()
        await syncHospitalPublic(id, { ...data, enabled: true })
        logAudit(user, { action: 'hospital_created', targetType: 'hospital', targetId: id, targetName: data.facilityName, details: `Hospital onboarded (access codes ${data.accessCodePrefix}-YYYY-NNNNN)` })
        toast.success(`${data.facilityName} added. Next, create its first administrator.`)
      }
      onClose()
    } catch (e) {
      console.error(e)
      toast.error('Could not save the hospital. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title={isEdit ? `Edit ${hospital.facilityName || hospital.id}` : 'Add hospital'}
      labelId="hospital-modal-title"
      onClose={onClose}
      footer={<>
        <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
        <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add hospital'}
        </button>
      </>}>
      <Field label="Hospital name" required error={err('facilityName')}>
        <input className="input" placeholder="Cotabato Provincial Hospital" value={form.facilityName} onChange={set('facilityName')} />
      </Field>
      {!isEdit && (
        <Field label="Hospital ID" required error={err('id')}
          hint="Permanent — every record of this hospital carries it. Lowercase letters, digits, dashes.">
          <input className="input font-mono" value={form.id}
            onChange={(e) => { setIdTouched(true); setForm((p) => ({ ...p, id: normalizeHospitalId(e.target.value) })) }} />
        </Field>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Short name" hint="Shown under the brand, e.g. CPH.">
          <input className="input" value={form.shortName} onChange={set('shortName')} />
        </Field>
        <Field label="Access-code prefix" required error={err('accessCodePrefix')}
          hint={`Codes look like ${normalizePrefix(form.accessCodePrefix) || 'PREFIX'}-YYYY-NNNNN.`}>
          <input className="input font-mono uppercase" value={form.accessCodePrefix}
            onChange={(e) => setForm((p) => ({ ...p, accessCodePrefix: normalizePrefix(e.target.value) }))} />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem] gap-4">
        <Field label="Gateway office" required error={err('gatewayName')}>
          <input className="input" value={form.gatewayName} onChange={set('gatewayName')} />
        </Field>
        <Field label="Initials" error={err('gatewayInitials')}>
          <input className="input" value={form.gatewayInitials} onChange={set('gatewayInitials')} />
        </Field>
      </div>
      <Field label="Contact email" error={err('contactEmail')} hint="Where patients ask about access codes.">
        <input type="email" className="input" value={form.contactEmail} onChange={set('contactEmail')} />
      </Field>
      <Field label="Address">
        <input className="input" value={form.address} onChange={set('address')} />
      </Field>
      {isEdit && hospital.accessCodePrefix && normalizePrefix(form.accessCodePrefix) !== hospital.accessCodePrefix && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2.5">
          Changing the prefix affects new access codes only. Codes already issued keep their old prefix.
        </p>
      )}
    </ModalShell>
  )
}

function AdminModal({ hospital, onClose }) {
  const { user } = useAuth()
  const [form, setForm] = useState({ name: '', email: '', contact: '', role: 'super_admin', password: '', sendReset: true })
  const [showPw, setShowPw] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }))

  const handleSave = async () => {
    if (!form.name.trim() || !form.email.trim()) { toast.error('Name and email are required.'); return }
    if (form.password.length < 6) { toast.error('Temporary password must be at least 6 characters.'); return }
    setSaving(true)
    try {
      const uid = await createStaffAccount({
        email: form.email,
        password: form.password,
        sendReset: form.sendReset,
        profile: {
          name:     form.name.trim(),
          contact:  form.contact.trim(),
          role:     form.role,
          rank:     form.role === 'super_admin' ? 'high' : 'low',
          tenantId: hospital.id,
        },
      })
      logAudit(user, {
        action: 'account_created', targetType: 'account', targetId: uid, targetName: form.name.trim(),
        details: `${form.role === 'super_admin' ? 'Super Admin' : 'Staff Admin'} for ${hospital.facilityName || hospital.id}`,
      })
      toast.success(`${form.name.trim()} can now sign in to ${hospital.facilityName || hospital.id}.`)
      onClose()
    } catch (e) {
      console.error(e)
      if (e.code === 'auth/email-already-in-use') toast.error('This email is already registered.')
      else toast.error('Could not create the account. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title={`Add administrator — ${hospital.facilityName || hospital.id}`}
      labelId="hospital-admin-modal-title"
      onClose={onClose}
      footer={<>
        <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
        <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Creating…' : 'Create account'}
        </button>
      </>}>
      <Field label="Full name" required>
        <input className="input" value={form.name} onChange={set('name')} />
      </Field>
      <Field label="Email address" required>
        <input type="email" className="input" value={form.email} onChange={set('email')} />
      </Field>
      <Field label="Contact number">
        <input className="input" placeholder="09XXXXXXXXX" value={form.contact} onChange={set('contact')} />
      </Field>
      <Field label="Role" required hint="The hospital's super admin adds the rest of its staff from Admin Accounts.">
        <SearchableSelect
          value={form.role}
          onChange={(v) => setForm((p) => ({ ...p, role: v }))}
          options={[
            { value: 'super_admin', label: 'Super Admin' },
            { value: 'staff_admin', label: 'Staff Admin' },
          ]} />
      </Field>
      <Field label="Temporary password" required>
        <div className="relative">
          <input type={showPw ? 'text' : 'password'} className="input pr-10" placeholder="Min. 6 characters"
            value={form.password} onChange={set('password')} />
          <button type="button" aria-label={showPw ? 'Hide password' : 'Show password'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-600"
            onClick={() => setShowPw((p) => !p)}>
            {showPw ? <MdVisibilityOff size={16} /> : <MdVisibility size={16} />}
          </button>
        </div>
      </Field>
      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
        <input type="checkbox" className="w-4 h-4 accent-brand-500" checked={form.sendReset}
          onChange={(e) => setForm((p) => ({ ...p, sendReset: e.target.checked }))} />
        Send a password reset email to the new administrator
      </label>
    </ModalShell>
  )
}

export default function Hospitals() {
  const [hospitals, setHospitals] = useState([])
  const [staff, setStaff] = useState([])
  const [agencies, setAgencies] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)      // 'add' | hospital
  const [addingAdmin, setAddingAdmin] = useState(null)
  const [toggling, setToggling] = useState(null)     // hospital whose registrations to pause/resume
  const [busy, setBusy] = useState(false)
  const { user } = useAuth()

  // Phase 8: `enabled` gates NEW registrations with the hospital's codes
  // (rules + Register). Its staff and existing patients keep working.
  const handleToggle = async () => {
    const h = toggling
    const next = h.enabled === false
    setBusy(true)
    try {
      await updateDoc(doc(db, 'hospitals', h.id), { enabled: next, updatedAt: serverTimestamp() })
      await syncHospitalPublic(h.id, { ...h, enabled: next })
      logAudit(user, { action: 'hospital_updated', targetType: 'hospital', targetId: h.id, targetName: h.facilityName || h.id, details: next ? 'Registrations resumed' : 'Registrations paused' })
      toast.success(next ? 'Registrations resumed.' : 'Registrations paused.')
      setToggling(null)
    } catch (e) {
      console.error(e)
      toast.error('Could not update the hospital.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => onSnapshot(collection(db, 'hospitals'), (snap) => {
    setHospitals(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    setLoading(false)
  }, (e) => { console.error(e); setLoading(false); toast.error('Failed to load hospitals.') }), [])

  // Staff docs are operational (no patient data) and readable network-wide.
  useEffect(() => onSnapshot(
    query(collection(db, 'users'), where('role', 'in', ['super_admin', 'staff_admin'])),
    (snap) => setStaff(snap.docs.map((d) => d.data())),
    (e) => console.error('[Hospitals] staff snapshot error:', e),
  ), [])

  // Phase 7: how many enabled agencies each hospital can endorse to.
  useEffect(() => onSnapshot(collection(db, 'agencies'),
    (snap) => setAgencies(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (e) => console.error('[Hospitals] agencies snapshot error:', e),
  ), [])

  const staffByHospital = useMemo(() => {
    const m = {}
    for (const s of staff) {
      const t = s.tenantId || DEFAULT_HOSPITAL_ID   // pre-backfill staff are hospital #1
      if (!m[t]) m[t] = { super: 0, staff: 0 }
      if (s.role === 'super_admin') m[t].super++
      else m[t].staff++
    }
    return m
  }, [staff])

  const sorted = useMemo(() => [...hospitals].sort((a, b) =>
    (a.id === DEFAULT_HOSPITAL_ID ? -1 : b.id === DEFAULT_HOSPITAL_ID ? 1 : 0) ||
    String(a.facilityName || a.id).localeCompare(String(b.facilityName || b.id))), [hospitals])

  return (
    <Layout breadcrumb="Hospitals">
      <div className="w-full p-4 sm:p-6 max-w-[1100px] mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
          <div>
            <p className="eyebrow">Network</p>
            <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Hospitals</h1>
            <p className="text-sm text-gray-500 mt-1">
              Each hospital runs its own gateway, staff, patients and access codes. Agencies are shared across all of them.
            </p>
          </div>
          <button className="btn-primary flex items-center gap-1.5 self-start" onClick={() => setEditing('add')}>
            <MdAdd size={16} /> Add hospital
          </button>
        </div>

        {loading ? (
          <div className="card p-8 flex justify-center">
            <div className="w-8 h-8 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="card p-8 text-center">
            <MdLocalHospital size={28} className="mx-auto text-gray-300" />
            <p className="text-sm font-medium text-gray-700 mt-2">No hospitals yet</p>
            <p className="text-xs text-gray-500 mt-1">Run scripts/seed-default-hospital.mjs for hospital #1, or add one here.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {sorted.map((h) => {
              const counts = staffByHospital[h.id] ?? { super: 0, staff: 0 }
              const partnerCount = agencies.filter((a) => a.enabled !== false && agencyPartnersWith(a, h.id)).length
              return (
                <li key={h.id} className="card p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
                      <MdLocalHospital size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900">{h.facilityName || h.id}</p>
                        {h.shortName && <span className="text-xs text-gray-500">· {h.shortName}</span>}
                        {h.id === DEFAULT_HOSPITAL_ID && <span className="badge-gray text-[11px]">Hospital #1</span>}
                        {h.enabled === false && <span className="badge-red text-[11px]">Sign-ups paused</span>}
                      </div>
                      <dl className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-2 text-xs">
                        <div><dt className="text-gray-500">ID</dt><dd className="font-mono text-gray-800 truncate">{h.id}</dd></div>
                        <div><dt className="text-gray-500">Access codes</dt><dd className="font-mono text-gray-800">{h.accessCodePrefix ? `${h.accessCodePrefix}-…` : '—'}</dd></div>
                        <div><dt className="text-gray-500">Gateway</dt><dd className="text-gray-800 truncate">{h.gatewayName || '—'}</dd></div>
                        <div>
                          <dt className="text-gray-500">Administrators</dt>
                          <dd className={counts.super === 0 ? 'text-amber-700 font-medium' : 'text-gray-800'}>
                            {counts.super === 0 ? 'No super admin yet' : `${counts.super} super · ${counts.staff} staff`}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Partner agencies</dt>
                          <dd className={partnerCount === 0 ? 'text-amber-700 font-medium' : 'text-gray-800'}>
                            {partnerCount === 0 ? 'None — set under Agencies' : partnerCount}
                          </dd>
                        </div>
                      </dl>
                      {h.contactEmail && <p className="text-xs text-gray-500 mt-2 truncate">{h.contactEmail}{h.address ? ` · ${h.address}` : ''}</p>}
                    </div>
                    <div className="flex sm:flex-col gap-2 flex-shrink-0">
                      <button className="btn-secondary text-xs flex items-center gap-1 justify-center min-h-[36px]" onClick={() => setAddingAdmin(h)}>
                        <MdPersonAdd size={14} /> Add admin
                      </button>
                      <button className="btn-secondary text-xs flex items-center gap-1 justify-center min-h-[36px]" onClick={() => setEditing(h)}>
                        <MdEdit size={14} /> Edit
                      </button>
                      <button className="btn-secondary text-xs flex items-center gap-1 justify-center min-h-[36px]" onClick={() => setToggling(h)}>
                        {h.enabled === false
                          ? <><MdCheckCircle size={14} /> Resume sign-ups</>
                          : <><MdBlock size={14} /> Pause sign-ups</>}
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <p className="text-xs text-gray-500 mt-4">
          A hospital's gateway can endorse only to its partner agencies — set them on each agency's page. Per-hospital figures are on the Overview page. Patient records stay with each hospital and are never shown here.
        </p>
      </div>

      {editing && (
        <HospitalModal
          hospital={editing === 'add' ? null : editing}
          hospitals={hospitals}
          onClose={() => setEditing(null)} />
      )}
      {addingAdmin && <AdminModal hospital={addingAdmin} onClose={() => setAddingAdmin(null)} />}
      <ConfirmModal
        open={!!toggling}
        onClose={() => !busy && setToggling(null)}
        onConfirm={handleToggle}
        title={toggling?.enabled === false
          ? `Resume sign-ups at ${toggling?.facilityName || toggling?.id}?`
          : `Pause sign-ups at ${toggling?.facilityName || toggling?.id}?`}
        body={toggling?.enabled === false
          ? 'Patients can register with this hospital\'s access codes again.'
          : 'New patients can no longer register with this hospital\'s access codes. Its staff and existing patients are not affected.'}
        tone={toggling?.enabled === false ? 'primary' : 'danger'}
        confirmLabel={toggling?.enabled === false ? 'Resume' : 'Pause sign-ups'}
        confirmLabelBusy="Saving…"
      />
    </Layout>
  )
}
