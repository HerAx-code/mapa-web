import { useState, useEffect, useMemo, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useOnboardingRequests } from '../../hooks/useOnboardingRequests'
import { collection, query, where, onSnapshot, doc, getDoc, updateDoc, deleteField, serverTimestamp, writeBatch } from 'firebase/firestore'
import {
  MdAdd, MdEdit, MdClose, MdLocalHospital, MdPersonAdd, MdVisibility, MdVisibilityOff, MdBlock, MdCheckCircle, MdInbox,
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
import { tsToDate } from '../../utils/dates'
import { syncHospitalPublic } from '../../utils/hospitalsPublic'
import { createStaffAccount } from '../../utils/staffAccounts'
import { DEFAULT_HOSPITAL_ID } from '../../config/org'
import { agencyPartnersWith } from '../../utils/hospitals'
import { nextPartnerLists } from '../../utils/hospitalConfig'
import {
  emptyHospitalForm, validateHospital, hospitalDocFromForm, normalizeHospitalId, HOSPITAL_FORM_FIELDS,
  normalizePrefix, prefixFromInput, suggestHospitalId, PH_REGIONS,
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

// `initial` pre-fills a new hospital (from an onboarding request); `fromRequest`
// is that request's id, marked onboarded once the hospital exists.
// `agencies` = every agency (for the partner picker); `onCreated(hospital)` runs
// after a NEW hospital is saved, so the console can go straight to its first admin.
function HospitalModal({ hospital, hospitals, agencies = [], onClose, onCreated, initial = null, fromRequest = null }) {
  const { user } = useAuth()
  const isEdit = !!hospital
  const [form, setForm] = useState(() => (isEdit
    ? { ...emptyHospitalForm(), ...hospital }
    : { ...emptyHospitalForm(), ...(initial ?? {}), id: initial?.facilityName ? suggestHospitalId(initial.facilityName) : '' }))
  const [idTouched, setIdTouched] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  // Partner agencies — saved on each agency's partnerHospitalIds in the same
  // batch as the hospital, so a new hospital can endorse from day one.
  const enabledAgencies = agencies.filter((a) => a.enabled !== false)
  const [partners, setPartners] = useState(() => new Set(
    isEdit ? agencies.filter((a) => agencyPartnersWith(a, hospital.id)).map((a) => a.id) : []))
  const togglePartner = (id) => setPartners((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

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
      // Only agencies whose partnership with this hospital actually changes.
      const partnerChanges = nextPartnerLists(agencies, id, partners)
      for (const { agencyId, partnerHospitalIds } of partnerChanges) {
        batch.update(doc(db, 'agencies', agencyId), { partnerHospitalIds, updatedAt: serverTimestamp() })
      }
      if (isEdit) {
        // An optional field cleared in the form is removed, not left stale.
        const cleared = Object.fromEntries(HOSPITAL_FORM_FIELDS
          .filter((k) => !(k in data) && k in hospital)
          .map((k) => [k, deleteField()]))
        batch.update(doc(db, 'hospitals', id), { ...data, ...cleared, updatedAt: serverTimestamp() })
        await batch.commit()
        const after = { ...Object.fromEntries(Object.entries(hospital).filter(([k]) => !(k in cleared))), ...data }
        await syncHospitalPublic(id, after)
        logAudit(user, { action: 'hospital_updated', targetType: 'hospital', targetId: id, targetName: data.facilityName, details: [prefixChanged ? `Hospital details updated (access-code prefix now ${data.accessCodePrefix})` : 'Hospital details updated', partnerChanges.length ? `partner agencies: ${[...partners].join(', ') || 'none'}` : ''].filter(Boolean).join('; ') })
        toast.success('Hospital updated.')
      } else {
        // Onboarding (2026-11-15): a hospital set up from an onboarding record
        // starts with patient registration CLOSED; the go-live step in its
        // onboarding workspace opens it. Hospitals added directly stay open.
        const openNow = !fromRequest
        batch.set(doc(db, 'hospitals', id), {
          ...data, enabled: openNow, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          ...(fromRequest ? { onboarding: { stage: 'setup', requestId: fromRequest } } : {}),
        })
        await batch.commit()
        await syncHospitalPublic(id, { ...data, enabled: openNow })
        logAudit(user, { action: 'hospital_created', targetType: 'hospital', targetId: id, targetName: data.facilityName, details: `Hospital onboarded (access codes ${data.accessCodePrefix}-YYYY-NNNNN; partner agencies: ${[...partners].join(', ') || 'none yet'})` })
        if (fromRequest) {
          await updateDoc(doc(db, 'onboardingRequests', fromRequest), { status: 'onboarded', hospitalId: id, statusUpdatedAt: serverTimestamp() })
            .catch((err) => console.warn('[Hospitals] could not link the onboarding request:', err))
        }
        toast.success(`${data.facilityName} added. Next, create its first Hospital Admin.`)
        onClose()
        onCreated?.({ id, ...data, enabled: openNow })
        return
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
          hint={`Just the letters. Codes will look like ${normalizePrefix(form.accessCodePrefix) || 'CRMC'}-${new Date().getFullYear()}-00001.`}>
          {/* Only the prefix: typing or pasting a full code / the format
              ("CRMC-YYYY-NNNNN") keeps just "CRMC". */}
          <input className="input font-mono uppercase" value={form.accessCodePrefix} placeholder="e.g. CRMC" maxLength={10}
            onChange={(e) => setForm((p) => ({ ...p, accessCodePrefix: prefixFromInput(e.target.value) }))} />
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
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_11rem] gap-4">
        <Field label="Address">
          <input className="input" value={form.address} onChange={set('address')} />
        </Field>
        <Field label="Region">
          <input className="input" list="ph-regions" value={form.region} onChange={set('region')} placeholder="e.g. BARMM" />
          <datalist id="ph-regions">
            {PH_REGIONS.map((r) => <option key={r} value={r} />)}
          </datalist>
        </Field>
      </div>
      <fieldset>
        <legend className="block text-xs font-medium text-gray-700 mb-1">Partner agencies</legend>
        <p className="text-xs text-gray-500 mb-2">This hospital's gateway can endorse patients only to the agencies ticked here.</p>
        {enabledAgencies.length === 0 ? (
          <p className="text-xs text-gray-500">No agencies yet — add them under Agencies.</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {enabledAgencies.map((a) => (
              <li key={a.id}>
                <label className="flex items-center gap-2.5 min-h-[40px] px-2 rounded-lg hover:bg-gray-50 cursor-pointer text-sm text-gray-700">
                  <input type="checkbox" className="w-4 h-4 accent-brand-500" checked={partners.has(a.id)} onChange={() => togglePartner(a.id)} />
                  <span className="truncate">{a.name || a.id}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {partners.size === 0 && enabledAgencies.length > 0 && (
          <p className="text-xs text-amber-700 mt-1.5">With no partner agencies the hospital stays "Provisioning" — its gateway can't endorse anyone yet.</p>
        )}
      </fieldset>
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
        details: `${form.role === 'super_admin' ? 'Hospital Admin' : 'Staff Admin'} for ${hospital.facilityName || hospital.id}`,
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
      <Field label="Role" required hint="The hospital admin adds the rest of its staff from Admin Accounts.">
        <SearchableSelect
          value={form.role}
          onChange={(v) => setForm((p) => ({ ...p, role: v }))}
          options={[
            { value: 'super_admin', label: 'Hospital Admin' },
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
  const { newCount } = useOnboardingRequests(true)

  // Arriving from "Set up hospital" on an onboarding request: open Add hospital
  // pre-filled, then clear the navigation state so a refresh doesn't reopen it.
  const location = useLocation()
  const navigate = useNavigate()
  const [prefill, setPrefill] = useState(null)
  useEffect(() => {
    if (location.state?.prefill) {
      setPrefill({ initial: location.state.prefill, fromRequest: location.state.fromRequest ?? null })
      setEditing('add')
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.state]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Network figures (counts only) — networkStats/current, built by the Admin
  // SDK (refreshNetworkStats / scripts/compute-network-stats.mjs) because the
  // platform admin may not read the patient records being counted.
  const [stats, setStats] = useState(null)
  useEffect(() => onSnapshot(doc(db, 'networkStats', 'current'),
    (snap) => setStats(snap.exists() ? snap.data() : null),
    (e) => console.error('[Hospitals] stats snapshot error:', e),
  ), [])

  const sorted = useMemo(() => [...hospitals].sort((a, b) =>
    (a.id === DEFAULT_HOSPITAL_ID ? -1 : b.id === DEFAULT_HOSPITAL_ID ? 1 : 0) ||
    String(a.facilityName || a.id).localeCompare(String(b.facilityName || b.id))), [hospitals])

  // Live = taking sign-ups and staffed; Provisioning = no super admin yet;
  // Paused = sign-ups stopped by the network admin.
  const partnerCountOf = (h) => agencies.filter((a) => a.enabled !== false && agencyPartnersWith(a, h.id)).length
  const statusOf = (h) => {
    if (h.onboarding?.stage && h.onboarding.stage !== 'live') return { label: 'Onboarding', cls: 'bg-blue-50 text-blue-800' }
    if (h.enabled === false) return { label: 'Sign-ups paused', cls: 'bg-amber-50 text-amber-800' }
    if (!(staffByHospital[h.id]?.super > 0) || partnerCountOf(h) === 0) return { label: 'Provisioning', cls: 'bg-amber-50 text-amber-800' }
    return { label: 'Live', cls: 'bg-green-50 text-green-800' }
  }
  const liveCount = sorted.filter((h) => statusOf(h).label === 'Live').length
  const activeAgencies = agencies.filter((a) => a.enabled !== false).length
  const totals = stats?.totals
  const inProgress = totals ? (totals.requests?.inReview ?? 0) + (totals.requests?.inFunding ?? 0) : null
  const statsAt = tsToDate(stats?.generatedAt)
  const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-PH'))

  return (
    <Layout breadcrumb="Hospitals">
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
          <div>
            <p className="eyebrow">Network overview</p>
            <h1 className="font-display text-[28px] font-bold tracking-tight text-brand-900 mt-1">Hospitals</h1>
            <p className="text-sm text-gray-500 mt-1">
              Every hospital on the network. Patient data stays isolated per hospital — you see counts, never records.
            </p>
          </div>
          <button className="btn-primary flex items-center gap-1.5 self-start" onClick={() => setEditing('add')}>
            <MdAdd size={16} /> Add hospital
          </button>
        </div>

        {/* Key figures */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
          {[
            ['Hospitals live', `${liveCount}${sorted.length > liveCount ? ` of ${sorted.length}` : ''}`],
            ['Patients network-wide', fmt(totals?.patients)],
            ['Requests in progress', fmt(inProgress)],
            ['Funding agencies', fmt(activeAgencies)],
          ].map(([label, value]) => (
            <div key={label} className="card p-4 sm:p-5">
              <p className="text-xs sm:text-[13px] text-gray-500">{label}</p>
              <p className="font-display text-2xl sm:text-[30px] font-bold text-brand-900 mt-1 tabular-nums">{value}</p>
            </div>
          ))}
        </div>

        {newCount > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border border-brand-100 bg-gradient-to-br from-white to-brand-50 p-4 sm:p-5">
            <span aria-hidden="true" className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-brand-100 bg-white text-brand-600"><MdLocalHospital size={20} /></span>
            <div className="min-w-[200px] flex-1">
              <p className="font-semibold text-brand-900">{newCount} {newCount === 1 ? 'hospital has' : 'hospitals have'} requested onboarding</p>
              <p className="text-[13px] text-gray-600 mt-0.5">Contact them, then set each one up as a hospital.</p>
            </div>
            <Link to="/platform/onboarding" className="btn-primary text-sm">Open onboarding</Link>
          </div>
        )}

        {/* Finish setting up: a hospital is Live only with a Hospital Admin AND
            at least one partner agency (else its gateway can't endorse). */}
        {!loading && sorted.some((h) => !(staffByHospital[h.id]?.super > 0) || partnerCountOf(h) === 0) && (
          <div className="card p-4 sm:p-5 mb-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Finish setting up</p>
            <ul className="space-y-3">
              {sorted.filter((h) => !(staffByHospital[h.id]?.super > 0) || partnerCountOf(h) === 0).map((h) => {
                const hasAdmin = staffByHospital[h.id]?.super > 0
                const partnerCount = partnerCountOf(h)
                const Step = ({ done, children, action }) => (
                  <li className="flex flex-wrap items-center gap-2 text-sm">
                    <span aria-hidden="true" className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${done ? 'bg-brand-500 text-white' : 'border-2 border-gray-300 text-gray-400'}`}>{done ? '✓' : ''}</span>
                    <span className={done ? 'text-gray-500' : 'text-gray-800'}>{children}</span>
                    {!done && action}
                  </li>
                )
                return (
                  <li key={h.id} className="rounded-xl border border-gray-100 p-3">
                    <p className="font-semibold text-gray-900 mb-2">{h.facilityName || h.id}</p>
                    <ul className="space-y-1.5">
                      <Step done>Hospital created · access codes <span className="font-mono">{h.accessCodePrefix}-…</span></Step>
                      <Step done={hasAdmin} action={<button className="text-xs font-semibold text-brand-600 hover:text-brand-700" onClick={() => setAddingAdmin(h)}>Add Hospital Admin →</button>}>
                        First Hospital Admin
                      </Step>
                      <Step done={partnerCount > 0} action={<button className="text-xs font-semibold text-brand-600 hover:text-brand-700" onClick={() => setEditing(h)}>Choose partner agencies →</button>}>
                        Partner agencies{partnerCount > 0 ? ` (${partnerCount})` : ''}
                      </Step>
                    </ul>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

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
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="bg-gray-50/70 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Hospital</th>
                  <th className="px-4 py-3">Prefix</th>
                  <th className="px-4 py-3">Region</th>
                  <th className="px-4 py-3 text-right">Patients</th>
                  <th className="px-4 py-3 text-right">Active requests</th>
                  <th className="px-4 py-3 text-right">Partner agencies</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((h) => {
                  const s = stats?.hospitals?.[h.id]
                  const counts = staffByHospital[h.id] ?? { super: 0, staff: 0 }
                  const partnerCount = partnerCountOf(h)
                  const status = statusOf(h)
                  return (
                    <tr key={h.id} className="border-t border-gray-100 align-middle">
                      <td className="px-4 py-3.5">
                        <p className="font-semibold text-gray-900">{h.facilityName || h.id}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          <span className="font-mono">{h.id}</span>
                          {h.id === DEFAULT_HOSPITAL_ID && ' · hospital #1'}
                          {' · '}{counts.super} hospital admin{counts.super === 1 ? '' : 's'} · {counts.staff} staff
                        </p>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs text-gray-600">{h.accessCodePrefix ? `${h.accessCodePrefix}-` : '—'}</td>
                      <td className="px-4 py-3.5 text-gray-600">{h.region || '—'}</td>
                      <td className="px-4 py-3.5 text-right tabular-nums">{s ? fmt(s.patients) : '—'}</td>
                      <td className="px-4 py-3.5 text-right tabular-nums">{s ? fmt((s.requests?.inReview ?? 0) + (s.requests?.inFunding ?? 0)) : '—'}</td>
                      <td className={`px-4 py-3.5 text-right tabular-nums ${partnerCount === 0 ? 'text-amber-700 font-semibold' : ''}`}>{partnerCount}</td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11.5px] font-bold whitespace-nowrap ${status.cls}`}>{status.label}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex justify-end gap-1">
                          <button className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-gray-500 hover:text-brand-600 hover:bg-brand-50"
                            aria-label={`Add an administrator to ${h.facilityName || h.id}`} title="Add admin" onClick={() => setAddingAdmin(h)}>
                            <MdPersonAdd size={18} />
                          </button>
                          <button className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-gray-500 hover:text-brand-600 hover:bg-brand-50"
                            aria-label={`Edit ${h.facilityName || h.id}`} title="Edit" onClick={() => setEditing(h)}>
                            <MdEdit size={18} />
                          </button>
                          {/* Still onboarding: registration opens only through
                              go-live in the onboarding workspace, never here. */}
                          {h.onboarding?.stage && h.onboarding.stage !== 'live' ? (
                            <Link to={`/platform/onboarding/${h.onboarding.requestId}`}
                              className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-gray-500 hover:text-brand-600 hover:bg-brand-50"
                              aria-label={`Open onboarding for ${h.facilityName || h.id}`} title="Open onboarding">
                              <MdInbox size={18} />
                            </Link>
                          ) : (
                          <button className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-gray-500 hover:text-amber-700 hover:bg-amber-50"
                            aria-label={h.enabled === false ? `Resume sign-ups at ${h.facilityName || h.id}` : `Pause sign-ups at ${h.facilityName || h.id}`}
                            title={h.enabled === false ? 'Resume sign-ups' : 'Pause sign-ups'} onClick={() => setToggling(h)}>
                            {h.enabled === false ? <MdCheckCircle size={18} /> : <MdBlock size={18} />}
                          </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-gray-500 mt-3">
          {stats
            ? `Patient and request figures updated ${statsAt ? statsAt.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'recently'} — they refresh every 6 hours (or run scripts/compute-network-stats.mjs).`
            : 'Patient and request figures appear once network stats are generated (scheduled function, or scripts/compute-network-stats.mjs --apply).'}
          {' '}A hospital admin sees only their own hospital — enforced by per-hospital security rules.
          A hospital can endorse only to its partner agencies; set them on each agency's page.
        </p>
      </div>

      {editing && (
        <HospitalModal
          hospital={editing === 'add' ? null : editing}
          hospitals={hospitals}
          agencies={agencies}
          onCreated={(h) => setAddingAdmin(h)}
          initial={editing === 'add' ? prefill?.initial : null}
          fromRequest={editing === 'add' ? prefill?.fromRequest : null}
          onClose={() => { setEditing(null); setPrefill(null) }} />
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
