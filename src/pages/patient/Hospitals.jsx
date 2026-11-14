import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  MdSearch, MdPlace, MdEmail, MdLocalHospital, MdGroups, MdSchedule,
  MdEventSeat, MdArrowForward, MdQrCode2, MdCheckCircle, MdInfoOutline,
} from 'react-icons/md'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { useTranslation } from 'react-i18next'
import Layout from '../../components/Layout'
import PatientPage from '../../components/patient/PatientPage'
import AgencyAvatar from '../../components/AgencyAvatar'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { useMarketplace, hospitalForCode } from '../../hooks/useMarketplace'
import { PENDING_CODE_KEY } from '../../utils/accessCodes'

const ACTIVE = (s) => !['closed', 'rejected', 'fully_funded'].includes(s)
const MAX_AVATARS = 5
const MAX_CHIPS   = 4

// The patient marketplace (docs/patient-marketplace-plan.md): a patient's
// account is network-wide, and each request is filed at the hospital they
// choose here. Every card shows what they compare — programs and capacity,
// partner agencies, location and contact, typical turnaround — and files at
// that hospital with the access code its social-services office gave them.
export default function Hospitals() {
  const { t }    = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { hospitals, loading } = useMarketplace()
  const [search, setSearch]   = useState('')
  const [program, setProgram] = useState('')
  const [sort, setSort]       = useState('recommended')
  const [hasActive, setHasActive] = useState(false)

  // One open request at a time: while one is active, cards don't offer filing.
  useEffect(() => {
    if (!user?.uid) return
    getDocs(query(collection(db, 'requests'), where('patientId', '==', user.uid)))
      .then((snap) => setHasActive(snap.docs.some((d) => ACTIVE(d.data().status))))
      .catch(() => {})
  }, [user?.uid])

  const pendingCode = (() => { try { return sessionStorage.getItem(PENDING_CODE_KEY) } catch { return null } })()
  const scannedId = hospitalForCode(hospitals, pendingCode)?.id ?? null
  const myIds = new Set([...(user?.tenantIds ?? []), ...(user?.tenantId ? [user.tenantId] : [])])

  const allPrograms = useMemo(() => [...new Set(hospitals.flatMap((h) => h.programs))].sort(), [hospitals])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rank = (h) => (h.id === scannedId ? 0 : h.id === user?.tenantId ? 1 : 2)
    return hospitals
      .filter((h) => !program || h.programs.includes(program))
      .filter((h) => !q || [h.facilityName, h.shortName, h.address, h.region, h.gatewayName]
        .some((v) => (v ?? '').toLowerCase().includes(q)))
      .sort((a, b) => {
        if (sort === 'slots') return b.slots.remaining - a.slots.remaining
        if (sort === 'fastest') return (a.turnaround?.days ?? Infinity) - (b.turnaround?.days ?? Infinity)
        return rank(a) - rank(b) || a.facilityName.localeCompare(b.facilityName)
      })
  }, [hospitals, search, program, sort, scannedId, user?.tenantId])

  return (
    <Layout breadcrumb={t('patient.hospitals.navLabel')}>
      <PatientPage width="wide">
        <div className="mb-5">
          <p className="eyebrow">{t('patient.hospitals.eyebrow')}</p>
          <h1 className="font-display text-[26px] font-bold tracking-tight text-gray-900 mt-1">{t('patient.hospitals.title')}</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">{t('patient.hospitals.subtitle')}</p>
        </div>

        {/* How choosing works — three plain steps. */}
        <ol className="grid gap-2 sm:grid-cols-3 mb-5">
          {[1, 2, 3].map((n) => (
            <li key={n} className="flex gap-3 rounded-xl border border-brand-100 bg-brand-50 p-3">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white">{n}</span>
              <span className="text-xs leading-relaxed text-brand-900">{t(`patient.hospitals.how${n}`)}</span>
            </li>
          ))}
        </ol>

        {hasActive && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <MdInfoOutline size={18} className="mt-0.5 flex-shrink-0 text-amber-600" aria-hidden="true" />
            <p className="flex-1 text-xs leading-relaxed text-amber-800">
              {t('patient.hospitals.activeNote')}{' '}
              <Link to="/patient/status" className="font-semibold underline">{t('patient.hospitals.activeLink')}</Link>
            </p>
          </div>
        )}

        {/* Filters */}
        <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <label className="relative block">
            <span className="sr-only">{t('patient.hospitals.search')}</span>
            <MdSearch size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input className="input pl-9 min-h-[44px]" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={t('patient.hospitals.search')} />
          </label>
          <label className="block">
            <span className="sr-only">{t('patient.hospitals.programFilter')}</span>
            <select className="input min-h-[44px]" value={program} onChange={(e) => setProgram(e.target.value)}>
              <option value="">{t('patient.hospitals.allPrograms')}</option>
              {allPrograms.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="sr-only">{t('patient.hospitals.sortLabel')}</span>
            <select className="input min-h-[44px]" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="recommended">{t('patient.hospitals.sortRecommended')}</option>
              <option value="slots">{t('patient.hospitals.sortSlots')}</option>
              <option value="fastest">{t('patient.hospitals.sortFastest')}</option>
            </select>
          </label>
        </div>

        {loading && hospitals.length === 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1].map((i) => <div key={i} className="card h-64 animate-pulse bg-gray-50" />)}
          </div>
        ) : shown.length === 0 ? (
          <div className="card p-8 text-center">
            <MdLocalHospital size={32} className="mx-auto text-gray-300" aria-hidden="true" />
            <p className="mt-2 text-sm text-gray-600">{hospitals.length ? t('patient.hospitals.noMatch') : t('patient.hospitals.none')}</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {shown.map((h) => (
              <HospitalCard key={h.id} h={h} t={t}
                current={h.id === user?.tenantId}
                filedBefore={myIds.has(h.id)}
                scanned={h.id === scannedId}
                canFile={!hasActive}
                onFile={() => navigate(`/patient/request?hospital=${encodeURIComponent(h.id)}`)} />
            ))}
          </div>
        )}
      </PatientPage>
    </Layout>
  )
}

