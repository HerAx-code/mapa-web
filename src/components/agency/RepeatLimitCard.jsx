import { useEffect, useState } from 'react'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import toast from 'react-hot-toast'
import { db } from '../../firebase'
import { logAudit } from '../../utils/auditLog'
import { repeatLimitOf } from '../../utils/approvalCooldown'

// Repeat limit (Phase 1, 2026-11-16): how often this agency approves the same
// patient. Set by the Agency Admin; enforced by firestore.rules
// (outsideRepeatLimit) — approving inside it needs a written reason.
export default function RepeatLimitCard({ agency, user }) {
  const current = repeatLimitOf(agency)
  const [days, setDays]       = useState(String(current.days))
  const [perType, setPerType] = useState(current.perType)
  const [saving, setSaving]   = useState(false)

  useEffect(() => {
    setDays(String(current.days))
    setPerType(current.perType)
  }, [current.days, current.perType])

  const n = Number(days)
  const valid = days !== '' && Number.isInteger(n) && n >= 0 && n <= 365
  const changed = valid && (n !== current.days || perType !== current.perType)

  const save = async () => {
    if (!valid) { toast.error('Enter a whole number of days from 0 to 365.'); return }
    setSaving(true)
    try {
      await updateDoc(doc(db, 'agencies', agency.id), {
        repeatLimit: { days: n, perType },
        updatedAt: serverTimestamp(),
      })
      logAudit(user, {
        action: 'agency_repeat_limit_set', targetType: 'agency', targetId: agency.id, targetName: agency.name,
        details: n === 0 ? 'Repeat limit: none' : `Repeat limit: ${n} days${perType ? ' per assistance type' : ''}`,
      })
      toast.success('Repeat limit saved.')
    } catch (err) {
      console.error('[RepeatLimitCard] save failed:', err)
      toast.error('Failed to save the repeat limit.')
    } finally { setSaving(false) }
  }

  return (
    <div className="card p-5 mb-5">
      <p className="text-sm font-semibold text-gray-800">Repeat limit</p>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">
        How often your agency approves the same patient. Approving inside the limit is allowed only with a
        written reason, saved with the approval. Parts of the same request never count. 0 = no limit.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Once every
          <input type="number" min={0} max={365} step={1} className="input w-20 text-center"
            value={days} onChange={e => setDays(e.target.value)} aria-label="Repeat limit in days" />
          days
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 min-h-[44px]">
          <input type="checkbox" className="w-4 h-4 accent-brand-500" checked={perType}
            onChange={e => setPerType(e.target.checked)} />
          Count each assistance type separately
        </label>
        <button className="btn-primary text-xs ml-auto" disabled={!changed || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
