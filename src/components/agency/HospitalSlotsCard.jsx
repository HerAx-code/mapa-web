import { useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { MdLocalHospital, MdSave } from 'react-icons/md'
import toast from 'react-hot-toast'
import { db } from '../../firebase'
import { useHospitals, hospitalLabel } from '../../hooks/useHospitals'
import { effectiveSlots } from '../../utils/requests'
import { phTodayKey } from '../../utils/dates'
import { logAudit } from '../../utils/auditLog'
import { syncAgencyPublic } from '../../utils/agenciesPublic'
import { partnerHospitalIdsOf } from '../../utils/hospitals'

const MAX_PER_HOSPITAL = 100
const OPEN = ['endorsed', 'reviewing', 'awaiting_info']

/**
 * Daily slots per partner hospital (owner decision 2026-11-14). Each hospital
 * the agency partners with gets its own daily count, set by the agency admin;
 * a hospital without one uses the agency-wide default below it. Also shows,
 * per hospital, today's use and the cases open from that hospital — so the
 * agency sees where its requests come from.
 *
 *   agency        the agencies/{id} doc (with id)
 *   user          signed-in user (for the audit log)
 *   canEdit       agency admin only
 *   applications  optional — the agency's slices, for the open-case counts
 */
export default function HospitalSlotsCard({ agency, user, canEdit = false, applications = null }) {
  const { hospitals } = useHospitals()
  const [draft, setDraft] = useState({})
  const [savingId, setSavingId] = useState(null)
  const today = phTodayKey()
  const partners = partnerHospitalIdsOf(agency)
  const nameOf = (id) => hospitalLabel(hospitals.find(h => h.id === id)) || id

  const save = async (hid) => {
    const total = Math.round(Number(draft[hid]))
    if (!Number.isFinite(total) || total < 0 || total > MAX_PER_HOSPITAL) {
      toast.error(`Enter 0–${MAX_PER_HOSPITAL}.`); return
    }
    const cur = effectiveSlots(agency, today, hid)
    const usedToday = cur.perHospital ? Math.max(0, cur.total - cur.remaining) : 0
    const entry = { total, remaining: Math.max(0, total - usedToday), lastResetDate: today }
    setSavingId(hid)
    try {
      await updateDoc(doc(db, 'agencies', agency.id), { [`hospitalSlots.${hid}`]: entry })
      logAudit(user, {
        action: 'hospital_slots_set', targetType: 'agency', targetId: agency.id, targetName: agency.name,
        details: `${nameOf(hid)}: ${cur.perHospital ? cur.total : 'default'} → ${total} daily slots`,
      })
      syncAgencyPublic(agency.id, { ...agency, hospitalSlots: { ...(agency.hospitalSlots ?? {}), [hid]: entry } })
      setDraft(d => { const n = { ...d }; delete n[hid]; return n })
      toast.success(`${nameOf(hid)}: ${total} slots a day.`)
    } catch (err) {
      console.error('[HospitalSlotsCard] save failed:', err)
      toast.error('Failed to save the slots.')
    } finally { setSavingId(null) }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-1">
        <MdLocalHospital className="text-brand-500" size={18} />
        <h2 className="text-sm font-semibold text-gray-800">Daily slots per hospital</h2>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Each partner hospital uses its own daily slots when it endorses a patient to you.
        {canEdit ? ' Set how many patients each hospital may endorse per day.' : ' Your agency admin sets these.'}
      </p>
      {partners.length === 0 ? (
        <p className="text-sm text-gray-500">No partner hospitals yet.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {partners.map(hid => {
            const s = effectiveSlots(agency, today, hid)
            const open = applications ? applications.filter(a => (a.tenantId ?? '') === hid && OPEN.includes(a.status)).length : null
            const value = draft[hid] ?? (s.perHospital ? String(s.total) : '')
            return (
              <div key={hid} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate">{nameOf(hid)}</p>
                  <p className="text-xs text-gray-500">
                    {s.perHospital
                      ? `${s.total - s.remaining} used · ${s.remaining} of ${s.total} left today`
                      : `Uses the agency-wide default (${s.remaining} of ${s.total} left today)`}
                    {open !== null && ` · ${open} open case${open === 1 ? '' : 's'}`}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`slots-${hid}`}>Daily slots for {nameOf(hid)}</label>
                    <input id={`slots-${hid}`} type="number" min="0" max={MAX_PER_HOSPITAL} inputMode="numeric"
                      className="input w-20 text-sm" placeholder="—" value={value}
                      onChange={e => setDraft(d => ({ ...d, [hid]: e.target.value }))} />
                    <button type="button" className="btn-secondary text-xs flex items-center gap-1"
                      disabled={savingId === hid || draft[hid] === undefined} onClick={() => save(hid)}>
                      <MdSave size={14} /> Save
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
