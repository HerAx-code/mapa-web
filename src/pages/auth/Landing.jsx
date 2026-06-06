import { useNavigate } from 'react-router-dom'
import { useRef, useState, useEffect } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { useAuth } from '../../contexts/AuthContext'
import { ROLES } from '../../utils/constants'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase'
import { MdShield, MdArrowForward, MdDownload, MdClose } from 'react-icons/md'
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

export default function Landing() {
  const navigate    = useNavigate()
  const { t }       = useTranslation()
  const { user }    = useAuth()
  const featuresRef = useRef(null)

  const [showPrivacy, setShowPrivacy] = useState(false)
  const [agencies, setAgencies]       = useState([])

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

  const handleMainCTA = () => {
    if (user) navigate(DASHBOARD[user.role] ?? '/patient/dashboard')
    else navigate('/register')
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Topbar */}
      <header className="border-b border-gray-100 px-6 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

      {/* Hero */}
      <section className="bg-gradient-to-br from-brand-50 to-white py-20 px-6 text-center">
        <div className="max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-white border border-brand-100 rounded-full px-4 py-1.5 text-xs text-brand-600 font-medium mb-6 shadow-sm">
            <MdShield size={14} />
            {t('landing.hero.badge')}
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4 leading-tight">
            <span className="text-brand-500">M</span>edical{' '}
            <span className="text-brand-500">A</span>ssistance{' '}
            <span className="text-brand-500">P</span>ortal{' '}
            <span className="text-brand-500">A</span>ccess
          </h1>
          <p className="text-gray-500 text-base mb-2 flex items-center justify-center gap-2">
            <span>📍</span> {t('landing.hero.location')}
          </p>
          <p className="text-gray-600 text-lg mb-8 max-w-xl mx-auto">
            {t('landing.hero.tagline')}
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              className="btn-primary flex items-center justify-center gap-2 px-6 py-2.5 text-base w-full sm:w-auto"
              onClick={handleMainCTA}>
              {user ? t('landing.hero.ctaDashboard') : t('landing.hero.ctaPatient')}
              <MdArrowForward size={18} />
            </button>
            <button
              className="btn-secondary px-6 py-2.5 text-base w-full sm:w-auto"
              onClick={() => featuresRef.current?.scrollIntoView({ behavior: 'smooth' })}>
              {t('landing.hero.learnMore')}
            </button>
          </div>
        </div>
      </section>

      {/* What to prepare — only shown to unauthenticated visitors */}
      {!user && <section className="py-10 px-6 bg-brand-500">
        <div className="max-w-4xl mx-auto">
          <p className="text-white text-center text-sm font-semibold uppercase tracking-widest mb-6 opacity-80">
            {t('landing.prepare.heading')}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { emoji: '🪪', title: t('landing.prepare.codeTitle'),    desc: t('landing.prepare.codeDesc')    },
              { emoji: '📧', title: t('landing.prepare.emailTitle'),   desc: t('landing.prepare.emailDesc')   },
              { emoji: '📱', title: t('landing.prepare.mobileTitle'),  desc: t('landing.prepare.mobileDesc')  },
              { emoji: '📍', title: t('landing.prepare.addressTitle'), desc: t('landing.prepare.addressDesc') },
            ].map((item, i) => (
              <div key={i} className="bg-white/10 rounded-xl p-4 text-center">
                <p className="text-2xl mb-2">{item.emoji}</p>
                <p className="text-white text-xs font-semibold mb-1">{item.title}</p>
                <p className="text-white/70 text-xs leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
          {!user && (
            <p className="text-center text-white/60 text-xs mt-6">
              {t('landing.prepare.ready')}{' '}
              <button onClick={() => navigate('/register')}
                className="text-white font-semibold underline underline-offset-2 hover:opacity-80">
                {t('landing.prepare.registerNow')}
              </button>
            </p>
          )}
        </div>
      </section>}

      {/* How MAPA Works — step-by-step, only for new visitors */}
      {!user && <section ref={featuresRef} className="py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">{t('landing.steps.heading')}</h2>
          <p className="text-gray-500 text-center text-sm mb-12">
            {t('landing.steps.subtitle')}
          </p>

          {/* Steps grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { step: 1, emoji: '🪪', title: t('landing.steps.s1Title'), desc: t('landing.steps.s1Desc') },
              { step: 2, emoji: '📝', title: t('landing.steps.s2Title'), desc: t('landing.steps.s2Desc') },
              { step: 3, emoji: '📄', title: t('landing.steps.s3Title'), desc: t('landing.steps.s3Desc') },
              { step: 4, emoji: '🏥', title: t('landing.steps.s4Title'), desc: t('landing.steps.s4Desc') },
              { step: 5, emoji: '🎥', title: t('landing.steps.s5Title'), desc: t('landing.steps.s5Desc') },
              { step: 6, emoji: '🏆', title: t('landing.steps.s6Title'), desc: t('landing.steps.s6Desc') },
            ].map((s, i, arr) => (
              <div key={s.step} className="relative flex gap-4">
                {/* Step number */}
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-brand-500 text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
                    {s.step}
                  </div>
                  {/* Vertical connector on mobile */}
                  {i < arr.length - 1 && (
                    <div className="w-0.5 flex-1 bg-brand-100 mt-2 min-h-[24px] sm:hidden" />
                  )}
                </div>
                {/* Content */}
                <div className="pb-6 sm:pb-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{s.emoji}</span>
                    <p className="text-sm font-semibold text-gray-800">{s.title}</p>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* CTA below steps */}
          {!user && (
            <div className="text-center mt-10">
              <button
                onClick={() => navigate('/register')}
                className="btn-primary px-8 py-2.5 text-base flex items-center gap-2 mx-auto">
                {t('landing.steps.startBtn')} <MdArrowForward size={18} />
              </button>
              <p className="text-xs text-gray-400 mt-2">{t('landing.steps.footer')}</p>
            </div>
          )}
        </div>
      </section>}

      {/* Available Programs */}
      <section className="py-16 px-6 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{t('landing.programs.heading')}</h2>
              <p className="text-sm text-gray-500 mt-1">
                {t('landing.programs.subtitle')}
              </p>
            </div>
            <button
              className="btn-primary text-sm w-full sm:w-auto"
              onClick={handleMainCTA}>
              {user ? t('landing.programs.goToDashboard') : t('landing.programs.applyNow')}
            </button>
          </div>
          {agencies.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="card p-4 animate-pulse">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 bg-gray-100 rounded-xl flex-shrink-0" />
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
              {agencies.map(agency => {
                const total     = agency.slots?.total ?? 0
                const remaining = agency.slots?.remaining ?? 0
                const pct       = total > 0 ? Math.round(((total - remaining) / total) * 100) : 0
                const isFull    = remaining === 0
                const isLow     = !isFull && total > 0 && remaining / total <= 0.25
                return (
                  <div key={agency.id} className="card p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-3 mb-3">
                      <AgencyAvatar agency={agency} className="w-10 h-10 rounded-xl text-sm" />
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-800">{agency.name}</h3>
                        <p className="text-xs text-gray-400 truncate">{agency.location}</p>
                      </div>
                      <span className={`badge text-xs ${isFull ? 'badge-red' : isLow ? 'badge-amber' : 'badge-green'}`}>
                        {isFull ? t('landing.programs.full') : t('landing.programs.slotsBadge', { count: remaining })}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full mb-1">
                      <div
                        className={`h-1.5 rounded-full transition-all ${isFull ? 'bg-red-400' : isLow ? 'bg-amber-400' : 'bg-brand-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-400">{t('landing.programs.slotsRemaining', { remaining, total })}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white pt-12 pb-6 px-6">
        <div className="max-w-5xl mx-auto">

          {/* Top section — 3 columns */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-10">

            {/* Brand */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Logo size={32} />
                <div>
                  <p className="text-sm font-bold">MAPA</p>
                  <p className="text-xs text-gray-400">Medical Assistance Portal Access</p>
                </div>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                {t('landing.footer.brandDesc')}
              </p>
            </div>

            {/* Quick links */}
            <div>
              <p className="text-xs font-semibold text-gray-300 uppercase tracking-widest mb-3">{t('landing.footer.quickLinks')}</p>
              <ul className="space-y-2">
                {!user && (
                  <>
                    <li>
                      <button onClick={() => navigate('/register')}
                        className="text-xs text-gray-400 hover:text-white transition-colors">
                        {t('landing.footer.registerPatient')}
                      </button>
                    </li>
                    <li>
                      <button onClick={() => navigate('/login')}
                        className="text-xs text-gray-400 hover:text-white transition-colors">
                        {t('landing.footer.login')}
                      </button>
                    </li>
                  </>
                )}
                {user && (
                  <li>
                    <button onClick={() => navigate(DASHBOARD[user.role] ?? '/')}
                      className="text-xs text-gray-400 hover:text-white transition-colors">
                      {t('landing.footer.dashboard')}
                    </button>
                  </li>
                )}
                <li>
                  <button
                    onClick={() => featuresRef.current?.scrollIntoView({ behavior: 'smooth' })}
                    className="text-xs text-gray-400 hover:text-white transition-colors">
                    {t('landing.footer.howItWorks')}
                  </button>
                </li>
              </ul>
            </div>

            {/* Contact */}
            <div>
              <p className="text-xs font-semibold text-gray-300 uppercase tracking-widest mb-3">{t('landing.footer.contact')}</p>
              <ul className="space-y-2 text-xs text-gray-400">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5">📍</span>
                  <span>{t('landing.footer.addressLine1')}<br />{t('landing.footer.addressLine2')}</span>
                </li>
                <li className="flex items-center gap-2">
                  <span>📞</span>
                  <span>(064) 421-2500</span>
                </li>
                <li className="flex items-center gap-2">
                  <span>✉️</span>
                  <span>records@crmc.gov.ph</span>
                </li>
                <li className="flex items-center gap-2">
                  <span>🕐</span>
                  <span>{t('landing.footer.hours')}</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="border-t border-gray-700 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-gray-500">
              {t('landing.footer.copyright', { year: new Date().getFullYear() })}
            </p>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <button
                onClick={() => setShowPrivacy(true)}
                className="hover:text-gray-300 transition-colors">
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
              <button onClick={() => setShowPrivacy(false)} className="text-gray-400 hover:text-gray-600">
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
