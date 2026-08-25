import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LanguageToggle from '../../components/LanguageToggle'
import Logo from '../../components/ui/Logo'
import { MdVisibility, MdVisibilityOff, MdEmail, MdClose, MdWarning } from 'react-icons/md'
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

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-brand-50/50 to-white flex items-center justify-center px-4 py-8">
      {/* Same subtle animated aurora as the landing hero — visual
          continuity from Landing → Login. Reduced-motion-safe (index.css). */}
      <div className="hero-aurora" aria-hidden="true" />
      {/* Match Register's responsive width so the card doesn't jump in size
          when patients toggle between Login and Register. */}
      <div className="relative w-full max-w-md sm:max-w-lg">

        {/* Language toggle */}
        <div className="flex justify-end mb-2">
          <LanguageToggle />
        </div>

        {/* Logo — uses the shared CRMC brand mark to match Landing. */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <Logo size={56} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{t('auth.welcome')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('auth.signinSubtitle')}</p>
        </div>

        {/* Maintenance / announcement banner */}
        {activeAnnouncement && (() => {
          const cfg  = TYPE_CONFIG[activeAnnouncement.type] ?? TYPE_CONFIG.info
          const Icon = cfg.icon
          const now  = Date.now()
          const start = activeAnnouncement.startAt?.toDate?.()?.getTime() ?? 0
          const isLive = now >= start
          return (
            <div className={`mb-5 flex items-start gap-3 px-4 py-3 rounded-xl border ${cfg.bg} ${cfg.border}`}>
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

        {/* Login form */}
        <div className="card p-6 rounded-2xl shadow-lg border-gray-100/80">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('auth.email')}</label>
              <input
                type="email"
                required
                autoFocus
                autoCapitalize="none"
                spellCheck={false}
                inputMode="email"
                className={`input ${loginError ? 'border-red-400 bg-red-50' : ''}`}
                placeholder={t('auth.emailPlaceholder')}
                value={form.email}
                onChange={e => { setForm({ ...form, email: e.target.value }); setLoginError(false) }}
                autoComplete="email"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-gray-700">{t('auth.password')}</label>
                {/* Fix 2 — Forgot Password link */}
                <button
                  type="button"
                  className="text-xs text-brand-500 hover:text-brand-600 font-medium"
                  onClick={() => {
                    setResetEmail(form.email)
                    setShowReset(true)
                  }}>
                  {t('auth.forgotPassword')}
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  className={`input pr-10 ${loginError ? 'border-red-400 bg-red-50' : ''}`}
                  placeholder={t('auth.passwordPlaceholder')}
                  value={form.password}
                  onChange={e => { setForm({ ...form, password: e.target.value }); setLoginError(false) }}
                  autoComplete="current-password"
                />
                {/* 36×36 tap target — was bare icon (~18px) and missed often
                    on mobile. */}
                <button
                  type="button"
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md"
                  onClick={() => setShowPw(!showPw)}>
                  {showPw ? <MdVisibilityOff size={18} /> : <MdVisibility size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="btn-primary w-full py-2.5"
              disabled={loading}>
              {loading ? t('auth.signingIn') : `${t('auth.signIn')} →`}
            </button>
          </form>

          <div className="mt-4 text-center">
            <span className="text-sm text-gray-500">{t('auth.noAccount')} </span>
            <Link to="/register" className="text-sm text-brand-500 hover:text-brand-600 font-medium">
              {t('auth.registerHere')}
            </Link>
          </div>
        </div>

        {/* Fix 1 — Demo accounts only in development */}
        {import.meta.env.VITE_ENABLE_SEED === 'true' && (
          <div className="mt-4 card p-4 border border-amber-200 bg-amber-50">
            <p className="text-xs font-medium text-amber-700 mb-3 uppercase tracking-wide flex items-center gap-1.5">
              <MdWarning size={13} /> {t('auth.devOnly')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { label: 'Patient',                email: 'patient@gmail.com',            password: 'patient123', note: null     },
                { label: 'Super Admin',            email: 'admin@crmc.gov.ph',            password: 'admin123',   note: null     },
                { label: 'Staff Admin',            email: 'staff@crmc.gov.ph',            password: 'staff123',   note: null     },
                { label: 'Malasakit · Admin',      email: 'admin@malasakit.gov.ph',       password: 'agency123',  note: 'Admin'  },
                { label: 'Malasakit · Coordinator',email: 'coordinator@malasakit.gov.ph', password: 'agency123',  note: 'Active' },
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
                  <p className="text-gray-400 truncate">{acc.email}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {!isStandalone && (
          <p className="text-center text-xs text-gray-400 mt-4">
            <Link to="/" className="hover:text-gray-600">{t('auth.backHome')}</Link>
          </p>
        )}
      </div>

      {/* Fix 2 — Forgot Password modal */}
      {showReset && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setShowReset(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-gray-900">{t('auth.reset.title')}</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {t('auth.reset.desc')}
                </p>
              </div>
              <button
                onClick={() => setShowReset(false)}
                aria-label={t('auth.reset.cancel')}
                className="flex-shrink-0 w-8 h-8 -mt-1 -mr-1 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                <MdClose size={20} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="relative">
                <MdEmail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
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
