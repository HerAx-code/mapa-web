import { useState, useEffect } from 'react'
import Layout from '../../components/Layout'
import { useNavigate } from 'react-router-dom'
import { MdArrowForward, MdInfo, MdSchedule, MdLocalHospital, MdBlock, MdCheckCircle, MdStar, MdCheck } from 'react-icons/md'
import { collection, query, where, orderBy, onSnapshot, getDocs } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { SLOT_STATUS } from '../../utils/constants'
import { useTranslation } from 'react-i18next'

export default function Screening() {
  const { t }       = useTranslation()
  const navigate    = useNavigate()
  const { user }    = useAuth()
  const [step, setStep]                       = useState('questions')
  const [selected, setSelected]               = useState([])
  const [agencies, setAgencies]               = useState([])
  const [assistanceTypes, setAssistanceTypes] = useState([])
  const [loadingAgencies, setLoadingAgencies] = useState(true)
  const [loadingTypes, setLoadingTypes]       = useState(true)
  const [activeAgencyIds,    setActiveAgencyIds]    = useState(new Set())
  const [completedAgencyIds, setCompletedAgencyIds] = useState(new Set())

  // Load enabled agencies from Firestore
  useEffect(() => {
    const q = query(collection(db, 'agencies'), where('enabled', '==', true))
    const unsub = onSnapshot(q, snap => {
      setAgencies(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoadingAgencies(false)
    })
    return unsub
  }, [])

  // Load assistance types from Firestore sorted by order
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'assistanceTypes'), orderBy('order', 'asc')),
      snap => {
        setAssistanceTypes(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setLoadingTypes(false)
      }
    )
    return unsub
  }, [])

  // Load patient's active applications to show "already applied" on results
  useEffect(() => {
    if (!user?.uid) return
    getDocs(query(collection(db, 'applications'), where('patientId', '==', user.uid)))
      .then(snap => {
        const docs = snap.docs.map(d => d.data())
        setActiveAgencyIds(new Set(
          docs.filter(d => !['rejected', 'certificate'].includes(d.status)).map(d => d.agencyId)
        ))
        setCompletedAgencyIds(new Set(
          docs.filter(d => d.status === 'certificate').map(d => d.agencyId)
        ))
      })
  }, [user?.uid])

  const loading = loadingAgencies || loadingTypes

  // Deduplicate by name in case Firestore has duplicate entries
  const uniqueTypes = assistanceTypes.filter(
    (type, i, arr) => arr.findIndex(x => x.name === type.name) === i
  )

  const toggleType = (name) => {
    setSelected(prev =>
      prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name]
    )
  }

  // Match selected assistance type names against agency coverage
  const getResults = () => {
    return agencies
      .map(agency => {
        const agencyTypes = agency.assistanceTypes ?? []
        const matched = selected.filter(selectedName =>
          agencyTypes.some(t =>
            t.toLowerCase().trim() === selectedName.toLowerCase().trim()
          )
        ).length
        const score = selected.length > 0
          ? Math.round((matched / selected.length) * 100)
          : 50
        return { ...agency, matchScore: Math.min(score, 100) }
      })
      .sort((a, b) => b.matchScore - a.matchScore)
  }

  // ── Questions ─────────────────────────────────────────────────────────

  if (step === 'questions') return (
    <Layout breadcrumb={t('patient.screening.breadcrumb')}>
      <div className="p-4 sm:p-6">
        <div className="max-w-2xl mx-auto">
          <div className="card p-6">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-gray-900">{t('patient.screening.questionsTitle')}</h2>
              <p className="text-sm text-gray-500 mt-1">
                {t('patient.screening.questionsSub')}
              </p>
            </div>

            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                {[1,2,3,4].map(i => (
                  <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : assistanceTypes.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">
                {t('patient.screening.noTypesYet')}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                {uniqueTypes.map(type => {
                  const isSelected = selected.includes(type.name)
                  return (
                    <button
                      key={type.id}
                      onClick={() => toggleType(type.name)}
                      className={`text-left p-3.5 rounded-xl border-2 transition-all ${
                        isSelected
                          ? 'border-brand-500 bg-brand-50'
                          : 'border-gray-100 bg-white hover:border-gray-200'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className={`flex-shrink-0 w-5 h-5 rounded border-2 mt-0.5 flex items-center justify-center
                          ${isSelected ? 'border-brand-500 bg-brand-500' : 'border-gray-300'}`}>
                          {isSelected && <MdCheck size={12} className="text-white" />}
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${isSelected ? 'text-brand-700' : 'text-gray-700'}`}>
                            {type.name}
                          </p>
                          {type.description && (
                            <p className="text-sm text-gray-400 mt-0.5">{type.description}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            <p className="text-xs text-gray-400 flex items-center gap-1 mb-4">
              <MdInfo size={14} /> {t('patient.screening.privacy')}
            </p>

            <button
              className="btn-primary w-full flex items-center justify-center gap-2 py-2.5"
              disabled={selected.length === 0 || loading}
              onClick={() => setStep('results')}
            >
              {t('patient.screening.seeMatches')} <MdArrowForward size={18} />
            </button>

            {selected.length === 0 && !loading && (
              <p className="text-xs text-gray-400 text-center mt-3">
                {t('patient.screening.selectAtLeast')}
              </p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )

  // ── Results ───────────────────────────────────────────────────────────

  const matchLabel = (score) => {
    if (score === 100) return { label: t('patient.screening.match.perfect'), cls: 'bg-green-100 text-green-700 border border-green-200' }
    if (score >= 70)   return { label: t('patient.screening.match.great'),   cls: 'bg-green-100 text-green-700 border border-green-200' }
    if (score >= 40)   return { label: t('patient.screening.match.partial'), cls: 'bg-amber-100 text-amber-700 border border-amber-200' }
    return                    { label: t('patient.screening.match.low'),     cls: 'bg-red-100   text-red-600   border border-red-200'   }
  }

  const results = getResults().filter(a => a.matchScore > 0)
  return (
    <Layout breadcrumb={t('patient.screening.breadcrumb')}>
      <div className="p-4 sm:p-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="page-title">{t('patient.screening.resultsTitle')}</h1>
              <p className="page-sub">
                {results.length === 0
                  ? t('patient.screening.resultsNone')
                  : results.length === 1
                    ? t('patient.screening.resultsCountOne')
                    : t('patient.screening.resultsCountMany', { count: results.length })}
              </p>
            </div>
            <button className="btn-secondary text-sm flex-shrink-0" onClick={() => setStep('questions')}>
              ← {t('patient.screening.changeAnswers')}
            </button>
          </div>

          {/* Selected types summary */}
          {selected.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-5 p-3 bg-gray-50 rounded-xl border border-gray-100">
              <span className="text-xs text-gray-500 font-medium flex-shrink-0">{t('patient.screening.selectedLabel')}</span>
              {selected.map(s => (
                <span key={s} className="text-xs bg-white border border-gray-200 text-gray-700 px-2.5 py-1 rounded-lg font-medium">
                  {s}
                </span>
              ))}
            </div>
          )}

          {results.length === 0 && (
            <div className="card p-8 text-center">
              <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <MdLocalHospital size={28} className="text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-600 mb-1">{t('patient.screening.noMatchTitle')}</p>
              <p className="text-sm text-gray-400 mb-5">
                {t('patient.screening.noMatchDesc')}
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <button className="btn-primary text-sm" onClick={() => setStep('questions')}>
                  ← {t('patient.screening.changeAnswers')}
                </button>
                <button className="btn-secondary text-sm" onClick={() => navigate('/patient/programs')}>
                  {t('patient.screening.browseAll')} →
                </button>
              </div>
            </div>
          )}

          {/* Blocked state explanation */}
          {activeAgencyIds.size > 0 && results.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start justify-between gap-3 mb-4">
              <p className="text-sm text-amber-700">
                {t('patient.screening.activeAppWarning')}
              </p>
              <button
                className="text-sm font-semibold text-amber-700 hover:text-amber-900 whitespace-nowrap flex-shrink-0 underline"
                onClick={() => navigate('/patient/status')}>
                {t('patient.screening.viewMyApp')} →
              </button>
            </div>
          )}

          <div className="space-y-3 mb-4">
            {results.map((agency, i) => {
              const slots  = agency.slots ?? { total: 0, remaining: 0 }
              const isFull = slots.remaining === 0
              const pct    = slots.total > 0 ? Math.round((slots.remaining / slots.total) * 100) : 0
              const status = SLOT_STATUS(slots.remaining, slots.total)
              return (
                <div key={agency.id} className={`card p-4 ${i === 0 ? 'border-2 border-brand-400' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className={`flex-shrink-0 w-10 h-10 ${agency.color} rounded-xl text-white text-xs font-bold flex items-center justify-center`}>
                      {agency.initials}
                    </div>
                    <div className="flex-1 min-w-0">

                      {/* Name + Top Pick + Match badge */}
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <h3 className="text-sm font-semibold text-gray-800">{agency.name}</h3>
                          {i === 0 && agency.matchScore >= 70 && (
                            <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-brand-50 text-brand-600 border border-brand-200 flex-shrink-0">
                              <MdStar size={12} /> {t('patient.screening.topPick')}
                            </span>
                          )}
                        </div>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${matchLabel(agency.matchScore).cls}`}>
                          {matchLabel(agency.matchScore).label}
                        </span>
                      </div>

                      {/* Description */}
                      {agency.description && (
                        <p className="text-sm text-gray-500 leading-relaxed mb-2 line-clamp-2">{agency.description}</p>
                      )}

                      {/* Assistance type tags */}
                      {(agency.assistanceTypes ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {(agency.assistanceTypes ?? []).slice(0, 4).map((typeName, j) => (
                            <span key={j} className="badge badge-blue text-xs">{typeName}</span>
                          ))}
                          {(agency.assistanceTypes ?? []).length > 4 && (
                            <span className="badge badge-blue text-xs">{t('patient.screening.moreTypes', { count: (agency.assistanceTypes ?? []).length - 4 })}</span>
                          )}
                        </div>
                      )}

                      {/* Slot bar */}
                      <div className="w-full h-2 bg-gray-100 rounded-full mb-1">
                        <div className={`h-2 rounded-full ${status.bar}`} style={{ width: `${pct}%` }} />
                      </div>

                      {/* Slot text + processing time */}
                      <div className="flex items-center justify-between mb-3">
                        <span className={`flex items-center gap-1 text-xs ${isFull ? 'text-red-500' : 'text-green-600'}`}>
                          {isFull
                            ? <><MdBlock size={13} /> {t('patient.screening.noSlotsToday')}</>
                            : <><MdCheckCircle size={13} /> {t('patient.screening.slotsAvailable', { remaining: slots.remaining, total: slots.total })}</>}
                        </span>
                        {agency.processingTime && (
                          <span className="flex items-center gap-1 text-xs text-gray-400">
                            <MdSchedule size={13} /> {agency.processingTime}
                          </span>
                        )}
                      </div>

                      {/* Action */}
                      <div className="flex justify-end">
                        {activeAgencyIds.has(agency.id) ? (
                          <span className="flex items-center gap-1 text-xs text-green-600 border border-green-200 bg-green-50 px-2.5 py-1 rounded-lg font-medium">
                            <MdCheckCircle size={12} /> {t('patient.screening.applied')}
                          </span>
                        ) : completedAgencyIds.has(agency.id) ? (
                          <span className="flex items-center gap-1 text-xs text-gray-500 border border-gray-200 bg-gray-50 px-2.5 py-1 rounded-lg font-medium">
                            {t('patient.screening.glIssued')}
                          </span>
                        ) : activeAgencyIds.size > 0 ? (
                          <button
                            className="flex items-center gap-1 text-xs text-brand-600 border border-brand-200 bg-brand-50 px-2.5 py-1 rounded-lg font-medium hover:bg-brand-100 transition-colors"
                            onClick={() => navigate('/patient/status')}>
                            {t('patient.screening.viewMyApp')} →
                          </button>
                        ) : (
                          <button
                            className="btn-primary text-sm"
                            disabled={isFull}
                            onClick={() => navigate('/patient/programs', { state: { openAgencyId: agency.id } })}
                          >
                            {t('patient.screening.applyNow')} →
                          </button>
                        )}
                      </div>

                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {results.length > 0 && (
            <div className="text-center pt-2">
              <p className="text-sm text-gray-400 mb-1">{t('patient.screening.lookingForElse')}</p>
              <button
                className="text-sm text-brand-500 hover:text-brand-600 font-medium"
                onClick={() => navigate('/patient/programs')}>
                {t('patient.screening.browseAllSimple')} →
              </button>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
