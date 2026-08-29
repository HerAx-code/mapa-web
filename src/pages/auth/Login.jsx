import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LanguageToggle from '../../components/LanguageToggle'
import Logo from '../../components/ui/Logo'
import { MdVisibility, MdVisibilityOff, MdEmail, MdClose, MdWarning, MdShield } from 'react-icons/md'
import { useAuth } from '../../contexts/AuthContext'
import { ROLES } from '../../utils/constants'
import { firstGivenName } from '../../utils/names'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth, db } from '../../firebase'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { TYPE_CONFIG } from '../admin/Announcements'
import toast from 'react-hot-toast'

// Client-side email format gate — saves a round-trip to Firebase Auth
// for obvious typos in the reset modal.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Per-role post-login destination. Patients land on the Dashboard
// (status hero + welcome tour + 5-step journey) to match the home-base
// pattern every other role uses, and to match Landing.jsx's DASHBOARD
// map (commit 671dc86). The previous '/patient/request' default
// short-circuited the orientation surface I added later -- new
// patients with no active request were dropped into the wizard
// without ever seeing the Dashboard's welcome card.
const DASHBOARD = {
  [ROLES.PATIENT]:      '/patient/dashboard',
  [ROLES.AGENCY]:       '/agency/dashboard',
  [ROLES.AGENCY_ADMIN]: '/agency/dashboard',
  [ROLES.SUPER_ADMIN]:  '/admin/dashboard',
  [ROLES.STAFF_ADMIN]:  '/admin/dashboard',
}

// Fix 4 — human-readable Firebase error messages
const friendlyError = (code, t) => {
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return t('auth.errors.wrongPassword')
    case 'auth/user-not-found':
      return t('auth.errors.userNotFound')
    case 'auth/invalid-email':
      return t('auth.errors.invalidEmail')
    case 'auth/too-many-requests':
      return t('auth.errors.tooManyRequests')
    case 'auth/user-disabled':
      return t('auth.errors.userDisabled')
    case 'auth/network-request-failed':
      return t('auth.errors.networkFailed')
    default:
      return t('auth.errors.loginFailed')
  }
}

// Shared field styling for the login inputs — taller (h-12), rounded-xl,
// soft brand focus ring. Kept as a const so email + password stay identical.
const FIELD_BASE =
  'h-12 w-full rounded-xl border bg-white px-4 text-[15px] text-gray-900 outline-none ' +
  'transition-colors duration-150 placeholder:text-gray-300 ' +
  'focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

