import { useState, useEffect } from 'react'
import { collection, addDoc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import SearchableSelect from '../ui/SearchableSelect'
import { useAuth } from '../../contexts/AuthContext'
import { MdClose, MdSend, MdGroups } from 'react-icons/md'
import toast from 'react-hot-toast'

/**
 * SuggestEndorsementModal — R36 Bonterra warm-handoff pattern.
 *
 * Agency-side coordinator opens this from agency/ApplicationDetail on
 * a co-funded slice. They pick a sibling agency that ISN'T already on
 * the case, write a reason, optionally recommend an amount, and set
 * urgency. The submission writes a referralSuggestions/{id} doc that
 * CRMC reviews on admin/Requests. CRMC has final say -- the suggestion
 * is an information channel, not an instruction.
 *
 * The CRMC-gateway model is deliberately preserved: agencies do NOT
 * endorse each other. They suggest; CRMC decides.
 *
 * Theoretical anchor: Bardach (1998) describes agency staff as
 * "craftsmen" with ground-truth case knowledge. This UI gives them a
 * structured voice without bypassing the network broker (CRMC).
 */

const URGENCY_OPTIONS = [
  { value: 'low',    label: 'Low — Patient can wait'                  },
  { value: 'medium', label: 'Medium — Should be reviewed this week'   },
  { value: 'high',   label: 'High — Urgent, needs same-day attention' },
]

export default function SuggestEndorsementModal({ app, request, siblings = [], onClose }) {
  const { user } = useAuth()
  const [agencies, setAgencies] = useState([])
  const [toAgencyId, setToAgencyId] = useState('')
  const [reason, setReason] = useState('')
  const [recommendedAmount, setRecommendedAmount] = useState('')
  const [urgency, setUrgency] = useState('medium')
  const [saving, setSaving] = useState(false)
  const [loadingAgencies, setLoadingAgencies] = useState(true)

  // Load all enabled agencies that aren't already on this case.
  // Sibling agencies are excluded -- suggesting an agency that already
  // holds a slice would be a no-op for CRMC.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const snap = await getDocs(query(collection(db, 'agencies'), orderBy('name', 'asc')))
        const alreadyOn = new Set(siblings.map(s => s.agencyId))
        const list = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(a => a.enabled !== false && !alreadyOn.has(a.id))
        if (!cancelled) setAgencies(list)
      } catch (e) {
        console.error('[SuggestEndorsement] agency load failed:', e)
      } finally {
        if (!cancelled) setLoadingAgencies(false)
      }
    })()
    return () => { cancelled = true }
  }, [siblings])

  const handleSubmit = async () => {
    if (!toAgencyId) {
      toast.error('Pick an agency to suggest.')
      return
    }
    if (reason.trim().length < 10) {
      toast.error('Reason must be at least 10 characters.')
      return
    }
    setSaving(true)
    try {
      const target = agencies.find(a => a.id === toAgencyId)
      await addDoc(collection(db, 'referralSuggestions'), {
        fromAgencyId: user.agencyId,
        fromUserId:   user.uid,
        fromUserName: user.name ?? user.email ?? 'Unknown',
        toAgencyId,
        toAgencyName: target?.name ?? toAgencyId,
        requestId:    app.requestId,
        patientName:  app.patientName ?? '',
        amountNeeded: Number(request?.amountNeeded) || 0,
        reason:       reason.trim(),
        recommendedAmount: recommendedAmount ? Number(recommendedAmount) : null,
        urgency,
        status:       'pending',
        createdAt:    serverTimestamp(),
        respondedAt:  null,
        respondedBy:  null,
        declineReason: null,
        // Phase 4.3: `resultingApplicationId` was a speculative field
        // for "track which slice resulted from this suggestion." Wiring
        // it requires threading suggestionId through the EndorseModal
        // flow which we judged not worth the added complexity. Dropped.
        // Existing docs with the field retain it harmlessly.
      })
      toast.success('Suggestion sent to CRMC. They will decide whether to endorse.')
      onClose()
    } catch (err) {
      console.error('[SuggestEndorsement] write failed:', err)
      toast.error('Could not send suggestion. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const canSubmit = !saving && !!toAgencyId && reason.trim().length >= 10

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-end sm:items-center justify-center sm:p-4"
         onClick={e => e.target === e.currentTarget && !saving && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-brand-50 rounded-lg flex items-center justify-center">
              <MdGroups size={18} className="text-brand-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Suggest another agency</h2>
              <p className="text-xs text-gray-400 mt-0.5">{app.patientName} · {app.appId}</p>
            </div>
          </div>
          <button onClick={onClose} disabled={saving}
                  className="text-gray-400 hover:text-gray-600 disabled:opacity-50">
            <MdClose size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            CRMC reviews each suggestion and decides whether to endorse the case to the suggested
            agency. Your suggestion is informational — it does not commit any agency to action.
          </p>

          {/* Agency picker */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Suggested agency <span className="text-red-400">*</span>
            </label>
            <SearchableSelect
              value={toAgencyId}
              onChange={setToAgencyId}
              disabled={loadingAgencies || agencies.length === 0}
              placeholder={loadingAgencies ? 'Loading…' : 'Pick an agency'}
              searchPlaceholder="Search agencies…"
              options={agencies.map(a => ({ value: a.id, label: a.name }))} />
            {!loadingAgencies && agencies.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">
                All eligible agencies are already on this case. No siblings left to suggest.
              </p>
            )}
          </div>

          {/* Reason */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Reason <span className="text-red-400">*</span>
            </label>
            <textarea
              className="input resize-none text-sm"
              rows={3}
              maxLength={1000}
              placeholder="e.g. Patient mentions chemotherapy regime — falls under PCSO MAP scope"
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-0.5">
              {reason.length}/1000
              {reason.trim().length > 0 && reason.trim().length < 10 && (
                <span className="text-amber-600 ml-2">(minimum 10 characters)</span>
              )}
            </p>
          </div>

          {/* Recommended amount (optional) */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Recommended amount (₱) <span className="text-gray-400 font-normal">— optional</span>
            </label>
            <input
              type="number"
              min={0}
              className="input text-sm"
              placeholder="e.g. 10000"
              value={recommendedAmount}
              onChange={e => setRecommendedAmount(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-0.5">
              Hint for CRMC. The receiving agency makes their own funding decision.
            </p>
          </div>

          {/* Urgency */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Urgency</label>
            <SearchableSelect
              value={urgency}
              onChange={setUrgency}
              options={URGENCY_OPTIONS.map(o => ({ value: o.value, label: o.label }))} />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-50 flex gap-2 justify-end sticky bottom-0 bg-white">
          <button className="btn-secondary text-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn-primary text-sm flex items-center gap-1.5"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            <MdSend size={14} /> {saving ? 'Sending…' : 'Send suggestion'}
          </button>
        </div>
      </div>
    </div>
  )
}
