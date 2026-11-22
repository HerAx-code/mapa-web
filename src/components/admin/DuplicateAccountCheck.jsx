import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import toast from 'react-hot-toast'
import { db, functions, httpsCallable } from '../../firebase'
import { useIdentityFlag } from '../../hooks/useVerification'

// Input verification Phase 1: other patient accounts that look like the same
// person, from identityFlags/{tenant}__{uid} (functions/src/identityIndex.js).
// Advice only — the social worker asks the patient; nothing is blocked.
// Matches at another hospital arrive as a count with no details (tenant
// boundary), so the prompt is to ask the patient.
const KIND_LABEL = {
  pcn:        'Same national ID card',
  name_phone: 'Same name and phone number',
  phone:      'Same phone number (often shared in a family)',
}

export default function DuplicateAccountCheck({ patientId }) {
  const flag = useIdentityFlag(patientId) // undefined loading · null not checked yet
  const [names, setNames] = useState({})
  // Phase 3 PR 3.2 (N18): matches no longer true of the profile stay (`past`)
  // until a social worker clears them here, with a reason (audited).
  const [clearing, setClearing] = useState(false)
  const [clearReason, setClearReason] = useState('')
  const [busy, setBusy] = useState(false)
  const clearPast = async () => {
    if (clearReason.trim().length < 10) { toast.error('Give the reason (at least 10 characters).'); return }
    setBusy(true)
    try {
      await httpsCallable(functions, 'clearIdentityFlag')({ patientId, reason: clearReason.trim() })
      toast.success('Past matches cleared.')
      setClearing(false); setClearReason('')
    } catch (err) {
      toast.error(err?.message && err?.code !== 'functions/internal' ? err.message : 'Could not clear the matches.')
    } finally { setBusy(false) }
  }

  const sameUids = [...new Set((flag?.matches ?? []).flatMap(m => m.sameHospitalUids ?? []))]
  const sameKey = sameUids.join(',')
  useEffect(() => {
    if (!sameUids.length) return
    let live = true
    Promise.all(sameUids.map(u => getDoc(doc(db, 'users', u)).then(s => [u, s.exists() ? s.data() : null]).catch(() => [u, null])))
      .then(rows => { if (live) setNames(Object.fromEntries(rows)) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sameKey])

  if (!patientId) return null
  const row = (value, tone, extra = null) => (
    <div className="flex items-start justify-between gap-3 text-sm pb-2 border-b border-gray-100">
      <span className="text-gray-600 flex-shrink-0">Other accounts</span>
      <span className={`font-semibold text-right ${tone}`}>{value}{extra}</span>
    </div>
  )
  if (flag === undefined) return row('Checking…', 'text-gray-500')
  if (flag === null) return row('Not checked yet', 'text-gray-500')
  if (!flag.matches?.length) return row('No other account found', 'text-green-600')

  const strong = flag.matches.some(m => m.kind !== 'phone')
  return row(strong ? 'Possible duplicate — ask the patient' : 'Phone shared with another account', strong ? 'text-amber-600' : 'text-gray-600', (
    <ul className="mt-1 space-y-1 text-xs font-normal text-gray-700 text-right">
      {flag.matches.map(m => (
        <li key={`${m.kind}${m.past ? '-past' : ''}`}>
          <span className="font-medium">{KIND_LABEL[m.kind] ?? m.kind}{m.past ? ' (earlier — no longer on the profile)' : ''}:</span>{' '}
          {[
            ...(m.sameHospitalUids ?? []).map(u => names[u] ? `${names[u].name}${names[u].patientId ? ` (${names[u].patientId})` : ''}` : 'a patient here'),
            ...(m.otherHospitalCount ? [`${m.otherHospitalCount} account${m.otherHospitalCount === 1 ? '' : 's'} at another hospital`] : []),
          ].join(' · ')}
        </li>
      ))}
      {flag.matches.some(m => m.past) && (clearing ? (
        <li className="pt-1 space-y-1">
          <textarea rows={2} className="input text-xs w-full" value={clearReason} aria-label="Reason for clearing the past matches"
            onChange={e => setClearReason(e.target.value)} placeholder="e.g. Asked the patient: the old number was a relative's" />
          <span className="inline-flex gap-2">
            <button type="button" className="btn-secondary text-xs" onClick={() => setClearing(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn-primary text-xs" onClick={clearPast} disabled={busy}>{busy ? 'Clearing…' : 'Clear past matches'}</button>
          </span>
        </li>
      ) : (
        <li>
          <button type="button" className="text-xs text-brand-600 underline underline-offset-2" onClick={() => setClearing(true)}>
            Clear past matches after asking the patient
          </button>
        </li>
      ))}
    </ul>
  ))
}
