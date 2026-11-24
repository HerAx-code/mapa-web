import { useNavigate } from 'react-router-dom'
import { useRef, useState, useEffect } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { useAuth } from '../../contexts/AuthContext'
import { ROLES } from '../../utils/constants'
import { accessCodePrefixFor, ORG } from '../../config/org'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase'
import {
  MdShield, MdArrowForward, MdDownload, MdClose, MdLogin,
  // Professional line icons replacing the emoji (a govt/medical portal
  // reads as amateur with emoji — matches CLAUDE.md "civic, professional").
  MdMailOutline, MdLocationOn, MdLocalHospital, MdSchedule,
  MdCheck, MdWarningAmber, MdChevronRight, MdConfirmationNumber,
  MdExpandMore, MdGroups, MdMoneyOff, MdFavorite,
} from 'react-icons/md'
import Logo from '../../components/ui/Logo'
import TermsModal from '../../components/TermsModal'
import LanguageToggle from '../../components/LanguageToggle'
import { usePublicHospitals } from '../../hooks/usePublicHospitals'

// Per-role landing destination when a signed-in user hits Landing or
// the PWA bounces them out of standalone mode. Patient lands on the
// Dashboard to orient first, rather than straight into the wizard.
const DASHBOARD = {
  [ROLES.PATIENT]:      '/patient/dashboard',
  [ROLES.AGENCY]:       '/agency/dashboard',
  [ROLES.AGENCY_ADMIN]: '/agency/dashboard',
  [ROLES.SUPER_ADMIN]:  '/admin/dashboard',
  [ROLES.STAFF_ADMIN]:  '/admin/dashboard',
  [ROLES.PLATFORM_ADMIN]: '/platform/hospitals',
}

// The application journey uses the SAME stages, in the same words, as the
// patient's own tracker (patient.journey.stage.*), so what a visitor reads here
// is what they see on their status page later (landing relayout 2026-11-24).
const JOURNEY = ['submitted', 'under_review', 'assessment', 'endorsed', 'funding', 'complete']

const HOSPITALS_SHOWN = 4

// One section-header treatment used everywhere on the page — a warm display
// heading with a short amber accent bar.
function SectionHead({ title, sub }) {
  return (
    <div className="max-w-2xl mb-8">
      <h2 className="font-display text-[26px] sm:text-[32px] font-bold tracking-tight text-brand-900 leading-tight">
        {title}
      </h2>
      <div className="mt-3 h-1 w-12 rounded-full bg-amber-400" />
      {sub && <p className="mt-4 text-[15px] text-gray-500 leading-relaxed">{sub}</p>}
    </div>
  )
}