function HospitalCard({ h, t, current, filedBefore, scanned, canFile, onFile }) {
  const extraAgencies = h.partners.length - MAX_AVATARS
  const extraPrograms = h.programs.length - MAX_CHIPS
  return (
    <article className={`card flex flex-col p-5 ${scanned ? 'ring-2 ring-brand-400' : ''}`}>
      <header className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          <MdLocalHospital size={22} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[17px] font-bold leading-snug text-gray-900">{h.facilityName}</h2>
          {h.gatewayName && <p className="text-xs text-gray-500 mt-0.5">{h.gatewayName}</p>}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {scanned && <Badge tone="brand"><MdQrCode2 size={12} aria-hidden="true" /> {t('patient.hospitals.badgeScanned')}</Badge>}
            {current && <Badge tone="green"><MdCheckCircle size={12} aria-hidden="true" /> {t('patient.hospitals.badgeCurrent')}</Badge>}
            {!current && filedBefore && <Badge tone="gray">{t('patient.hospitals.badgeBefore')}</Badge>}
          </div>
        </div>
      </header>

      <dl className="mt-4 space-y-3 text-sm">
        {/* Programs & capacity */}
        <Row icon={MdEventSeat} label={t('patient.hospitals.capacity')}>
          {h.slots.total > 0
            ? <span className={h.slots.remaining > 0 ? 'text-gray-800' : 'text-amber-700'}>
                {h.slots.remaining > 0
                  ? t('patient.hospitals.slotsOpen', { remaining: h.slots.remaining, total: h.slots.total })
                  : t('patient.hospitals.slotsFull')}
              </span>
            : <span className="text-gray-500">{t('patient.hospitals.slotsUnknown')}</span>}
          {h.programs.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {h.programs.slice(0, MAX_CHIPS).map((p) => (
                <span key={p} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">{p}</span>
              ))}
              {extraPrograms > 0 && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">{t('patient.hospitals.more', { n: extraPrograms })}</span>}
            </div>
          )}
        </Row>

        {/* Partner agencies */}
        <Row icon={MdGroups} label={t('patient.hospitals.partners')}>
          {h.partners.length === 0
            ? <span className="text-gray-500">{t('patient.hospitals.noPartners')}</span>
            : (
              <div className="flex items-center gap-2">
                <div className="flex -space-x-2">
                  {h.partners.slice(0, MAX_AVATARS).map((a) => (
                    <span key={a.id} title={a.name} className="rounded-lg ring-2 ring-white">
                      <AgencyAvatar agency={a} className="w-8 h-8 rounded-lg text-[10px]" />
                    </span>
                  ))}
                </div>
                <span className="text-xs text-gray-600">
                  {t('patient.hospitals.partnerCount', { count: h.partners.length })}
                  {extraAgencies > 0 ? ` · ${t('patient.hospitals.more', { n: extraAgencies })}` : ''}
                </span>
              </div>
            )}
        </Row>

        {/* Typical turnaround */}
        <Row icon={MdSchedule} label={t('patient.hospitals.turnaround')}>
          {h.turnaround
            ? <span className="text-gray-800">{t('patient.hospitals.turnaroundDays', { count: Math.max(1, Math.round(h.turnaround.days)), cases: h.turnaround.basedOn })}</span>
            : <span className="text-gray-500">{t('patient.hospitals.turnaroundNew')}</span>}
        </Row>

        {/* Location & contact */}
        <Row icon={MdPlace} label={t('patient.hospitals.location')}>
          <span className="text-gray-800">{[h.address, h.region].filter(Boolean).join(' · ') || t('patient.hospitals.noAddress')}</span>
          {h.contactEmail && (
            <a href={`mailto:${h.contactEmail}`} className="mt-1 flex items-center gap-1 break-all text-xs font-medium text-brand-600 hover:text-brand-700">
              <MdEmail size={14} aria-hidden="true" /> {h.contactEmail}
            </a>
          )}
        </Row>
      </dl>

      <div className="mt-auto pt-4">
        <p className="mb-2 text-[11px] text-gray-500">
          {t('patient.hospitals.codeHint', { prefix: h.accessCodePrefix })}
        </p>
        <button type="button" onClick={onFile} disabled={!canFile}
          className="btn-primary flex w-full min-h-[44px] items-center justify-center gap-1.5 disabled:opacity-50">
          {t('patient.hospitals.fileHere')} <MdArrowForward size={16} aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}

function Row({ icon: Icon, label, children }) {
  return (
    <div className="flex gap-3">
      <Icon size={18} className="mt-0.5 flex-shrink-0 text-gray-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
        <dd className="mt-0.5">{children}</dd>
      </div>
    </div>
  )
}

const TONES = {
  brand: 'bg-brand-50 text-brand-700',
  green: 'bg-green-50 text-green-700',
  gray:  'bg-gray-100 text-gray-600',
}
function Badge({ tone, children }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}`}>{children}</span>
}
