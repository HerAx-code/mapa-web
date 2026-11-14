import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MdMarkEmailRead, MdArrowForward } from 'react-icons/md'
import Layout from '../../components/Layout'
import { tsToDate } from '../../utils/dates'
import { useOnboardingRequests } from '../../hooks/useOnboardingRequests'
import { useHospitals } from '../../hooks/useHospitals'
import { STAGES, DECLINED, stageOf, stageLabel, stageChecklist, ownershipOf, needsAttention } from '../../utils/onboarding'

// Loose name match for the "already on the network" hint: case, spacing and
// punctuation don't matter ("Davao Regional Med. Center" ~ "davao regional med center").
const normName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const TABS = [...STAGES, { key: DECLINED, label: 'Declined' }]

// Onboarding board — every hospital on its way to (or past) go-live, by stage.
// Each row opens the hospital's onboarding workspace (/platform/onboarding/:id).
export default function OnboardingRequests() {
  const { requests, loading } = useOnboardingRequests(true)
  const { hospitals } = useHospitals()
  const [tab, setTab] = useState('interest')
  const existingMatch = (r) => {
    const n = normName(r.hospitalName)
    return n ? hospitals.find((h) => normName(h.facilityName) === n || (h.shortName && normName(h.shortName) === n)) : null
  }
  const hospitalOf = (r) => hospitals.find(h => h.id === r.hospitalId)

  const shown = requests.filter((r) => stageOf(r) === tab)

  const daysInStage = (r) => {
    const h = Array.isArray(r.stageHistory) && r.stageHistory.length ? new Date(r.stageHistory[r.stageHistory.length - 1].at) : tsToDate(r.createdAt)
    return h ? Math.max(0, Math.floor((Date.now() - h.getTime()) / 86400000)) : null
  }
  // The first thing the stage still needs (setup counts aren't loaded here).
  const nextStep = (r) => stageChecklist(stageOf(r), r, { adminCount: 2, partnerCount: 1 }).find(i => !i.done)?.label

  return (
    <Layout breadcrumb="Onboarding">
      <div className="w-full p-4 sm:p-6 max-w-[1100px] mx-auto">
        <div className="mb-5">
          <p className="eyebrow">Network</p>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-brand-900 mt-1">Onboarding</h1>
          <p className="text-sm text-gray-500 mt-1">Hospitals joining MAPA: interest → verification → agreement → setup &amp; training → live.</p>
        </div>

        <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Onboarding stage">
          {TABS.map((s) => {
            const n = requests.filter((r) => stageOf(r) === s.key).length
            const on = tab === s.key
            return (
              <button key={s.key} role="tab" aria-selected={on} onClick={() => setTab(s.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 min-h-[36px] text-[13px] font-semibold transition-colors ${on ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-brand-200'}`}>
                {s.label} <span className={`tabular-nums ${on ? 'text-white/85' : 'text-gray-400'}`}>{n}</span>
              </button>
            )
          })}
        </div>

        {loading ? (
          <div className="card p-8 flex justify-center">
            <div className="w-8 h-8 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
          </div>
        ) : shown.length === 0 ? (
          <div className="card p-8 text-center">
            <MdMarkEmailRead size={28} className="mx-auto text-gray-300" />
            <p className="text-sm font-medium text-gray-700 mt-2">No hospitals at {stageLabel(tab)}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {shown.map((r) => {
              const d = daysInStage(r)
              const step = tab === 'live' || tab === DECLINED ? null : nextStep(r)
              const dup = !r.hospitalId && existingMatch(r)
              const attention = tab === 'live' && needsAttention({ ...r, liveAt: r.liveAt ?? hospitalOf(r)?.liveAt })
              return (
                <li key={r.id}>
                  <Link to={`/platform/onboarding/${r.id}`} className="card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 hover:border-brand-200 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900">{r.hospitalName}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {[ownershipOf(r.verification?.ownershipType || r.hospitalType).label, r.region, d !== null && `${d} day${d === 1 ? '' : 's'} in stage`].filter(Boolean).join(' · ')}
                      </p>
                      {step && <p className="text-sm text-gray-700 mt-1.5">Next: {step}</p>}
                      {attention && <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-2.5 py-1 mt-1.5 inline-block">Compliance date due or overdue</p>}
                      {dup && <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-2.5 py-1 mt-1.5 inline-block">Possible duplicate — already on the network as {dup.facilityName || dup.id}</p>}
                    </div>
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600">Open <MdArrowForward size={16} /></span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Layout>
  )
}