export default function Login() {
  const navigate        = useNavigate()
  const { t }           = useTranslation()
  const { login, user } = useAuth()

  // When MAPA is running as an installed PWA, the marketing landing
  // page is redirected away (see Landing.jsx). A 'Back to Home' link
  // from this Login page would just bounce the user back here. Detect
  // standalone display mode once on mount so we can hide that link.
  const [isStandalone] = useState(() =>
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true)
  )

  const [form, setForm]                       = useState({ email: '', password: '' })
  const [showPw, setShowPw]                   = useState(false)
  const [loading, setLoading]                 = useState(false)
  const [loginError, setLoginError]           = useState(false)
  const [resetting, setResetting]             = useState(false)
  const [showReset, setShowReset]             = useState(false)
  const [resetEmail, setResetEmail]           = useState('')
  const [activeAnnouncement, setActiveAnnouncement] = useState(null)

  // Redirect if already logged in
  useEffect(() => {
    if (user) navigate(DASHBOARD[user.role] ?? '/patient/dashboard', { replace: true })
  }, [user])

  // Fetch active or upcoming announcements to show before login
  useEffect(() => {
    const fetchAnnouncement = async () => {
      try {
        const now  = Date.now()
        const snap = await getDocs(query(collection(db, 'announcements'), where('active', '==', true)))
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))

        // Prefer currently active; fall back to upcoming within 24 hours
        const active = list.find(a => {
          const start = a.startAt?.toDate?.()?.getTime() ?? 0
          const end   = a.endAt?.toDate?.()?.getTime()   ?? 0
          return now >= start && now <= end
        }) ?? list.find(a => {
          const start = a.startAt?.toDate?.()?.getTime() ?? 0
          return start > now && start - now <= 86400000
        })

        setActiveAnnouncement(active ?? null)
      } catch { /* silent — don't block login if announcement fetch fails */ }
    }
    fetchAnnouncement()
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.email || !form.password) {
      toast.error(t('auth.errors.enterCredentials'))
      return
    }
    setLoading(true)
    try {
      const loggedIn = await login(form.email, form.password)
      setLoginError(false)
      // Greet with first name only so the toast fits on a phone screen
      // (full name like "Juan Dela Cruz Jr." overflows mobile toasts).
      // firstGivenName skips honorific prefixes so the greeting reads
      // "Welcome back, Roberto" rather than "Welcome back, Dr.!".
      toast.success(t('auth.toast.welcomeBack', { name: firstGivenName(loggedIn.name) }))
      navigate(DASHBOARD[loggedIn.role] ?? '/patient/dashboard')
    } catch (err) {
      const code = err.code ?? ''
      setLoginError(true)   // Fix 3 — highlight fields on error
      toast.error(friendlyError(code, t))
    } finally {
      setLoading(false)
    }
  }

  // Fix 2 — Forgot Password handler
  const handleForgotPassword = async () => {
    const email = (resetEmail.trim() || form.email.trim()).toLowerCase()
    if (!email) {
      toast.error(t('auth.errors.enterEmail'))
      return
    }
    // Client-side format check — Firebase will reject malformed addresses
    // anyway, but catching them here saves a network round-trip on slow
    // CRMC connections.
    if (!EMAIL_RE.test(email)) {
      toast.error(t('auth.errors.invalidEmail'))
      return
    }
    setResetting(true)
    try {
      await sendPasswordResetEmail(auth, email)
      toast.success(t('auth.toast.resetSent'))
      setShowReset(false)
    } catch (err) {
      const code = err.code ?? ''
      if (code === 'auth/user-not-found')
        toast.error(t('auth.errors.userNotFound'))
      else if (code === 'auth/invalid-email')
        toast.error(t('auth.errors.invalidEmail'))
      else
        toast.error(t('auth.errors.resetFailed'))
    } finally {
      setResetting(false)
    }
  }

  const fieldState = loginError ? 'border-red-300 bg-red-50' : 'border-gray-200 hover:border-gray-300'

  return (
    <div className="relative min-h-screen w-full bg-white lg:grid lg:grid-cols-[1fr_minmax(0,44%)]">

      {/* ── Left: brand panel (desktop only) ── */}
      <aside className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between bg-gradient-to-br from-brand-700 via-brand-800 to-brand-900">
        {/* Dark-panel aurora — visual continuity with the Landing hero. */}
        <div className="brand-aurora" aria-hidden="true" />

        {/* Real MAPA logo mark + a white wordmark (the shared Logo component's
            wordmark is dark-on-light, so the dark brand column pairs the mark
            with its own white "MAPA" text). */}
        <div className="relative px-12 pt-12">
          <span className="inline-flex items-center gap-2.5">
            <img
              src="/mapa-logo.png"
              alt="MAPA"
              className="h-10 w-10 rounded-[11px] object-contain ring-1 ring-white/15" />
            <span className="text-[17px] font-semibold tracking-tight text-white">MAPA</span>
          </span>
        </div>

        <div className="relative px-12 py-10">
          <h2 className="max-w-md text-[32px] font-semibold leading-[1.15] tracking-tight text-white text-balance">
            {t('auth.brand.headline')}
          </h2>
          <ul className="mt-10 max-w-md space-y-6">
            {[1, 2, 3].map(i => (
              <li key={i} className="border-l-2 border-brand-400 pl-5">
                <h3 className="text-[15px] font-semibold text-white">{t(`auth.brand.a${i}title`)}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-brand-100/80">{t(`auth.brand.a${i}desc`)}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-2.5 border-t border-white/10 px-12 py-6">
          <MdShield size={16} className="flex-shrink-0 text-brand-300" aria-hidden="true" />
          <p className="text-xs text-brand-100/75">{t('auth.brand.trust')}</p>
        </div>
      </aside>

      {/* ── Right: form column ── */}
      <main className="flex min-h-screen flex-col bg-white lg:min-h-0">
        <header className="flex items-center justify-between gap-4 px-6 py-6 sm:px-10">
          {/* Logo shown on mobile (the brand panel carries it on desktop). */}
          <Logo size={36} withWordmark className="lg:invisible" />
          <LanguageToggle />
        </header>

        <div className="flex flex-1 items-center justify-center px-6 pb-10 sm:px-10">
          <div className="w-full max-w-[420px]">
            <h1 className="text-[28px] sm:text-[30px] font-bold leading-tight tracking-tight text-gray-900">
              {t('auth.welcome')}
            </h1>
            <p className="mt-2 text-[15px] text-gray-500">{t('auth.signinSubtitle')}</p>

            {/* Maintenance / announcement banner */}
            {activeAnnouncement && (() => {
              const cfg  = TYPE_CONFIG[activeAnnouncement.type] ?? TYPE_CONFIG.info
              const Icon = cfg.icon
              const now  = Date.now()
              const start = activeAnnouncement.startAt?.toDate?.()?.getTime() ?? 0
              const isLive = now >= start
              return (
                <div className={`mt-6 flex items-start gap-3 px-4 py-3 rounded-xl border ${cfg.bg} ${cfg.border}`}>
                  <Icon size={16} className={`${cfg.iconColor} flex-shrink-0 mt-0.5`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">
                      {isLive ? t('auth.banner.ongoing') : t('auth.banner.upcoming')}{activeAnnouncement.title}
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                      {activeAnnouncement.message}
                    </p>
                  </div>
                </div>
              )
            })()}

            <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
              <div>
                <label htmlFor="login-email" className="block text-sm font-medium text-gray-900">{t('auth.email')}</label>
                <input
                  id="login-email"
                  type="email"
                  required
                  autoFocus
                  autoCapitalize="none"
                  spellCheck={false}
                  inputMode="email"
                  autoComplete="email"
                  className={`mt-2 ${FIELD_BASE} ${fieldState}`}
                  placeholder={t('auth.emailPlaceholder')}
                  value={form.email}
                  onChange={e => { setForm({ ...form, email: e.target.value }); setLoginError(false) }}
                />
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-4">
                  <label htmlFor="login-password" className="block text-sm font-medium text-gray-900">{t('auth.password')}</label>
                  {/* Fix 2 — Forgot Password link */}
                  <button
                    type="button"
                    className="text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline underline-offset-4"
                    onClick={() => { setResetEmail(form.email); setShowReset(true) }}>
                    {t('auth.forgotPassword')}
                  </button>
                </div>
                <div className="relative mt-2">
                  <input
                    id="login-password"
                    type={showPw ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    className={`${FIELD_BASE} pr-12 ${fieldState}`}
                    placeholder={t('auth.passwordPlaceholder')}
                    value={form.password}
                    onChange={e => { setForm({ ...form, password: e.target.value }); setLoginError(false) }}
                  />
                  {/* 36×36 tap target for mobile. */}
                  <button
                    type="button"
                    aria-label={showPw ? t('auth.hidePassword') : t('auth.showPassword')}
                    className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-brand-50 hover:text-brand-600 transition-colors"
                    onClick={() => setShowPw(!showPw)}>
                    {showPw ? <MdVisibilityOff size={18} /> : <MdVisibility size={18} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 text-[15px] font-semibold text-white transition-colors hover:bg-brand-600 active:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed">
                {loading ? t('auth.signingIn') : t('auth.signIn')}
                {!loading && <span aria-hidden="true">→</span>}
              </button>
            </form>

            <p className="mt-6 text-sm text-gray-500">
              {t('auth.noAccount')}{' '}
              <Link to="/register" className="font-semibold text-brand-600 hover:text-brand-700 hover:underline underline-offset-4">
                {t('auth.registerHere')}
              </Link>
            </p>

            {/* Fix 1 — Demo accounts only in development */}
            {import.meta.env.VITE_ENABLE_SEED === 'true' && (
              <div className="mt-8 card p-4 border border-amber-200 bg-amber-50">
                <p className="text-xs font-medium text-amber-700 mb-3 uppercase tracking-wide flex items-center gap-1.5">
                  <MdWarning size={13} /> {t('auth.devOnly')}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { label: 'Patient',                email: 'patient@gmail.com',            password: 'patient123', note: null     },
                    { label: 'Super Admin',            email: 'admin@crmc.gov.ph',            password: 'admin123',   note: null     },
                    { label: 'Staff Admin',            email: 'staff@crmc.gov.ph',            password: 'staff123',   note: null     },
                    // Malasakit (coordination hub) and PhilHealth (modelled as the
                    // first-charge coverage that REDUCES the bill, not an endorsable
                    // GL-issuing funder — see docs/philhealth-first-plan.md) are
                    // both deactivated as agencies, so their logins are not shown.
                    // The GL-issuing funders are DOH-MAIP, PCSO, DSWD and AMBaG.
                    { label: 'DOH · Admin',            email: 'admin@doh.gov.ph',             password: 'agency123',  note: 'Admin'  },
                    { label: 'DOH · Coordinator',      email: 'coordinator@doh.gov.ph',       password: 'agency123',  note: 'Active' },
                    { label: 'AMBaG · Admin',          email: 'admin@ambag.gov.ph',           password: 'agency123',  note: 'Admin'  },
                    { label: 'AMBaG · Coordinator',    email: 'coordinator@ambag.gov.ph',     password: 'agency123',  note: 'Active' },
                    { label: 'PCSO · Admin',           email: 'admin@pcso.gov.ph',            password: 'agency123',  note: 'Admin'  },
                    { label: 'PCSO · Coordinator',     email: 'coordinator@pcso.gov.ph',      password: 'agency123',  note: 'Active' },
                    { label: 'DSWD · Admin',           email: 'admin@dswd.gov.ph',            password: 'agency123',  note: 'Admin'  },
                    { label: 'DSWD · Coordinator',     email: 'coordinator@dswd.gov.ph',      password: 'agency123',  note: 'Active' },
                  ].map(acc => (
                    <button
                      key={acc.label}
                      className="text-left px-3 py-2 rounded-lg bg-white hover:bg-brand-50 hover:text-brand-600 transition-colors text-xs border border-amber-100"
                      onClick={() => setForm({ email: acc.email, password: acc.password })}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium truncate">{acc.label}</p>
                        {acc.note && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 font-medium ${
                            acc.note === 'Deactivated' ? 'bg-red-100 text-red-500'
                            : acc.note === 'Admin'       ? 'bg-purple-100 text-purple-600'
                            : 'bg-green-100 text-green-600'
                          }`}>{acc.note}</span>
                        )}
                      </div>
                      <p className="text-gray-500 truncate">{acc.email}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!isStandalone && (
              <p className="mt-8 border-t border-gray-100 pt-6 text-sm">
                <Link to="/" className="inline-flex items-center gap-1.5 text-gray-500 hover:text-gray-900 transition-colors">
                  {t('auth.backHome')}
                </Link>
              </p>
            )}
          </div>
        </div>
      </main>

      {/* Fix 2 — Forgot Password modal */}
      {showReset && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setShowReset(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-gray-900">{t('auth.reset.title')}</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {t('auth.reset.desc')}
                </p>
              </div>
              <button
                onClick={() => setShowReset(false)}
                aria-label={t('auth.reset.cancel')}
                className="flex-shrink-0 w-8 h-8 -mt-1 -mr-1 flex items-center justify-center text-gray-500 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                <MdClose size={20} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="relative">
                <MdEmail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                <input
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  inputMode="email"
                  className="input pl-9"
                  placeholder={t('auth.reset.placeholder')}
                  value={resetEmail}
                  onChange={e => setResetEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleForgotPassword()}
                  autoFocus
                />
              </div>
            </div>
            <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
              <button className="btn-secondary text-sm" onClick={() => setShowReset(false)}>
                {t('auth.reset.cancel')}
              </button>
              <button
                className="btn-primary text-sm"
                onClick={handleForgotPassword}
                disabled={resetting}>
                {resetting ? t('auth.reset.sending') : t('auth.reset.send')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
