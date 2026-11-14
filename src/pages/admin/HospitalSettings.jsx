import { useEffect, useState } from 'react'
import { doc, getDoc, updateDoc, deleteField, serverTimestamp } from 'firebase/firestore'
import toast from 'react-hot-toast'
import Layout from '../../components/Layout'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { applyHospital } from '../../config/org'
import { currentTenantId, clearBrandingCache } from '../../utils/hospitals'
import { logAudit } from '../../utils/auditLog'
import { syncHospitalPublic } from '../../utils/hospitalsPublic'
import { validateHospital, normalizePrefix } from '../../utils/hospitalConfig'

// Hospital Settings — multi-hospital Phase 8 (docs/multi-hospital-network-plan.md).
// A hospital's super admin edits its own BRANDING: the names and contact that
// appear on patient copy, the Guarantee Letter, the intake sheet and emails.
// The access-code prefix and whether sign-ups are open are network decisions
// (platform admin) — shown here read-only; the rules enforce the same split.
const FIELDS = ['facilityName', 'shortName', 'gatewayName', 'gatewayInitials', 'contactEmail', 'address']

function Field({ label, hint, error, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {error
        ? <p className="text-xs text-red-500 mt-1">{error}</p>
        : hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}

export default function HospitalSettings() {
  const { user } = useAuth()
  const tenantId = currentTenantId()
  const [hospital, setHospital] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  useEffect(() => {
    if (!tenantId) return
    getDoc(doc(db, 'hospitals', tenantId))
      .then((snap) => {
        const h = snap.exists() ? snap.data() : {}
        setHospital(h)
        setForm(Object.fromEntries(FIELDS.map((k) => [k, h[k] ?? ''])))
      })
      .catch((err) => { console.error(err); toast.error('Could not load hospital settings.') })
  }, [tenantId])

  const errors = form ? validateHospital({ ...form, accessCodePrefix: hospital?.accessCodePrefix ?? 'MAPA' }, [], tenantId) : {}
  const err = (k) => (showErrors ? errors[k] : undefined)
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  const handleSave = async () => {
    setShowErrors(true)
    if (Object.keys(errors).some((k) => FIELDS.includes(k))) return
    setSaving(true)
    try {
      const update = { updatedAt: serverTimestamp() }
      const next = { ...hospital }
      for (const k of FIELDS) {
        const v = String(form[k] ?? '').trim()
        if (v) { update[k] = v; next[k] = v }
        else if (k in hospital) { update[k] = deleteField(); delete next[k] }
      }
      await updateDoc(doc(db, 'hospitals', tenantId), update)
      setHospital(next)
      await syncHospitalPublic(tenantId, next)
      // Show the new branding at once (header, copy, documents).
      clearBrandingCache()
      applyHospital(next)
      logAudit(user, { action: 'hospital_updated', targetType: 'hospital', targetId: tenantId, targetName: next.facilityName || tenantId, details: 'Hospital branding updated' })
      toast.success('Hospital settings saved.')
    } catch (e) {
      console.error(e)
      toast.error('Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Layout breadcrumb="Hospital Settings">
      <div className="w-full p-4 sm:p-6 max-w-[760px] mx-auto">
        <div className="mb-5">
          <p className="eyebrow">Hospital</p>
          <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Hospital Settings</h1>
          <p className="text-sm text-gray-500 mt-1">
            How your hospital appears to patients and on the Guarantee Letter, intake sheet and emails.
          </p>
        </div>

        {!form ? (
          <div className="card p-8 flex justify-center">
            <div className="w-8 h-8 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="card p-5 space-y-4">
              <Field label="Hospital name" error={err('facilityName')} hint="Printed on documents and used in patient copy.">
                <input className="input" value={form.facilityName} onChange={set('facilityName')} />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Short name" hint="e.g. CPH">
                  <input className="input" value={form.shortName} onChange={set('shortName')} />
                </Field>
                <Field label="Contact email" error={err('contactEmail')} hint="Where patients ask about access codes.">
                  <input type="email" className="input" value={form.contactEmail} onChange={set('contactEmail')} />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem] gap-4">
                <Field label="Gateway office" error={err('gatewayName')}>
                  <input className="input" value={form.gatewayName} onChange={set('gatewayName')} />
                </Field>
                <Field label="Seal initials" error={err('gatewayInitials')}>
                  <input className="input" value={form.gatewayInitials} onChange={set('gatewayInitials')} />
                </Field>
              </div>
              <Field label="Address" hint="Printed under the hospital name on documents.">
                <input className="input" value={form.address} onChange={set('address')} />
              </Field>
              <div className="flex justify-end pt-1">
                <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>

            <div className="card p-5 mt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Set by the network</p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-gray-500">Access codes</dt>
                  <dd className="font-mono text-gray-800">{hospital.accessCodePrefix ? `${normalizePrefix(hospital.accessCodePrefix)}-YYYY-NNNNN` : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">New patient sign-ups</dt>
                  <dd className={hospital.enabled === false ? 'text-red-600 font-medium' : 'text-gray-800'}>
                    {hospital.enabled === false ? 'Paused' : 'Open'}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-gray-500 mt-3">Ask the network administrator to change these.</p>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
