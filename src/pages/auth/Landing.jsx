import { useNavigate } from 'react-router-dom'
import { useRef, useState, useEffect } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { useAuth } from '../../contexts/AuthContext'
import { ROLES } from '../../utils/constants'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase'
import {
  MdShield, MdArrowForward, MdDownload, MdClose,
  // Professional line icons replacing the emoji (a govt/medical portal
  // reads as amateur with emoji — matches CLAUDE.md "civic, professional").
  MdBadge, MdMailOutline, MdSmartphone, MdLocationOn,
  MdHowToReg, MdUploadFile, MdLocalHospital, MdVideocam, MdVerified,
  MdPhone, MdSchedule,
  MdCheck, MdWarningAmber, MdChevronRight, MdConfirmationNumber,
  MdExpandMore, MdGroups, MdMoneyOff, MdFavorite,
} from 'react-icons/md'
import Logo from '../../components/ui/Logo'
import AgencyAvatar from '../../components/AgencyAvatar'
import LanguageToggle from '../../components/LanguageToggle'

// Per-role landing destination when a signed-in user hits Landing or
// the PWA bounces them out of standalone mode. Patient lands on the
// Dashboard (status, steps, interviews) to match the home-base
// pattern used by every other surface in the app -- previously the
// patient was sent straight to /patient/request, which conflicted
// with the line-41 fallback ('/patient/dashboard') and threw a
// fresh patient straight into the wizard instead of letting them
// orient first.
const DASHBOARD = {
  [ROLES.PATIENT]:      '/patient/dashboard',
  [ROLES.AGENCY]:       '/agency/dashboard',
  [ROLES.AGENCY_ADMIN]: '/agency/dashboard',
  [ROLES.SUPER_ADMIN]:  '/admin/dashboard',
  [ROLES.STAFF_ADMIN]:  '/admin/dashboard',
}

// One section-header treatment used everywhere on the page — a warm display
// heading with a short amber accent bar. Repeating this exact motif (not a
// tracked all-caps eyebrow) is what makes the sections read as chapters of
// one page instead of unrelated bands.
function SectionHead({ title, sub, center = false }) {
  return (
    <div className={center ? 'text-center max-w-2xl mx-auto mb-10' : 'max-w-2xl mb-8'}>
      <h2 className="font-display text-[26px] sm:text-[32px] font-bold tracking-tight text-brand-900 leading-tight">
        {title}
      </h2>
      <div className={`mt-3 h-1 w-12 rounded-full bg-amber-400 ${center ? 'mx-auto' : ''}`} />
      {sub && <p className="mt-4 text-[15px] text-gray-500 leading-relaxed">{sub}</p>}
    </div>
  )
}