// Landing relayout (2026-11-24): seven blocks, each message said once, in the
// order a first-time visitor on a phone needs it — hero with the one journey,
// who can apply + the code, free + scam warning, hospital offices, FAQ, a
// one-line band for hospitals, footer. Agencies appear by name only, in the
// FAQ: patients don't choose an agency (the hospital endorses), so there are
// no public slot counts.
export default function Landing() {
  const navigate   = useNavigate()
  const { t }      = useTranslation()
  const { user }   = useAuth()
  const journeyRef = useRef(null)
  const officesRef = useRef(null)

  const [showPrivacy, setShowPrivacy] = useState(false)
  const [showTerms, setShowTerms]     = useState(false)
  const [agencies, setAgencies]       = useState([])
  const [showAllHospitals, setShowAllHospitals] = useState(false)
  // Participating hospitals (public projection, multi-hospital).
  const hospitals = usePublicHospitals()

  // Installed-PWA users have no reason to see the marketing landing page:
  // send them to login (or their dashboard if already signed in).
  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    if (!isStandalone) return
    if (user) navigate(DASHBOARD[user.role] ?? '/patient/dashboard', { replace: true })
    else      navigate('/login', { replace: true })
  }, [user, navigate])

  useEffect(() => {
    // Partner names only, from the public projection (agenciesPublic is
    // written by onAgencyWritten; the rich `agencies` doc is auth-gated).
    // Empty until synced — the FAQ answer then simply lists none.
    const unsub = onSnapshot(
      query(collection(db, 'agenciesPublic'), where('enabled', '==', true)),
      snap => setAgencies(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(a => a.name)
          .sort((a, b) => a.name.localeCompare(b.name))
      ),
      () => {}
    )
    return unsub
  }, [])

  // Escape closes the Privacy Notice.
  useEffect(() => {
    if (!showPrivacy) return
    const onKey = e => { if (e.key === 'Escape') setShowPrivacy(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showPrivacy])

  // A signed-in user's ORG is their hospital; a visitor sees the network.
  const scoped = !!user?.tenantId
  const visibleHospitals = showAllHospitals ? hospitals : hospitals.slice(0, HOSPITALS_SHOWN)
  // An example access code from a real participating hospital.
  const exampleCode = `${hospitals[0]?.accessCodePrefix ?? accessCodePrefixFor(new Date().getFullYear()).split('-')[0]}-${new Date().getFullYear()}-00042`

  const scrollTo = ref => ref.current?.scrollIntoView({ behavior: 'smooth' })
  const handleMainCTA = () => {
    if (user) navigate(DASHBOARD[user.role] ?? '/patient/dashboard')
    else navigate('/register')
  }

  return (
    <div className="min-h-screen bg-canvas text-gray-800">
      {/* Topbar — brand left; language + install as icon actions; Register
          (primary) + Log In (secondary, an icon on the narrowest phones), or a
          single Dashboard button when signed in. */}
      <header className="sticky top-0 z-30 border-b border-brand-900/5 bg-canvas/95 backdrop-blur px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
        <Logo size={30} withWordmark />
        <nav aria-label={t('landing.nav.how')} className="hidden md:flex items-center gap-6 text-[14px] font-medium text-gray-600">
          <button type="button" className="hover:text-brand-700 transition-colors" onClick={() => scrollTo(journeyRef)}>{t('landing.nav.how')}</button>
          <button type="button" className="hover:text-brand-700 transition-colors" onClick={() => scrollTo(officesRef)}>{t('landing.nav.offices')}</button>
          <button type="button" className="hover:text-brand-700 transition-colors" onClick={() => navigate('/for-hospitals')}>{t('landing.nav.forHospitals')}</button>
        </nav>
        <div className="flex items-center gap-1">
          <LanguageToggle />
          <button
            type="button"
            aria-label={t('landing.header.downloadApp')}
            title={t('landing.header.downloadApp')}
            className="hidden min-[400px]:flex items-center justify-center w-11 h-11 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
            onClick={() => navigate('/install')}>
            <MdDownload size={18} />
          </button>
          {user ? (
            <button
              className="btn-primary text-sm whitespace-nowrap ml-1"
              onClick={() => navigate(DASHBOARD[user.role] ?? '/')}>
              {t('landing.header.dashboard')}
            </button>
          ) : (
            <>
              <button
                className="btn-secondary text-sm whitespace-nowrap px-3 sm:px-4"
                aria-label={t('landing.header.login')}
                onClick={() => navigate('/login')}>
                <MdLogin size={18} className="sm:hidden" />
                <span className="hidden sm:inline">{t('landing.header.login')}</span>
              </button>
              <button
                className="btn-primary text-sm whitespace-nowrap px-3 sm:px-4"
                onClick={() => navigate('/register')}>
                {t('landing.header.register')}
              </button>
            </>
          )}
        </div>
      </header>

      {/* 1 · Hero — headline, one-sentence tagline, sign up or find an office,
          and the one application journey (the tracker's own stages). The card
          is illustrative, NOT a live status lookup (no anonymous
          status-by-reference — that would be an enumeration risk). */}
      <section className="relative overflow-hidden">
        <div className="hero-aurora" aria-hidden="true" />
        <div aria-hidden="true" className="pointer-events-none absolute -top-20 right-[-4rem] h-80 w-80 rounded-full bg-amber-200/25 blur-3xl" />
        <div className="relative max-w-5xl mx-auto grid gap-10 px-5 sm:px-6 py-12 sm:py-16 lg:grid-cols-2 lg:items-center lg:gap-12 lg:py-20">
          <div>
            <div className="hero-rise inline-flex items-center gap-2 bg-white border border-brand-100 rounded-full px-4 py-1.5 text-xs text-brand-700 font-semibold mb-6 shadow-sm">
              <MdShield size={14} className="text-brand-500" />
              {scoped ? t('landing.hero.badge') : t('landing.hero.badgeNetwork')}
            </div>
            <h1 className="hero-rise font-display text-[34px] leading-[1.1] sm:text-5xl lg:text-[50px] font-extrabold tracking-tight text-brand-900 mb-5 max-w-xl" style={{ animationDelay: '90ms' }}>
              {scoped ? t('landing.hero.headline') : t('landing.hero.headlineNetwork')}
            </h1>
            {/* A signed-in patient sees their hospital's address (if set);
                a visitor sees the network, so no single hospital's address. */}
            {scoped && ORG.address && (
              <p className="hero-rise text-gray-500 text-sm mb-3 flex items-center gap-1.5" style={{ animationDelay: '170ms' }}>
                <MdLocationOn size={16} className="text-brand-500" /> {ORG.address}
              </p>
            )}
            <p className="hero-rise text-gray-600 text-lg mb-8 max-w-xl leading-relaxed" style={{ animationDelay: '230ms' }}>
              {t('landing.hero.tagline')}
            </p>
            <div className="hero-rise flex flex-col gap-3 sm:flex-row sm:items-center" style={{ animationDelay: '310ms' }}>
              <button
                className="btn-primary flex items-center justify-center gap-2 px-6 py-3 text-base w-full sm:w-auto shadow-lg shadow-brand-900/15"
                onClick={handleMainCTA}>
                {user ? t('landing.hero.ctaDashboard') : t('landing.cta.createAccount')}
                <MdArrowForward size={18} />
              </button>
              <button
                className="btn-secondary flex items-center justify-center gap-2 px-6 py-3 text-base w-full sm:w-auto"
                onClick={() => scrollTo(officesRef)}>
                <MdLocalHospital size={18} /> {t('landing.hero.findOffice')}
              </button>
            </div>
            <p className="hero-rise mt-5 flex items-center gap-2 text-sm font-medium text-brand-800" style={{ animationDelay: '390ms' }}>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                <MdCheck size={13} />
              </span>
              {t('landing.hero.free')}
            </p>
          </div>

          <div ref={journeyRef} className="hero-rise lp-card p-6 sm:p-7 lg:justify-self-end w-full max-w-md scroll-mt-20" style={{ animationDelay: '240ms' }}>
            <h2 className="font-display text-lg font-bold tracking-tight text-brand-900">
              {t('landing.hero.journeyTitle')}
            </h2>
            <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">
              {t('landing.hero.journeyDesc')}
            </p>
            <ol className="mt-6">
              {JOURNEY.map((key, i) => (
                <li key={key} className="hero-step flex gap-3" style={{ animationDelay: `${460 + i * 100}ms` }}>
                  <div className="flex flex-col items-center">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white text-xs font-bold ring-4 ring-brand-50">
                      {i + 1}
                    </span>
                    {i < JOURNEY.length - 1 && <span className="w-px flex-1 bg-brand-100 my-1 min-h-[16px]" />}
                  </div>
                  <div className={i < JOURNEY.length - 1 ? 'pb-4' : ''}>
                    <p className="text-sm font-semibold text-gray-800">{t(`patient.journey.stage.${key}.label`)}</p>
                    <p className="mt-0.5 text-sm text-gray-500 leading-snug">{t(`landing.journey.${key}`)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* 2 · Who can apply + the Patient Access Code — the real gate to filing.
          New visitors only. */}
      {!user && <section id="eligibility" className="px-5 sm:px-6 py-14 sm:py-20">
        <div className="max-w-5xl mx-auto">
          <SectionHead title={t('landing.eligibility.title')} sub={t('landing.eligibility.intro')} />
          <div className="grid gap-6 lg:grid-cols-12 lg:gap-8 lg:items-start">
            <div className="lg:col-span-7">
              <div className="lp-card p-6 sm:p-7">
                <h3 className="text-base font-semibold text-gray-900 mb-4">{t('landing.eligibility.qualifyHeading')}</h3>
                <ul className="space-y-3.5">
                  {['q1', 'q2', 'q3'].map(k => (
                    <li key={k} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white">
                        <MdCheck size={14} />
                      </span>
                      <span className="text-sm leading-relaxed text-gray-700">{t(`landing.eligibility.${k}`)}</span>
                    </li>
                  ))}
                </ul>
                {/* Scope (Phase 2A): admitted patients and outpatients at the
                    hospital's own units — say plainly what isn't covered. */}
                <p className="mt-4 rounded-xl bg-gray-50 px-3.5 py-2.5 text-xs leading-relaxed text-gray-600">{t('landing.eligibility.notCovered')}</p>
                <p className="mt-4 text-sm text-gray-600">{t('landing.eligibility.signupNeeds')}</p>
              </div>
            </div>
            {/* Access-code card — amber, because it's the one thing they must
                get in person (and the anti-scam point). */}
            <div className="lg:col-span-5">
              <div className="lp-card border-amber-200/70 bg-gradient-to-b from-amber-50 to-white p-6 sm:p-7">
                <span className="lp-chip bg-white text-amber-600 shadow-sm">
                  <MdConfirmationNumber size={24} />
                </span>
                <h3 className="mt-4 font-display text-lg font-bold text-gray-900">{t('landing.eligibility.codeHeading')}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{t('landing.eligibility.codeBody')}</p>
                <div className="mt-5 rounded-xl border border-dashed border-amber-400 bg-white px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t('landing.eligibility.codeSample')}</p>
                  <p className="mt-1 font-mono text-lg font-semibold tracking-[0.18em] text-gray-900 break-all">
                    {exampleCode}
                  </p>
                </div>
                <button type="button" onClick={() => scrollTo(officesRef)}
                  className="mt-5 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800 transition-colors">
                  {t('landing.eligibility.codeCta')} <MdChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>}

      {/* 3 · Applying is free — the biggest trust question for an indigent
          patient, plus the warning against fixers. New visitors only. */}
      {!user && <section className="px-5 sm:px-6 pb-4">
        <div className="max-w-5xl mx-auto">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 to-brand-800 p-7 sm:p-9 shadow-xl shadow-brand-900/25">
            <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/5" />
            <div className="relative grid gap-6 lg:grid-cols-12 lg:items-center lg:gap-12">
              <div className="lg:col-span-7">
                <div className="flex items-center gap-3 mb-3">
                  <span className="lp-chip h-10 w-10 bg-white/10 text-amber-300">
                    <MdMoneyOff size={22} />
                  </span>
                  <h2 className="font-display text-[24px] sm:text-3xl font-bold text-white">{t('landing.cost.title')}</h2>
                </div>
                <p className="text-brand-50/90 text-[15px] leading-relaxed max-w-xl">{t('landing.cost.body')}</p>
              </div>
              <div className="lg:col-span-5">
                <div className="flex items-start gap-3 rounded-2xl border border-amber-400/40 bg-brand-900/40 p-5">
                  <MdWarningAmber size={22} className="mt-0.5 flex-shrink-0 text-amber-400" />
                  <p className="text-sm leading-relaxed text-brand-50">{t('landing.cost.warning')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>}

      {/* 4 · Visit a hospital office — the human fallback for people who can't
          apply online, and the one list of participating hospitals (each with
          the code prefix it issues). Everyone. */}
      <section id="help" ref={officesRef} className="px-5 sm:px-6 py-14 sm:py-20 scroll-mt-14">
        <div className="max-w-5xl mx-auto grid gap-8 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-5">
            <SectionHead title={t('landing.help.title')} sub={t('landing.help.intro')} />
            <div className="flex items-start gap-3 rounded-2xl bg-brand-50 p-4">
              <MdGroups size={22} className="mt-0.5 flex-shrink-0 text-brand-700" />
              <p className="text-sm font-medium leading-relaxed text-brand-800">{t('landing.help.onsite')}</p>
            </div>
          </div>
          <div className="lg:col-span-7">
            {/* Each participating hospital's own office (hospitalsPublic) —
                no single hospital's address or phone is written into the page. */}
            <ul className="lp-card divide-y divide-gray-100 px-5 sm:px-6">
              {visibleHospitals.map(h => (
                <li key={h.id} className="flex gap-4 py-4">
                  <span className="lp-chip h-10 w-10 bg-brand-50 text-brand-600">
                    <MdLocalHospital size={18} />
                  </span>
                  <div className="min-w-0 text-sm leading-relaxed">
                    <p className="font-semibold text-gray-900">{h.facilityName}</p>
                    {h.gatewayName && <p className="text-gray-600">{h.gatewayName}</p>}
                    {h.address && <p className="mt-1 flex gap-1.5 text-gray-600"><MdLocationOn size={16} className="mt-0.5 flex-shrink-0 text-brand-500" />{h.address}</p>}
                    {h.contactEmail && <p className="flex gap-1.5 text-gray-600 break-all"><MdMailOutline size={16} className="mt-0.5 flex-shrink-0 text-brand-500" />{h.contactEmail}</p>}
                    <p className="mt-1 text-xs text-gray-500">{t('landing.help.codePrefix', { prefix: h.accessCodePrefix })}</p>
                  </div>
                </li>
              ))}
              {hospitals.length > HOSPITALS_SHOWN && (
                <li className="py-3">
                  <button type="button"
                    className="inline-flex min-h-[44px] items-center text-sm font-semibold text-brand-700 hover:text-brand-800 transition-colors"
                    onClick={() => setShowAllHospitals(v => !v)}>
                    {showAllHospitals
                      ? t('landing.help.showFewer')
                      : t('landing.help.showAll', { count: hospitals.length })}
                  </button>
                </li>
              )}
              <li className="flex gap-4 py-4">
                <span className="lp-chip h-10 w-10 bg-brand-50 text-brand-600"><MdSchedule size={18} /></span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('landing.help.hoursLabel')}</p>
                  <p className="mt-1 text-sm leading-relaxed text-gray-900">{t('landing.help.hours')}</p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* 5 · FAQ — the real questions a worried first-time applicant asks.
          Native <details> (zero JS, accessible). The funding-agency answer
          lists partner names only. Everyone. */}
      <section id="faq" className="px-5 sm:px-6 pb-16 sm:pb-20">
        <div className="max-w-5xl mx-auto">
          <SectionHead title={t('landing.faq.heading')} sub={t('landing.faq.intro')} />
          <div className="lp-card divide-y divide-gray-100 px-5 sm:px-6 max-w-3xl">
            {['1', '2', '3', '4', '5', '7', '8', '9', '6'].map(n => (
              <details key={n} className="group">
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden py-4 min-h-[44px] text-[15px] font-semibold text-gray-900">
                  <span>{t(`landing.faq.q${n}`)}</span>
                  <span className="lp-chip h-8 w-8 bg-brand-50 text-brand-600 transition-transform group-open:rotate-180">
                    <MdExpandMore size={20} />
                  </span>
                </summary>
                <p className="pb-4 pr-4 text-sm leading-relaxed text-gray-600">{t(`landing.faq.a${n}`)}</p>
                {n === '9' && agencies.length > 0 && (
                  <ul className="pb-4 flex flex-wrap gap-2" aria-label={t('landing.faq.partnersLabel')}>
                    {agencies.map(a => (
                      <li key={a.id} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">{a.name}</li>
                    ))}
                  </ul>
                )}
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* 6 · For hospitals — one line; the full pitch lives at /for-hospitals. */}
      <section className="border-t border-brand-900/5 bg-white px-5 sm:px-6">
        <div className="max-w-5xl mx-auto py-8 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          <span className="lp-chip h-10 w-10 bg-brand-50 text-brand-600"><MdLocalHospital size={20} /></span>
          <div className="min-w-0">
            <p className="font-display text-lg font-bold text-brand-900">{t('landing.hospitals.title')}</p>
            <p className="text-sm text-gray-600">{t('landing.hospitals.body')}</p>
          </div>
          <button type="button" onClick={() => navigate('/for-hospitals')}
            className="btn-secondary sm:ml-auto self-start sm:self-auto min-h-[44px] whitespace-nowrap">
            {t('landing.hospitals.cta')}
          </button>
        </div>
      </section>

      {/* Footer — deep pine to close the page in the brand colour. */}
      <footer className="bg-brand-900 text-white pt-14 pb-6 px-5 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-10">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Logo size={32} />
                <div>
                  <p className="text-sm font-bold">MAPA</p>
                  <p className="text-xs text-brand-200/80">Medical Assistance Portal Access</p>
                </div>
              </div>
              <p className="text-xs text-brand-100/70 leading-relaxed">
                {t('landing.footer.brandDesc')}
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold text-brand-100 uppercase tracking-widest mb-3">{t('landing.footer.quickLinks')}</p>
              <ul className="space-y-2">
                {user ? (
                  <li>
                    <button onClick={() => navigate(DASHBOARD[user.role] ?? '/')}
                      className="text-xs text-brand-100/70 hover:text-white transition-colors">
                      {t('landing.footer.dashboard')}
                    </button>
                  </li>
                ) : (
                  <>
                    <li>
                      <button onClick={() => navigate('/register')}
                        className="text-xs text-brand-100/70 hover:text-white transition-colors">
                        {t('landing.footer.registerPatient')}
                      </button>
                    </li>
                    <li>
                      <button onClick={() => navigate('/login')}
                        className="text-xs text-brand-100/70 hover:text-white transition-colors">
                        {t('landing.footer.login')}
                      </button>
                    </li>
                  </>
                )}
                <li>
                  <button onClick={() => scrollTo(journeyRef)}
                    className="text-xs text-brand-100/70 hover:text-white transition-colors">
                    {t('landing.footer.howItWorks')}
                  </button>
                </li>
                <li>
                  <button onClick={() => navigate('/for-hospitals')}
                    className="text-xs text-brand-100/70 hover:text-white transition-colors">
                    {t('landing.footer.forHospitals')}
                  </button>
                </li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold text-brand-100 uppercase tracking-widest mb-3">{t('landing.footer.contact')}</p>
              <ul className="space-y-2 text-xs text-brand-100/70">
                <li className="flex items-center gap-2">
                  <MdMailOutline size={15} className="flex-shrink-0 text-brand-300" />
                  <span className="break-all">{ORG.contactEmail}</span>
                </li>
                <li>
                  <button onClick={() => scrollTo(officesRef)} className="hover:text-white transition-colors">{t('landing.footer.officesLink')}</button>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-brand-100/60 flex items-center gap-1.5">
              <MdFavorite size={12} className="text-amber-400" />
              {t('landing.footer.copyright', { year: new Date().getFullYear() })}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-brand-100/60">
              <button onClick={() => setShowPrivacy(true)} className="hover:text-white transition-colors">
                {t('landing.footer.privacy')}
              </button>
              <span aria-hidden="true">·</span>
              <button onClick={() => setShowTerms(true)} className="hover:text-white transition-colors">
                {t('terms.title')}
              </button>
              <span aria-hidden="true">·</span>
              {/* "Official portal" only for a signed-in user's own hospital; a
                  visitor is on the network page, not one hospital's portal. */}
              <span>{scoped ? t('landing.footer.officialPortal') : t('landing.footer.network')}</span>
            </div>
          </div>
        </div>
      </footer>

      {/* Privacy Notice dialog */}
      {showPrivacy && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setShowPrivacy(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="privacy-title"
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <h2 id="privacy-title" className="text-base font-semibold text-gray-900">{t('landing.privacy.title')}</h2>
              <button autoFocus onClick={() => setShowPrivacy(false)} aria-label={t('landing.privacy.close')}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700">
                <MdClose size={20} />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4 space-y-4 text-sm">
              <p className="text-xs text-gray-500">
                {t('landing.privacy.intro')}
              </p>
              {[
                { title: t('landing.privacy.dataTitle'),   items: [t('landing.privacy.data1'),   t('landing.privacy.data2'),   t('landing.privacy.data3'),   t('landing.privacy.data4'), t('landing.privacy.data5')] },
                { title: t('landing.privacy.useTitle'),    items: [t('landing.privacy.use1'),    t('landing.privacy.use2'),    t('landing.privacy.use3'),    t('landing.privacy.use4'),  t('landing.privacy.use5')]  },
                { title: t('landing.privacy.accessTitle'), items: [t('landing.privacy.access1'), t('landing.privacy.access2'), t('landing.privacy.access3'), t('landing.privacy.access4')] },
              ].map((sec, i) => (
                <div key={i}>
                  <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">{sec.title}</p>
                  <ul className="space-y-1">
                    {sec.items.map((item, j) => (
                      <li key={j} className="flex items-start gap-2 text-xs text-gray-600">
                        <span className="text-brand-400 flex-shrink-0 mt-0.5">•</span>{item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                <p className="text-xs text-blue-700">
                  <Trans i18nKey="landing.privacy.contactNote" components={{ b: <strong /> }} />
                </p>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex-shrink-0">
              <button className="btn-secondary text-sm w-full" onClick={() => setShowPrivacy(false)}>{t('landing.privacy.close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Terms of Use modal (reuses the shared component + terms.* strings). */}
      <TermsModal
        open={showTerms}
        onClose={() => setShowTerms(false)}
        onPrivacy={() => { setShowTerms(false); setShowPrivacy(true) }}
      />
    </div>
  )
}
