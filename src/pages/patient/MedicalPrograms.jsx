import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MdSearch, MdLocationOn, MdSchedule, MdClose, MdLocalHospital, MdCampaign,
  MdExpandMore, MdExpandLess, MdCheckCircle, MdArrowForward,
} from 'react-icons/md'
import Layout from '../../components/Layout'
import AgencyAvatar from '../../components/AgencyAvatar'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase'
import { useTranslation } from 'react-i18next'

// Informational catalog of available medical-assistance programs. Patients no
// longer apply to a specific agency here — under the co-funding model they
// submit ONE assistance request and CRMC routes/splits it across agencies
// toward zero balance. This page is a browse-and-learn surface with a single
// "Request Assistance" call to action.
export default function MedicalPrograms() {
  const { t }                           = useTranslation()
  const navigate                        = useNavigate()
  const [search, setSearch]             = useState('')
  const [selectedType, setSelectedType] = useState('')
  const [agencies, setAgencies]         = useState([])
  const [promos, setPromos]             = useState({})
  const [loading, setLoading]           = useState(true)
  const [expandedId, setExpandedId]     = useState(null)

  useEffect(() => {
    const q = query(collection(db, 'agencies'), where('enabled', '==', true))
    const unsub = onSnapshot(q, snap => {
      setAgencies(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
          // Null-safe sort: a corrupt agency doc missing `name` would
          // throw on .localeCompare and wipe the whole catalog -- one
          // bad row should not blank the entire Find Programs page.
          .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
      )
      setLoading(false)
    }, (err) => {
      setLoading(false)
      console.error('[MedicalPrograms] agencies snapshot error:', err)
    })
    return unsub
  }, [])

  // Live agency promotions — the latest active one per agency, within its
  // scheduled window. Keyed by agencyId so each card can show its own.
  useEffect(() => {
    const q = query(collection(db, 'announcements'), where('source', '==', 'agency'))
    const unsub = onSnapshot(q, snap => {
      const now = Date.now()
      const byAgency = {}
      snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p => {
          const start = p.startAt?.toDate?.()?.getTime() ?? 0
          const end   = p.endAt?.toDate?.()?.getTime()   ?? 0
          return p.active && now >= start && now <= end
        })
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
        .forEach(p => { if (p.agencyId && !byAgency[p.agencyId]) byAgency[p.agencyId] = p })
      setPromos(byAgency)
    }, () => {})
    return unsub
  }, [])

  const allTypes = [...new Set(agencies.flatMap(a => a.assistanceTypes ?? []))].sort()

  const filtered = agencies.filter(a => {
    if (selectedType && !(a.assistanceTypes ?? []).includes(selectedType)) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      a.name?.toLowerCase().includes(q) ||
      a.description?.toLowerCase().includes(q) ||
      (a.assistanceTypes ?? []).some(typeName => typeName.toLowerCase().includes(q))
    )
  })

  return (
    <Layout breadcrumb={t('patient.programs.breadcrumb')}>
      <div className="px-3 py-4 sm:p-6 mx-auto w-full max-w-[100vw] sm:max-w-5xl overflow-x-clip">

        <div className="mb-5 w-full min-w-0">
          <p className="eyebrow">{t('patient.programs.eyebrow')}</p>
          <h1 className="font-display text-[26px] font-bold tracking-tight text-gray-900 mt-1">{t('patient.programs.title')}</h1>
          <p className="text-sm text-gray-500 mt-1 break-words max-w-2xl">{t('patient.programs.subtitle')}</p>
        </div>

        {/* Brand hero band — on-model intro to the co-funding model + the one
            real patient action. NOT a funding tracker or a self-service cart:
            this page is a browse-and-learn catalog, and CRMC endorses the
            request to agencies — patients don't apply to each one. */}
        <div className="card-hero mb-6">
          <div className="p-6 sm:p-7">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white text-balance max-w-xl">
              {t('patient.programs.heroTitle')}
            </h2>
            <p className="mt-2.5 text-sm text-brand-100 leading-relaxed max-w-xl">
              {t('patient.programs.heroDesc')}
            </p>
            <button onClick={() => navigate('/patient/request')}
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-brand-800 hover:bg-brand-50 transition-colors">
              {t('patient.programs.ctaBtn')} <MdArrowForward size={16} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
          <input className="input pl-9 pr-10" placeholder={t('patient.programs.searchPlaceholder')}
            value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-gray-500 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
              <MdClose size={14} />
            </button>
          )}
        </div>

        {/* Type filter chips */}
        {allTypes.length > 0 && (
          <div className="relative mb-5">
            <div className="flex gap-2 overflow-x-auto pb-1 pr-8 scrollbar-hide">
              <button onClick={() => setSelectedType('')}
                className={`flex-shrink-0 filter-pill ${selectedType === '' ? 'active' : ''}`}>
                {t('patient.programs.filterAll')}
              </button>
              {allTypes.map(typeName => (
                <button key={typeName}
                  onClick={() => setSelectedType(prev => prev === typeName ? '' : typeName)}
                  className={`flex-shrink-0 filter-pill ${selectedType === typeName ? 'active' : ''}`}>
                  {typeName}
                </button>
              ))}
            </div>
            <div className="pointer-events-none absolute right-0 top-0 bottom-1 w-8 bg-gradient-to-l from-gray-50 to-transparent" />
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="card p-5 animate-pulse">
                <div className="flex gap-3 mb-3">
                  <div className="w-11 h-11 bg-gray-100 rounded-xl" />
                  <div className="flex-1 space-y-2"><div className="h-3 bg-gray-100 rounded w-3/4" /><div className="h-2 bg-gray-100 rounded w-1/2" /></div>
                </div>
                <div className="h-2 bg-gray-100 rounded mb-4" />
                <div className="space-y-1.5"><div className="h-2 bg-gray-100 rounded" /><div className="h-2 bg-gray-100 rounded w-5/6" /></div>
              </div>
            ))}
          </div>
        )}

        {/* Program cards — informational only (browse-and-learn). A single
            responsive card; the requirements + procedure expand in place. */}
        {!loading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 w-full min-w-0 items-start">
            {filtered.map(agency => {
              const types    = agency.assistanceTypes ?? []
              const promo    = promos[agency.id]
              const reqs     = agency.requirements ?? []
              const expanded = expandedId === agency.id
              const hasDetail = reqs.length > 0 || !!agency.procedure
              return (
                <div key={agency.id} className="card overflow-hidden flex flex-col min-w-0">
                  <div className="p-5 flex flex-col flex-1 min-w-0">
                    <div className="flex items-start gap-3">
                      <AgencyAvatar agency={agency} className="w-11 h-11 rounded-xl text-sm flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <h3 className="text-[15px] font-semibold text-gray-900 truncate">{agency.name}</h3>
                        <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-500 min-w-0">
                          <MdLocationOn size={12} className="flex-shrink-0" /><span className="truncate">{agency.location}</span>
                        </div>
                      </div>
                      {agency.processingTime && (
                        <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-full px-2 py-1">
                          <MdSchedule size={12} /> {agency.processingTime}
                        </span>
                      )}
                    </div>

                    {agency.description && (
                      <p className="text-sm text-gray-500 mt-3 leading-relaxed line-clamp-3 break-words">{agency.description}</p>
                    )}

                    {types.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {types.slice(0, 4).map((typeName, i) => <span key={i} className="badge badge-blue text-xs">{typeName}</span>)}
                        {types.length > 4 && <span className="badge badge-gray text-xs">{t('patient.programs.moreTypes', { count: types.length - 4 })}</span>}
                      </div>
                    )}

                    {promo && (
                      <div className="mt-3 flex items-start gap-2 rounded-xl bg-brand-50 border border-brand-100 px-3 py-2">
                        <MdCampaign size={15} className="text-brand-500 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-brand-800 truncate">{promo.title}</p>
                          <p className="text-xs text-brand-700/80 line-clamp-2 break-words leading-snug">{promo.message}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Requirements & how it works — expand in place. Informational:
                      these are the documents/steps the agency typically needs;
                      CRMC still decides eligibility and routes the request. */}
                  {hasDetail && (
                    <>
                      <button onClick={() => setExpandedId(expanded ? null : agency.id)}
                        aria-expanded={expanded}
                        className="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-2.5 text-left text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-50 transition-colors">
                        <span>{t('patient.programs.viewRequirements')}</span>
                        {expanded ? <MdExpandLess size={16} className="flex-shrink-0" /> : <MdExpandMore size={16} className="flex-shrink-0" />}
                      </button>
                      {expanded && (
                        <div className="border-t border-gray-50 bg-gray-50/60 px-5 py-4 space-y-3">
                          {reqs.length > 0 && (
                            <div>
                              <p className="eyebrow mb-1.5">{t('patient.programs.requiredDocs')}</p>
                              <ul className="space-y-1">
                                {reqs.map((r, i) => (
                                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                                    <MdCheckCircle size={15} className="text-brand-500 flex-shrink-0 mt-0.5" /><span className="min-w-0">{r}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {agency.procedure && (
                            <div>
                              <p className="eyebrow mb-1.5">{t('patient.programs.howItWorks')}</p>
                              <p className="text-sm text-gray-600 whitespace-pre-line leading-relaxed break-words">{agency.procedure}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}

            {filtered.length === 0 && (
              <div className="lg:col-span-2 card p-10 text-center">
                <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3"><MdLocalHospital size={28} className="text-gray-500" /></div>
                <p className="text-sm font-medium text-gray-600 mb-1">{search || selectedType ? t('patient.programs.noneMatchTitle') : t('patient.programs.noneAvailableTitle')}</p>
                <p className="text-xs text-gray-500">{search || selectedType ? t('patient.programs.noneMatchDesc') : t('patient.programs.noneAvailableDesc')}</p>
                {selectedType && <button className="mt-3 text-sm text-brand-500 font-medium hover:underline" onClick={() => setSelectedType('')}>{t('patient.programs.clearFilter')}</button>}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}