export default function Landing() {
  const navigate    = useNavigate()
  const { t }       = useTranslation()
  const { user }    = useAuth()
  const featuresRef = useRef(null)
  const programsRef = useRef(null)

  const [showPrivacy, setShowPrivacy] = useState(false)
  const [agencies, setAgencies]       = useState([])
  // Program-slot bars fill from empty the first time the Programs section
  // scrolls into view — motion that conveys the data (how full each program
  // is), not decoration. Starts already "in" under reduced motion so the
  // bars render at their real width with no animation.
  const [programsIn, setProgramsIn] = useState(
    () => typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  )

  // Installed-PWA users have no reason to see the marketing landing
  // page. The 'Download App' CTA is meaningless (they already have
  // the app), and the hero / partner showcase / footer wastes their
  // data plan on content meant for discovery. Detect standalone mode
  // and bounce them to login (or their dashboard if already signed
  // in). The page still renders normally in a regular browser tab.
  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    if (!isStandalone) return
    if (user) navigate(DASHBOARD[user.role] ?? '/patient/dashboard', { replace: true })
    else      navigate('/login', { replace: true })
  }, [user, navigate])

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'agencies'), where('enabled', '==', true)),
      snap => setAgencies(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => a.name?.localeCompare(b.name))
      ),
      () => {}
    )
    return unsub
  }, [])

  // Reveal the slot bars on first scroll into view. Skipped entirely under
  // reduced motion (programsIn already starts true there).
  useEffect(() => {
    if (programsIn) return
    const el = programsRef.current
    if (!el || typeof IntersectionObserver === 'undefined') { setProgramsIn(true); return }
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setProgramsIn(true); io.disconnect() } },
      { threshold: 0.2 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [programsIn])

  const handleMainCTA = () => {
    if (user) navigate(DASHBOARD[user.role] ?? '/patient/dashboard')
    else navigate('/register')
  }

  return (
    <div className="min-h-screen bg-[#FBFAF8] text-gray-800">
      {/* Topbar — sticky, on the warm ground with a soft blur so it belongs
          to the page rather than sitting on a hard white slab. */}
      <header className="sticky top-0 z-30 border-b border-brand-900/5 bg-[#FBFAF8]/85 backdrop-blur px-5 sm:px-6 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Logo size={32} withWordmark />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <LanguageToggle className="self-end sm:self-auto" />
          <button
            className="btn-secondary flex items-center justify-center gap-1.5 text-sm"
            onClick={() => navigate('/install')}>
            <MdDownload size={16} />
            {t('landing.header.downloadApp')}
          </button>
          {!user && (
            <button
              className="btn-secondary w-full sm:w-auto text-sm"
              onClick={() => navigate('/register')}>
              {t('landing.header.register')}
            </button>
          )}
          <button
            className="btn-primary w-full sm:w-auto"
            onClick={() => user ? navigate(DASHBOARD[user.role] ?? '/') : navigate('/login')}>
            {user ? t('landing.header.dashboard') : t('landing.header.login')}
          </button>
        </div>
      </header>

      {/* ── Hero — the emotional anchor. Warm, hopeful, human: soft aurora +
          an amber glow behind a big display headline, with the illustrative
          "application journey" as an elevated card. The card is deliberately
          static/illustrative, NOT a live status lookup (MAPA has no anonymous
          status-by-reference — that would be an enumeration risk). */}
      <section className="relative overflow-hidden">
        <div className="hero-aurora" aria-hidden="true" />
        <div aria-hidden="true" className="pointer-events-none absolute -top-20 right-[-4rem] h-80 w-80 rounded-full bg-amber-200/25 blur-3xl" />
        <div className="relative max-w-6xl mx-auto grid gap-12 px-5 sm:px-6 py-16 lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-24">
          {/* Left: copy + CTAs + proof points. Rises in on load as one
              continuous staggered sequence. */}
          <div>
            <div className="hero-rise inline-flex items-center gap-2 bg-white border border-brand-100 rounded-full px-4 py-1.5 text-xs text-brand-700 font-semibold mb-6 shadow-sm">
              <MdShield size={14} className="text-brand-500" />
              {t('landing.hero.badge')}
            </div>
            <h1 className="hero-rise font-display text-[38px] leading-[1.08] sm:text-5xl lg:text-[56px] font-extrabold tracking-tight text-brand-900 mb-5 max-w-xl" style={{ animationDelay: '90ms' }}>
              {t('landing.hero.headline')}
            </h1>
            <p className="hero-rise text-gray-500 text-sm mb-3 flex items-center gap-1.5" style={{ animationDelay: '170ms' }}>
              <MdLocationOn size={16} className="text-brand-500" /> {t('landing.hero.location')}
            </p>
            <p className="hero-rise text-gray-600 text-lg mb-8 max-w-xl leading-relaxed" style={{ animationDelay: '230ms' }}>
              {t('landing.hero.tagline')}
            </p>
            <div className="hero-rise flex flex-col gap-3 sm:flex-row sm:items-center" style={{ animationDelay: '310ms' }}>
              <button
                className="btn-primary flex items-center justify-center gap-2 px-6 py-3 text-base w-full sm:w-auto shadow-lg shadow-brand-900/15"
                onClick={handleMainCTA}>
                {user ? t('landing.hero.ctaDashboard') : t('landing.hero.ctaPatient')}
                <MdArrowForward size={18} />
              </button>
              <button
                className="btn-secondary px-6 py-3 text-base w-full sm:w-auto"
                onClick={() => featuresRef.current?.scrollIntoView({ behavior: 'smooth' })}>
                {t('landing.hero.learnMore')}
              </button>
            </div>
            {/* Proof points — honest value props, no fabricated stats */}
            <dl className="hero-rise mt-12 grid grid-cols-3 gap-x-6 gap-y-6 border-t border-brand-900/10 pt-8 max-w-xl" style={{ animationDelay: '390ms' }}>
              {[
                { value: t('landing.hero.proof1Value'), label: t('landing.hero.proof1Label') },
                { value: t('landing.hero.proof2Value'), label: t('landing.hero.proof2Label') },
                { value: t('landing.hero.proof3Value'), label: t('landing.hero.proof3Label') },
              ].map((p, i) => (
                <div key={i}>
                  <dd className="font-display text-2xl font-bold tracking-tight text-brand-900">{p.value}</dd>
                  <dt className="mt-1 text-sm text-gray-500 leading-snug">{p.label}</dt>
                </div>
              ))}
            </dl>
          </div>

          {/* Right: the illustrative application-journey card — the hero's
              memorable element. Elevated soft card; its steps build in one
              after another so the eye is walked down the patient's path. */}
          <div className="hero-rise lp-card p-6 sm:p-7 lg:justify-self-end w-full max-w-md" style={{ animationDelay: '240ms' }}>
            <h2 className="font-display text-lg font-bold tracking-tight text-brand-900">
              {t('landing.hero.journeyTitle')}
            </h2>
            <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">
              {t('landing.hero.journeyDesc')}
            </p>
            <ol className="mt-6">
              {[
                { label: t('landing.hero.stage1Label'), detail: t('landing.hero.stage1Detail') },
                { label: t('landing.hero.stage2Label'), detail: t('landing.hero.stage2Detail') },
                { label: t('landing.hero.stage3Label'), detail: t('landing.hero.stage3Detail') },
                { label: t('landing.hero.stage4Label'), detail: t('landing.hero.stage4Detail') },
              ].map((s, i, arr) => (
                <li key={i} className="hero-step flex gap-3" style={{ animationDelay: `${460 + i * 120}ms` }}>
                  <div className="flex flex-col items-center">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white text-xs font-bold ring-4 ring-brand-50">
                      {i + 1}
                    </span>
                    {i < arr.length - 1 && <span className="w-px flex-1 bg-brand-100 my-1 min-h-[20px]" />}
                  </div>
                  <div className={i < arr.length - 1 ? 'pb-5' : ''}>
                    <p className="text-sm font-semibold text-gray-800">{s.label}</p>
                    <p className="mt-0.5 text-sm text-gray-500 leading-snug">{s.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* Who can apply — eligibility checklist + the Patient Access Code,
          the real gate to registering. New visitors only. */}
      {!user && <section id="eligibility" className="px-5 sm:px-6 py-16 sm:py-20">
        <div className="max-w-5xl mx-auto">
          <SectionHead title={t('landing.eligibility.title')} sub={t('landing.eligibility.intro')} />
          <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
            {/* Qualify checklist */}
            <div className="lg:col-span-7">
              <div className="lp-card p-6 sm:p-7 h-full">
                <h3 className="text-base font-semibold text-gray-900 mb-4">{t('landing.eligibility.qualifyHeading')}</h3>
                <ul className="space-y-3.5">
                  {['q1', 'q2', 'q3', 'q4'].map(k => (
                    <li key={k} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white">
                        <MdCheck size={14} />
                      </span>
                      <span className="text-sm leading-relaxed text-gray-700">{t(`landing.eligibility.${k}`)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            {/* Access-code card — amber, because it's the one thing they must
                have before registering (and the anti-scam warning). */}
            <div className="lg:col-span-5">
              <div className="lp-card border-amber-200/70 bg-gradient-to-b from-amber-50 to-white p-6 sm:p-7 h-full">
                <span className="lp-chip bg-white text-amber-600 shadow-sm">
                  <MdConfirmationNumber size={24} />
                </span>
                <h3 className="mt-4 font-display text-lg font-bold text-gray-900">{t('landing.eligibility.codeHeading')}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{t('landing.eligibility.codeBody')}</p>
                <div className="mt-5 rounded-xl border border-dashed border-amber-400 bg-white px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t('landing.eligibility.codeSample')}</p>
                  <p className="mt-1 font-mono text-lg font-semibold tracking-[0.18em] text-gray-900">CRMC-2026-00042</p>
                </div>
                <a href="#help" className="mt-5 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800 transition-colors">
                  {t('landing.eligibility.codeCta')} <MdChevronRight size={16} />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>}

      {/* What to prepare — four warm chips on the same ground (no separate
          band), so it flows with the sections around it. New visitors only. */}
      {!user && <section className="px-5 sm:px-6 pb-4 sm:pb-8">
        <div className="max-w-5xl mx-auto">
          <SectionHead title={t('landing.prepare.heading')} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { Icon: MdBadge,        title: t('landing.prepare.codeTitle'),    desc: t('landing.prepare.codeDesc')    },
              { Icon: MdMailOutline,  title: t('landing.prepare.emailTitle'),   desc: t('landing.prepare.emailDesc')   },
              { Icon: MdSmartphone,   title: t('landing.prepare.mobileTitle'),  desc: t('landing.prepare.mobileDesc')  },
              { Icon: MdLocationOn,   title: t('landing.prepare.addressTitle'), desc: t('landing.prepare.addressDesc') },
            ].map((item, i) => (
              <div key={i} className="lp-card p-5 flex sm:block items-center gap-4">
                <span className="lp-chip bg-brand-50 text-brand-600 mb-0 sm:mb-4">
                  <item.Icon size={22} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                  <p className="mt-1 text-sm text-gray-500 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
          {!user && (
            <p className="text-sm text-gray-500 mt-6">
              {t('landing.prepare.ready')}{' '}
              <button onClick={() => navigate('/register')}
                className="text-brand-700 font-semibold underline underline-offset-2 hover:text-brand-800">
                {t('landing.prepare.registerNow')}
              </button>
            </p>
          )}
        </div>
      </section>}

      {/* How MAPA Works — the six real steps, as soft cards with warm icon
          chips and a step number (a real sequence, so numbering earns its
          place). New visitors only. */}
      {!user && <section ref={featuresRef} className="px-5 sm:px-6 py-16 sm:py-20">
        <div className="max-w-5xl mx-auto">
          <SectionHead center title={t('landing.steps.heading')} sub={t('landing.steps.subtitle')} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { step: 1, Icon: MdBadge,         title: t('landing.steps.s1Title'), desc: t('landing.steps.s1Desc') },
              { step: 2, Icon: MdHowToReg,      title: t('landing.steps.s2Title'), desc: t('landing.steps.s2Desc') },
              { step: 3, Icon: MdUploadFile,    title: t('landing.steps.s3Title'), desc: t('landing.steps.s3Desc') },
              { step: 4, Icon: MdLocalHospital, title: t('landing.steps.s4Title'), desc: t('landing.steps.s4Desc') },
              { step: 5, Icon: MdVideocam,      title: t('landing.steps.s5Title'), desc: t('landing.steps.s5Desc') },
              { step: 6, Icon: MdVerified,      title: t('landing.steps.s6Title'), desc: t('landing.steps.s6Desc') },
            ].map(s => (
              <div key={s.step} className="lp-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <span className="lp-chip bg-brand-50 text-brand-600">
                    <s.Icon size={22} />
                  </span>
                  <span className="font-display text-xl font-bold text-brand-100">{`0${s.step}`}</span>
                </div>
                <p className="text-[15px] font-semibold text-gray-900">{s.title}</p>
                <p className="mt-1 text-sm text-gray-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
          {!user && (
            <div className="text-center mt-10">
              <button
                onClick={() => navigate('/register')}
                className="btn-primary px-8 py-3 text-base flex items-center gap-2 mx-auto shadow-lg shadow-brand-900/15">
                {t('landing.steps.startBtn')} <MdArrowForward size={18} />
              </button>
              <p className="text-xs text-gray-500 mt-3">{t('landing.steps.footer')}</p>
            </div>
          )}
        </div>
      </section>}

      {/* Applying is free — the single biggest trust question for an indigent
          patient. A large rounded PINE PANEL floating on the warm ground (not
          a full-bleed band), so it reads as a deliberate emphasis moment.
          New visitors only. */}
      {!user && <section className="px-5 sm:px-6 py-6">
        <div className="max-w-5xl mx-auto">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 to-brand-800 p-8 sm:p-10 shadow-xl shadow-brand-900/25">
            <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/5" />
            <div className="relative grid gap-8 lg:grid-cols-12 lg:items-center lg:gap-12">
              <div className="lg:col-span-7">
                <span className="lp-chip bg-white/10 text-amber-300 mb-5">
                  <MdMoneyOff size={24} />
                </span>
                <h2 className="font-display text-[26px] sm:text-3xl font-bold text-white mb-3">{t('landing.cost.title')}</h2>
                <p className="text-brand-50/90 text-[15px] leading-relaxed mb-6 max-w-xl">{t('landing.cost.body')}</p>
                <ul className="flex flex-wrap gap-x-6 gap-y-3">
                  {['point1', 'point2', 'point3'].map(k => (
                    <li key={k} className="flex items-center gap-2 text-sm font-semibold text-white">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/25 text-amber-200">
                        <MdCheck size={13} />
                      </span>
                      {t(`landing.cost.${k}`)}
                    </li>
                  ))}
                </ul>
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

      {/* Available Programs */}
      <section ref={programsRef} className="px-5 sm:px-6 py-16 sm:py-20">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <SectionHead title={t('landing.programs.heading')} sub={t('landing.programs.subtitle')} />
            <button
              className="btn-primary text-sm w-full sm:w-auto flex-shrink-0 mb-8"
              onClick={handleMainCTA}>
              {user ? t('landing.programs.goToDashboard') : t('landing.programs.applyNow')}
            </button>
          </div>
          {agencies.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="lp-card p-5 animate-pulse">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-11 h-11 bg-gray-100 rounded-2xl flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-gray-100 rounded w-36" />
                      <div className="h-2.5 bg-gray-100 rounded w-24" />
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {agencies.map((agency, i) => {
                const total     = agency.slots?.total ?? 0
                const remaining = agency.slots?.remaining ?? 0
                const pct       = total > 0 ? Math.round(((total - remaining) / total) * 100) : 0
                const isFull    = remaining === 0
                const isLow     = !isFull && total > 0 && remaining / total <= 0.25
                return (
                  <div key={agency.id} className="lp-card p-5 transition-shadow hover:shadow-[0_1px_2px_rgba(8,80,65,0.05),0_24px_44px_-24px_rgba(8,80,65,0.32)]">
                    <div className="flex items-center gap-3 mb-3">
                      <AgencyAvatar agency={agency} className="w-11 h-11 rounded-2xl text-sm" />
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-900">{agency.name}</h3>
                        <p className="text-xs text-gray-500 truncate">{agency.location}</p>
                      </div>
                      <span className={`badge text-xs ${isFull ? 'badge-red' : isLow ? 'badge-amber' : 'badge-green'}`}>
                        {isFull ? t('landing.programs.full') : t('landing.programs.slotsBadge', { count: remaining })}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full mb-1.5 overflow-hidden">
                      <div
                        className={`h-1.5 rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none ${isFull ? 'bg-red-400' : isLow ? 'bg-amber-400' : 'bg-brand-500'}`}
                        style={{ width: programsIn ? `${pct}%` : '0%', transitionDelay: `${i * 80}ms` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500">{t('landing.programs.slotsRemaining', { remaining, total })}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* FAQ — the real questions a worried first-time applicant asks. Native
          <details> (zero JS, accessible) inside one soft card. Everyone. */}
      <section id="faq" className="px-5 sm:px-6 py-16 sm:py-20">
        <div className="max-w-3xl mx-auto">
          <SectionHead title={t('landing.faq.heading')} sub={t('landing.faq.intro')} />
          <div className="lp-card divide-y divide-gray-100 px-5 sm:px-6">
            {['1', '2', '3', '4', '5', '6'].map(n => (
              <details key={n} className="group">
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden py-4 min-h-[44px] text-[15px] font-semibold text-gray-900">
                  <span>{t(`landing.faq.q${n}`)}</span>
                  <span className="lp-chip h-8 w-8 bg-brand-50 text-brand-600 transition-transform group-open:rotate-180">
                    <MdExpandMore size={20} />
                  </span>
                </summary>
                <p className="pb-4 pr-4 text-sm leading-relaxed text-gray-600">{t(`landing.faq.a${n}`)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Need help / Visit us — the human escape hatch for low-literacy users:
          real CRMC contact details + a note that staff will do the whole
          application with them in person. Everyone. */}
      <section id="help" className="px-5 sm:px-6 py-16 sm:py-20">
        <div className="max-w-5xl mx-auto grid gap-8 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-5">
            <SectionHead title={t('landing.help.title')} sub={t('landing.help.intro')} />
            <div className="flex items-start gap-3 rounded-2xl bg-brand-50 p-4">
              <MdGroups size={22} className="mt-0.5 flex-shrink-0 text-brand-700" />
              <p className="text-sm font-medium leading-relaxed text-brand-800">{t('landing.help.onsite')}</p>
            </div>
            {!user && (
              <button onClick={() => navigate('/register')}
                className="btn-primary mt-5 px-6 py-3 text-base flex items-center gap-2 shadow-lg shadow-brand-900/15">
                {t('landing.help.startBtn')} <MdArrowForward size={18} />
              </button>
            )}
          </div>
          <div className="lg:col-span-7">
            <dl className="lp-card divide-y divide-gray-100 px-5 sm:px-6">
              {[
                { Icon: MdLocationOn,  label: t('landing.help.addressLabel'), value: t('landing.help.address') },
                { Icon: MdPhone,       label: t('landing.help.phoneLabel'),   value: '(064) 421-2500' },
                { Icon: MdMailOutline, label: t('landing.help.emailLabel'),   value: 'records@crmc.gov.ph' },
                { Icon: MdSchedule,    label: t('landing.help.hoursLabel'),   value: t('landing.help.hours') },
              ].map((row, i) => (
                <div key={i} className="flex gap-4 py-4">
                  <span className="lp-chip h-10 w-10 bg-brand-50 text-brand-600">
                    <row.Icon size={18} />
                  </span>
                  <div className="min-w-0">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">{row.label}</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-gray-900 break-words">{row.value}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* Footer — deep pine to close the page in the brand colour rather than
          a generic slate, tying the whole palette together. */}
      <footer className="bg-brand-900 text-white pt-14 pb-6 px-5 sm:px-6">
        <div className="max-w-5xl mx-auto">

          {/* Top section — 3 columns */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-10">

            {/* Brand */}
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

            {/* Quick links */}
            <div>
              <p className="text-xs font-semibold text-brand-100 uppercase tracking-widest mb-3">{t('landing.footer.quickLinks')}</p>
              <ul className="space-y-2">
                {!user && (
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
                {user && (
                  <li>
                    <button onClick={() => navigate(DASHBOARD[user.role] ?? '/')}
                      className="text-xs text-brand-100/70 hover:text-white transition-colors">
                      {t('landing.footer.dashboard')}
                    </button>
                  </li>
                )}
                <li>
                  <button
                    onClick={() => featuresRef.current?.scrollIntoView({ behavior: 'smooth' })}
                    className="text-xs text-brand-100/70 hover:text-white transition-colors">
                    {t('landing.footer.howItWorks')}
                  </button>
                </li>
              </ul>
            </div>

            {/* Contact */}
            <div>
              <p className="text-xs font-semibold text-brand-100 uppercase tracking-widest mb-3">{t('landing.footer.contact')}</p>
              <ul className="space-y-2 text-xs text-brand-100/70">
                <li className="flex items-start gap-2">
                  <MdLocationOn size={15} className="mt-0.5 flex-shrink-0 text-brand-300" />
                  <span>{t('landing.footer.addressLine1')}<br />{t('landing.footer.addressLine2')}</span>
                </li>
                <li className="flex items-center gap-2">
                  <MdPhone size={15} className="flex-shrink-0 text-brand-300" />
                  <span>(064) 421-2500</span>
                </li>
                <li className="flex items-center gap-2">
                  <MdMailOutline size={15} className="flex-shrink-0 text-brand-300" />
                  <span>records@crmc.gov.ph</span>
                </li>
                <li className="flex items-center gap-2">
                  <MdSchedule size={15} className="flex-shrink-0 text-brand-300" />
                  <span>{t('landing.footer.hours')}</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-brand-100/60 flex items-center gap-1.5">
              <MdFavorite size={12} className="text-amber-400" />
              {t('landing.footer.copyright', { year: new Date().getFullYear() })}
            </p>
            <div className="flex items-center gap-4 text-xs text-brand-100/60">
              <button
                onClick={() => setShowPrivacy(true)}
                className="hover:text-white transition-colors">
                {t('landing.footer.privacy')}
              </button>
              <span>·</span>
              <span>{t('landing.footer.officialPortal')}</span>
            </div>
          </div>
        </div>
      </footer>
      {/* Privacy Notice Modal */}
      {showPrivacy && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setShowPrivacy(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-900">{t('landing.privacy.title')}</h2>
              <button onClick={() => setShowPrivacy(false)} className="text-gray-500 hover:text-gray-600">
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
    </div>
  )
}
