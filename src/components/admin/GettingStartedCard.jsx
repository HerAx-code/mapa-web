import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, query, where, getCountFromServer } from 'firebase/firestore'
import { MdClose } from 'react-icons/md'
import { db } from '../../firebase'
import { useOrg } from '../../hooks/useOrg'
import { useLiveData } from '../../contexts/LiveDataContext'
import { currentTenantId, tenantWhere, agencyPartnersWith } from '../../utils/hospitals'

// First-run checklist for a newly onboarded hospital's Hospital Admin
// (super_admin): the steps between "the Super Admin created us" and "we're
// taking patients". Shown until every step is done or it's dismissed (per
// hospital, this browser). Counts only — no patient data.
export default function GettingStartedCard() {
  const org = useOrg()
  const { agencyMap } = useLiveData()
  const tenant = currentTenantId()
  const dismissKey = `mapa.gettingStarted.dismissed.${tenant}`
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(dismissKey) === '1' } catch { return false }
  })
  const [counts, setCounts] = useState(null)

  useEffect(() => {
    if (!tenant || dismissed) return undefined
    let alive = true
    Promise.all([
      getCountFromServer(query(collection(db, 'hospitalIds'), ...tenantWhere())),
      getCountFromServer(query(collection(db, 'users'), ...tenantWhere(), where('role', 'in', ['super_admin', 'staff_admin']))),
    ]).then(([codes, staff]) => {
      if (alive) setCounts({ codes: codes.data().count, staff: staff.data().count })
    }).catch((err) => console.warn('[GettingStarted] counts failed:', err))
    return () => { alive = false }
  }, [tenant, dismissed])

  if (!tenant || dismissed || !counts) return null

  const partners = Object.values(agencyMap ?? {}).filter((a) => a.enabled !== false && agencyPartnersWith(a, tenant)).length
  const steps = [
    { done: !!org.facilityName && org.facilityName !== 'the hospital', label: "Set your hospital's name, gateway office and contact", to: '/admin/settings', cta: 'Hospital Settings' },
    { done: counts.codes > 0, label: `Issue Patient Access Codes (${org.accessCodePrefix}-YYYY-NNNNN)`, to: '/admin/hospitalids', cta: 'Access Codes' },
    { done: counts.staff > 1, label: 'Add your gateway staff', to: '/admin/accounts', cta: 'Admin Accounts' },
    { done: partners > 0, label: partners > 0 ? `Partner agencies ready (${partners})` : 'Partner agencies — ask the Super Admin to set them', to: '/admin/agencies', cta: 'Partner Agencies' },
  ]
  if (steps.every((s) => s.done)) return null

  const dismiss = () => {
    try { localStorage.setItem(dismissKey, '1') } catch { /* private mode */ }
    setDismissed(true)
  }

  return (
    <div className="card p-4 sm:p-5 mb-4 border-brand-100 bg-gradient-to-br from-white to-brand-50/60">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Getting started</p>
          <p className="font-semibold text-brand-900 mt-1">Get {org.shortName || org.facilityName || 'your hospital'} ready for patients</p>
        </div>
        <button onClick={dismiss} aria-label="Dismiss the getting-started checklist" className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-gray-500 hover:bg-white">
          <MdClose size={18} />
        </button>
      </div>
      <ol className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.to} className="flex flex-wrap items-center gap-2 text-sm">
            <span aria-hidden="true" className={`inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] font-bold ${s.done ? 'bg-brand-500 text-white' : 'border-2 border-gray-300'}`}>{s.done ? '✓' : ''}</span>
            <span className={s.done ? 'text-gray-500' : 'text-gray-800'}>{s.label}</span>
            {!s.done && <Link to={s.to} className="text-xs font-semibold text-brand-600 hover:text-brand-700">{s.cta} →</Link>}
          </li>
        ))}
      </ol>
    </div>
  )
}
