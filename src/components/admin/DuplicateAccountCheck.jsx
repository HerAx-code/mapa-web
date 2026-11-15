import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase'
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
        <li key={m.kind}>
          <span className="font-medium">{KIND_LABEL[m.kind] ?? m.kind}:</span>{' '}
          {[
            ...(m.sameHospitalUids ?? []).map(u => names[u] ? `${names[u].name}${names[u].patientId ? ` (${names[u].patientId})` : ''}` : 'a patient here'),
            ...(m.otherHospitalCount ? [`${m.otherHospitalCount} account${m.otherHospitalCount === 1 ? '' : 's'} at another hospital`] : []),
          ].join(' · ')}
        </li>
      ))}
    </ul>
  ))
}
