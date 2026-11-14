import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, query, where, getCountFromServer, doc, onSnapshot } from 'firebase/firestore'
import { MdClose, MdLockClock } from 'react-icons/md'
import { db } from '../../firebase'
import { useOrg } from '../../hooks/useOrg'
import { useLiveData } from '../../contexts/LiveDataContext'
import { currentTenantId, tenantWhere, agencyPartnersWith } from '../../utils/hospitals'
import { stageLabel, PLAN_TIERS } from '../../utils/onboarding'

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
  // Onboarding status from the hospital doc (set by the Super Admin): until
  // go-live, patients can't register with this hospital's access codes.
  const [onboarding, setOnboarding] = useState(undefined)
  useEffect(() => {
    if (!tenant) return undefined
    return onSnapshot(doc(db, 'hospitals', tenant), (s) => setOnboarding(s.exists() ? (s.data().onboarding ?? null) : null), () => setOnboarding(null))
  }, [tenant])

  useEffect(() => {
    if (!tenant || dismissed) return undefined
    let alive = true
    Promise.all([
      getCountFromServer(query(collection(db, 'hospitalIds'), ...tenantWhere())),
      getCountFromServer(query(collection(db, 'users'), ...tenantWhere(), where('role', 'in', ['super_admin', 'staff_admin']))),
      getCountFromServer(query(collection(db, 'users'), ...tenantWhere(), where('role', '==', 'super_admin'))),
    ]).then(([codes, staff, admins]) => {
      if (alive) setCounts({ codes: codes.data().count, staff: staff.data().count, admins: admins.data().count })
    }).catch((err) => console.warn('[GettingStarted] counts failed:', err))
    return () => { alive = false }
  }, [tenant, dismissed])

  if (!tenant || !counts || onboarding === undefined) return null
  const onboardingOpen = !!onboarding?.stage && onboarding.stage !== 'live'
  // The checklist can be dismissed; the "not live yet" notice can't.
  if (dismissed && !onboardingOpen) return null

  const partners = Object.values(agencyMap ?? {}).filter((a) => a.enabled !== false && agencyPartnersWith(a, tenant)).length
  const steps = [
    { done: !!org.facilityName && org.facilityName !== 'the hospital', label: "Set your hospital's name, gateway office and contact", to: '/admin/settings', cta: 'Hospital Settings' },
    { done: counts.codes > 0, label: `Issue Patient Access Codes (${org.accessCodePrefix}-YYYY-NNNNN)`, to: '/admin/hospitalids', cta: 'Access Codes' },
    { done: counts.admins > 1, label: 'Add a backup Hospital Admin (with two-step sign-in)', to: '/admin/accounts', cta: 'Admin Accounts' },
    { done: counts.staff > 2, label: 'Add your gateway staff', to: '/admin/accounts', cta: 'Admin Accounts' },
    { done: partners > 0, label: partners > 0 ? `Partner agencies ready (${partners})` : 'Partner agencies — ask the Super Admin to set them', to: '/admin/agencies', cta: 'Partner Agencies' },
  ]
  if (steps.every((s) => s.done) && !onboardingOpen) return null
  const plan = PLAN_TIERS.find(p => p.value === onboarding?.planTier)?.label

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
          {(onboarding?.stage || plan) && (
            <p className="mt-1 inline-flex flex-wrap gap-1.5 text-[11px] font-semibold">
              {onboarding?.stage && <span className="rounded-full bg-white px-2 py-0.5 text-brand-700 ring-1 ring-brand-100">{stageLabel(onboarding.stage)}</span>}
              <span className="rounded-full bg-white px-2 py-0.5 text-green-800 ring-1 ring-green-100">{plan ?? 'Pilot'} · ₱0</span>
            </p>
          )}
        </div>
        {!onboardingOpen && <button onClick={dismiss} aria-label="Dismiss the getting-started checklist" className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-gray-500 hover:bg-white">
          <MdClose size={18} />
        </button>}
      </div>
      {onboardingOpen && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <MdLockClock size={18} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          Your hospital is still being onboarded. Patients can register with your access codes once MAPA approves go-live —
          after your training, the signed agreements and your go-live acceptance.
        </p>
      )}
      <ol className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.label} className="flex flex-wrap items-center gap-2 text-sm">
            <span aria-hidden="true" className={`inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] font-bold ${s.done ? 'bg-brand-500 text-white' : 'border-2 border-gray-300'}`}>{s.done ? '✓' : ''}</span>
            <span className={s.done ? 'text-gray-500' : 'text-gray-800'}>{s.label}</span>
            {!s.done && <Link to={s.to} className="text-xs font-semibold text-brand-600 hover:text-brand-700">{s.cta} →</Link>}
          </li>
        ))}
      </ol>
    </div>
  )
}
