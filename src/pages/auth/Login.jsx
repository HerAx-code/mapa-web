import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LanguageToggle from '../../components/LanguageToggle'
import { MdShield, MdVisibility, MdVisibilityOff, MdEmail } from 'react-icons/md'
import { useAuth } from '../../contexts/AuthContext'
import { ROLES } from '../../utils/constants'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth, db } from '../../firebase'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { TYPE_CONFIG } from '../admin/Announcements'
import toast from 'react-hot-toast'

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
      toast.success(t('auth.toast.welcomeBack', { name: loggedIn.name }))
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
    const email = resetEmail.trim() || form.email.trim()
    if (!email) {
      toast.error(t('auth.errors.enterEmail'))
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">

        {/* Language toggle */}
        <div className="flex justify-end mb-2">
          <LanguageToggle />
        </div>

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-brand-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <MdShield size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{t('auth.welcome')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('auth.subtitle')}</p>
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
        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('auth.email')}</label>
              <input
                type="email"
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
                  className={`input pr-10 ${loginError ? 'border-red-400 bg-red-50' : ''}`}
                  placeholder={t('auth.passwordPlaceholder')}
                  value={form.password}
                  onChange={e => { setForm({ ...form, password: e.target.value }); setLoginError(false) }}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
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
            <p className="text-xs font-medium text-amber-700 mb-3 uppercase tracking-wide">
              ⚠️ {t('auth.devOnly')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { label: 'Patient',              email: 'patient@gmail.com',         password: 'patient123', note: null             },
                { label: 'Super Admin',          email: 'admin@crmc.gov.ph',         password: 'admin123',   note: null             },
                { label: 'Staff Admin',          email: 'staff@crmc.gov.ph',         password: 'staff123',   note: null             },
                { label: 'Agency · Malasakit',   email: 'coordinator@malasakit.gov.ph', password: 'agency123', note: 'Active' },
                { label: 'Agency · AMBaG',       email: 'coordinator@ambag.gov.ph',     password: 'agency123', note: 'Active' },
                { label: 'Agency · PCSO',        email: 'coordinator@pcso.gov.ph',      password: 'agency123', note: 'Active' },
                { label: 'Agency · DSWD',        email: 'coordinator@dswd.gov.ph',      password: 'agency123', note: 'Active' },
              ].map(acc => (
                <button
                  key={acc.label}
                  className="text-left px-3 py-2 rounded-lg bg-white hover:bg-brand-50 hover:text-brand-600 transition-colors text-xs border border-amber-100"
                  onClick={() => setForm({ email: acc.email, password: acc.password })}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium truncate">{acc.label}</p>
                    {acc.note && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 font-medium ${
                        acc.note === 'Deactivated' ? 'bg-red-100 text-red-500' : 'bg-green-100 text-green-600'
                      }`}>{acc.note}</span>
                    )}
                  </div>
                  <p className="text-gray-400 truncate">{acc.email}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-4">
          <Link to="/" className="hover:text-gray-600">{t('auth.backHome')}</Link>
        </p>
      </div>

      {/* Fix 2 — Forgot Password modal */}
      {showReset && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setShowReset(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">{t('auth.reset.title')}</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {t('auth.reset.desc')}
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="relative">
                <MdEmail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="email"
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
