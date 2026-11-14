import { useEffect, useState } from 'react'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import toast from 'react-hot-toast'
import { db } from '../../firebase'
import { logAudit } from '../../utils/auditLog'
import { partnerHospitalIdsOf } from '../../utils/hospitals'
import { useHospitals, hospitalLabel } from '../../hooks/useHospitals'

// Agency ↔ hospital partnerships (multi-hospital Phase 7, decision D4): the
// platform admin decides which hospitals' gateways may endorse to an agency;
// everyone else sees the list read-only. The rules enforce it on every slice.

// Checkbox list of hospitals. `value` = selected hospital ids.
export function PartnerHospitalPicker({ hospitals, value, onChange, disabled = false }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  if (!hospitals.length) return <p className="text-xs text-gray-500">No hospitals yet — add one under Hospitals first.</p>
  return (
    <ul className="space-y-1">
      {hospitals.map((h) => (
        <li key={h.id}>
          <label className="flex items-center gap-2.5 min-h-[40px] px-2 rounded-lg hover:bg-gray-50 cursor-pointer text-sm text-gray-700">
            <input type="checkbox" className="w-4 h-4 accent-brand-500" disabled={disabled}
              checked={value.includes(h.id)} onChange={() => toggle(h.id)} />
            <span className="flex-1 min-w-0 truncate">{h.facilityName || h.id}</span>
            {h.accessCodePrefix && <span className="text-xs font-mono text-gray-500">{h.accessCodePrefix}</span>}
          </label>
        </li>
      ))}
    </ul>
  )
}

// Card for the agency detail page. Editable for the platform admin only.
export default function PartnerHospitalsCard({ agency, canEdit, user }) {
  const { hospitals, loading } = useHospitals()
  const current = partnerHospitalIdsOf(agency)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(current)
  const [saving, setSaving] = useState(false)
  const currentKey = current.join(',')
  useEffect(() => { if (!editing) setDraft(current) }, [currentKey, editing]) // eslint-disable-line react-hooks/exhaustive-deps

  const byId = Object.fromEntries(hospitals.map((h) => [h.id, h]))
  const legacy = !Array.isArray(agency.partnerHospitalIds)

  const save = async () => {
    if (!draft.length) { toast.error('Pick at least one hospital. To stop all endorsements, disable the agency instead.'); return }
    setSaving(true)
    try {
      await updateDoc(doc(db, 'agencies', agency.id), { partnerHospitalIds: draft, updatedAt: serverTimestamp() })
      logAudit(user, {
        action: 'agency_updated', targetType: 'agency', targetId: agency.id, targetName: agency.name,
        details: `Partner hospitals: ${draft.map((id) => hospitalLabel(byId[id]) || id).join(', ')}`,
      })
      toast.success('Partner hospitals updated.')
      setEditing(false)
    } catch (err) {
      console.error(err)
      toast.error('Could not update partner hospitals.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Partner hospitals</p>
        {canEdit && !editing && (
          <button className="text-xs text-brand-500 hover:text-brand-600 font-medium" onClick={() => setEditing(true)}>Edit</button>
        )}
      </div>
      {loading ? (
        <p className="text-xs text-gray-500">Loading…</p>
      ) : editing ? (
        <>
          <PartnerHospitalPicker hospitals={hospitals} value={draft} onChange={setDraft} disabled={saving} />
          <p className="text-xs text-gray-500 mt-2">Only these hospitals' gateways can endorse patients to this agency.</p>
          <div className="flex gap-2 justify-end mt-3">
            <button className="btn-secondary text-xs" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
            <button className="btn-primary text-xs" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </>
      ) : (
        <>
          <ul className="flex flex-wrap gap-1.5">
            {current.map((id) => (
              <li key={id} className="badge-gray text-xs">{byId[id] ? (byId[id].facilityName || id) : id}</li>
            ))}
          </ul>
          {legacy && (
            <p className="text-xs text-gray-500 mt-2">Not set yet — treated as hospital #1 only until the super admin picks partners.</p>
          )}
        </>
      )}
    </div>
  )
}
