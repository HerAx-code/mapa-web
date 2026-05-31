import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MdSearch, MdLocationOn, MdSchedule, MdClose, MdLocalHospital, MdFavorite, MdCampaign,
} from 'react-icons/md'
import Layout from '../../components/Layout'
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
          <h1 className="page-title">{t('patient.programs.title')}</h1>
          <p className="page-sub break-words">{t('patient.programs.subtitle')}</p>
        </div>

        {/* Request Assistance CTA — the single patient action. CRMC routes the
            request to the right agencies, so there's no per-agency apply. */}
        <div className="bg-brand-50 border border-brand-100 rounded-xl p-4 mb-5 flex items-start gap-3">
          <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <MdFavorite size={20} className="text-brand-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-brand-800">{t('patient.programs.ctaTitle')}</p>
            <p className="text-xs text-brand-700/80 mb-2 break-words">{t('patient.programs.ctaDesc')}</p>
            <button className="btn-primary text-sm" onClick={() => navigate('/patient/request')}>
              {t('patient.programs.ctaBtn')} →
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input className="input pl-9 pr-10" placeholder={t('patient.programs.searchPlaceholder')}
            value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
              <MdClose size={14} />
            </button>
          )}
        </div>

        {/* Type filter chips */}
        {allTypes.length > 0 && (
          <div className="relative mb-5">
            <div className="flex gap-1.5 overflow-x-auto pb-1 pr-8 scrollbar-hide">
              <button onClick={() => setSelectedType('')}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${selectedType === '' ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                {t('patient.programs.filterAll')}
              </button>
              {allTypes.map(typeName => (
                <button key={typeName}
                  onClick={() => setSelectedType(prev => prev === typeName ? '' : typeName)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${selectedType === typeName ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
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

        {/* Agency cards — informational only */}
        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full min-w-0">
            {filtered.map(agency => {
              const types = agency.assistanceTypes ?? []
              const promo = promos[agency.id]
              return (
                <div key={agency.id} className="card hover:shadow-md transition-shadow min-w-0 overflow-hidden">
                  {/* Mobile compact */}
                  <div className="sm:hidden p-4 w-full min-w-0">
                    <div className="flex items-start gap-3 mb-2 w-full min-w-0">
                      <div className={`flex-shrink-0 w-10 h-10 ${agency.color} rounded-xl text-white font-bold text-xs flex items-center justify-center`}>{agency.initials}</div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-800 truncate">{agency.name}</h3>
                        <p className="text-xs text-gray-400 mt-0.5 truncate flex items-center gap-1"><MdLocationOn size={11} className="flex-shrink-0" />{agency.location}</p>
                      </div>
                    </div>
                    {agency.description && <p className="text-xs text-gray-500 line-clamp-2 break-words leading-snug mb-2 w-full min-w-0">{agency.description}</p>}
                    {types.length > 0 && <p className="text-xs text-brand-600 truncate w-full min-w-0">{types.slice(0, 3).join(' · ')}{types.length > 3 ? ` · +${types.length - 3}` : ''}</p>}
                    {promo && (
                      <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-brand-50 border border-brand-100 px-2.5 py-1.5 w-full min-w-0">
                        <MdCampaign size={13} className="text-brand-500 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-brand-800 truncate">{promo.title}</p>
                          <p className="text-xs text-brand-700/80 line-clamp-2 break-words leading-snug">{promo.message}</p>
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Desktop / tablet */}
                  <div className="hidden sm:flex sm:flex-col p-5">
                    <div className="flex items-start gap-3 mb-3">
                      <div className={`flex-shrink-0 w-11 h-11 ${agency.color} rounded-xl text-white font-bold text-sm flex items-center justify-center`}>{agency.initials}</div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-800">{agency.name}</h3>
                        <div className="flex items-center gap-1 mt-0.5"><MdLocationOn size={12} className="text-gray-400 flex-shrink-0" /><p className="text-xs text-gray-400 truncate">{agency.location}</p></div>
                      </div>
                    </div>
                    <p className="text-sm text-gray-500 mb-3 leading-relaxed line-clamp-3 break-words">{agency.description}</p>
                    {types.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {types.slice(0, 4).map((typeName, i) => <span key={i} className="badge badge-blue text-xs">{typeName}</span>)}
                        {types.length > 4 && <span className="badge badge-blue text-xs">{t('patient.programs.moreTypes', { count: types.length - 4 })}</span>}
                      </div>
                    )}
                    {promo && (
                      <div className="mb-3 flex items-start gap-2 rounded-lg bg-brand-50 border border-brand-100 px-3 py-2">
                        <MdCampaign size={15} className="text-brand-500 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-brand-800">{promo.title}</p>
                          <p className="text-xs text-brand-700/80 line-clamp-2 break-words leading-snug">{promo.message}</p>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-1 text-xs text-gray-400 pt-3 border-t border-gray-50 mt-auto">
                      <MdSchedule size={13} />{agency.processingTime}
                    </div>
                  </div>
                </div>
              )
            })}

            {filtered.length === 0 && (
              <div className="col-span-2 card p-10 text-center">
                <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3"><MdLocalHospital size={28} className="text-gray-400" /></div>
                <p className="text-sm font-medium text-gray-600 mb-1">{search || selectedType ? t('patient.programs.noneMatchTitle') : t('patient.programs.noneAvailableTitle')}</p>
                <p className="text-xs text-gray-400">{search || selectedType ? t('patient.programs.noneMatchDesc') : t('patient.programs.noneAvailableDesc')}</p>
                {selectedType && <button className="mt-3 text-sm text-brand-500 font-medium hover:underline" onClick={() => setSelectedType('')}>{t('patient.programs.clearFilter')}</button>}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}