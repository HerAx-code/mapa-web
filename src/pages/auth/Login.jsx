import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LanguageToggle from '../../components/LanguageToggle'
import Logo from '../../components/ui/Logo'
import DemoAccountsPanel from '../../components/DemoAccountsPanel'
import { MdVisibility, MdVisibilityOff, MdEmail, MdClose, MdShield, MdInfoOutline, MdErrorOutline } from 'react-icons/md'
import { useAuth } from '../../contexts/AuthContext'
import { ROLES } from '../../utils/constants'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../../firebase'
import { isMfaChallenge, resolverFor, resolveTotpSignIn } from '../../utils/mfa'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import toast from 'react-hot-toast'

// Login page review (2026-11-25):
// - Wrong email and wrong password are ONE message: Firebase returns the same
//   code for both (auth/invalid-credential), and "Incorrect password" sent
//   people with a mistyped email back to retype their password.
// - Errors stay on the page, under the form, until the person types — not a
//   toast that fades — and the fields are marked invalid for screen readers.
// - The pre-login announcement banner was removed: the rules let only
//   signed-in users read announcements, so it could never show (and it would
//   have shown one hospital's notice to everyone).

// Client-side email format gate for the reset dialog.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Per-role post-login destination (matches Landing.jsx's DASHBOARD map).
const DASHBOARD = {
  [ROLES.PATIENT]:      '/patient/dashboard',
  [ROLES.AGENCY]:       '/agency/dashboard',
  [ROLES.AGENCY_ADMIN]: '/agency/dashboard',
  [ROLES.SUPER_ADMIN]:  '/admin/dashboard',
  [ROLES.STAFF_ADMIN]:  '/admin/dashboard',
  [ROLES.PLATFORM_ADMIN]: '/platform/hospitals',
}

// Firebase error code → { message, credentials? } (credentials: show the
// "reset password / create an account" ways out under the message).
const signInError = (code, t) => {
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
      return { message: t('auth.errors.wrongCredentials'), credentials: true }
    case 'auth/invalid-email':
      return { message: t('auth.errors.invalidEmail') }
    case 'auth/too-many-requests':
      return { message: t('auth.errors.tooManyRequests') }
    case 'auth/user-disabled':
      return { message: t('auth.errors.userDisabled') }
    case 'auth/network-request-failed':
      return { message: t('auth.errors.networkFailed') }
    default:
      return { message: t('auth.errors.loginFailed') }
  }
}

// Shared field styling for the login inputs.
const FIELD_BASE =
  'h-12 w-full rounded-xl border bg-white px-4 text-[15px] text-gray-900 outline-none ' +
  'transition-colors duration-150 placeholder:text-gray-300 ' +
  'focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

// ── Forgot password — a real dialog (role, title, Escape, focus kept inside) ──
function ResetDialog({ t, initialEmail, onClose }) {
  const [email, setEmail] = useState(initialEmail)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef(null)
  useEscapeKey(onClose, !sending)
  useFocusTrap(ref, true)

  const send = async (e) => {
    e.preventDefault()
    const value = email.trim().toLowerCase()
    if (!value) { setError(t('auth.errors.enterEmail')); return }
    if (!EMAIL_RE.test(value)) { setError(t('auth.errors.invalidEmail')); return }
    setSending(true); setError('')
    try {
      await sendPasswordResetEmail(auth, value)
      // Worded so it never reveals whether the address has an account.
      toast.success(t('auth.toast.resetSent'), { duration: 8000 })
      onClose()
    } catch (err) {
      const code = err.code ?? ''
      setError(code === 'auth/invalid-email' ? t('auth.errors.invalidEmail')
        : code === 'auth/network-request-failed' ? t('auth.errors.networkFailed')
        : t('auth.errors.resetFailed'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && !sending && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-desc"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <form onSubmit={send} noValidate>
          <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 id="reset-title" className="text-base font-semibold text-gray-900">{t('auth.reset.title')}</h2>
              <p id="reset-desc" className="text-xs text-gray-500 mt-0.5">{t('auth.reset.desc')}</p>
            </div>
            <button type="button" onClick={onClose} aria-label={t('auth.reset.cancel')}
              className="flex-shrink-0 w-11 h-11 -mt-2 -mr-2 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
              <MdClose size={20} />
            </button>
          </div>
          <div className="px-5 py-4 space-y-2">
            <label htmlFor="reset-email" className="sr-only">{t('auth.email')}</label>
            <div className="relative">
              <MdEmail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} aria-hidden="true" />
              <input id="reset-email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
                inputMode="email" className="input pl-9 min-h-[44px]" placeholder={t('auth.reset.placeholder')}
                value={email} onChange={e => { setEmail(e.target.value); setError('') }} autoFocus
                aria-invalid={error ? true : undefined} aria-describedby={error ? 'reset-error' : undefined} />
            </div>
            {error && <p id="reset-error" role="alert" className="text-sm text-red-600">{error}</p>}
          </div>
          <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50 pt-3">
            <button type="button" className="btn-secondary text-sm min-h-[44px]" onClick={onClose} disabled={sending}>
              {t('auth.reset.cancel')}
            </button>
            <button type="submit" className="btn-primary text-sm min-h-[44px]" disabled={sending}>
              {sending ? t('auth.reset.sending') : t('auth.reset.send')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Login() {
  const navigate        = useNavigate()
  const [searchParams]  = useSearchParams()
  const timedOut        = searchParams.get('reason') === 'timeout'
  const { t }           = useTranslation()
  const { login, user } = useAuth()

  // In the installed app the landing page redirects away, so "Back to home"
  // would bounce back here — hide it there.
  const [isStandalone] = useState(() =>
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true)
  )

  const [form, setForm]       = useState({ email: '', password: '' })
  const [showPw, setShowPw]   = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null) // { message, credentials? } | null
  const [showReset, setShowReset] = useState(false)
  // MFA (TOTP) challenge state — an enrolled staff user enters their code.
  const [mfaResolver, setMfaResolver] = useState(null)
  const [mfaCode, setMfaCode]         = useState('')
  const [mfaBusy, setMfaBusy]         = useState(false)
  const [mfaError, setMfaError]       = useState('')

  // Redirect if already logged in
  useEffect(() => {
    if (user) navigate(DASHBOARD[user.role] ?? '/patient/dashboard', { replace: true })
  }, [user])

  const edit = (field) => (e) => { setForm({ ...form, [field]: e.target.value }); setError(null) }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.email || !form.password) {
      setError({ message: t('auth.errors.enterCredentials') })
      return
    }
    await signIn(form.email, form.password)
  }

  // Shared by the form and the dev-only demo-accounts panel.
  const signIn = async (email, password) => {
    setLoading(true)
    try {
      const loggedIn = await login(email, password)
      setError(null)
      navigate(DASHBOARD[loggedIn.role] ?? '/patient/dashboard')
    } catch (err) {
      // Enrolled staff: password was correct but a second factor is required.
      if (isMfaChallenge(err)) {
        setMfaResolver(resolverFor(auth, err))
        return
      }
      setError(signInError(err.code ?? '', t))
    } finally {
      setLoading(false)
    }
  }

  // Second step for enrolled users: verify the 6-digit TOTP code. On success
  // the auth state updates and the redirect effect navigates to the dashboard.
  const handleMfaSubmit = async (e) => {
    e.preventDefault()
    setMfaError(''); setMfaBusy(true)
    try {
      await resolveTotpSignIn(mfaResolver, mfaCode)
    } catch (err) {
      if (err?.code === 'auth/invalid-verification-code' || err?.code === 'auth/invalid-payload')
        setMfaError('That code did not match. Enter the current code from your authenticator app.')
      else
        setMfaError('Could not verify the code. Please try again.')
    } finally {
      setMfaBusy(false)
    }
  }

  const fieldState = error ? 'border-red-300 bg-red-50' : 'border-gray-200 hover:border-gray-300'
  const invalid = error ? { 'aria-invalid': true, 'aria-describedby': 'login-error' } : {}

  return (
    <div className="relative min-h-screen w-full bg-white lg:grid lg:grid-cols-[1fr_minmax(0,44%)]">

      {/* ── Left: brand panel (desktop only) ── */}
      <aside className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between bg-gradient-to-br from-brand-700 via-brand-800 to-brand-900">
        <div className="brand-aurora" aria-hidden="true" />
        <div className="relative px-12 pt-12">
          <span className="inline-flex items-center gap-2.5">
            <img src="/mapa-logo.png" alt="MAPA"
              className="h-10 w-10 rounded-[11px] object-contain ring-1 ring-white/15" />
            <span className="font-display text-[19px] font-bold tracking-tight text-white">MAPA</span>
          </span>
        </div>
        <div className="relative px-12 py-10">
          <h2 className="max-w-md font-display text-[33px] font-bold leading-[1.1] tracking-tight text-white text-balance">
            {t('auth.brand.headline')}
          </h2>
          <p className="mt-4 max-w-sm text-[15.5px] leading-relaxed text-brand-100/90">{t('auth.brand.sub')}</p>
          <div className="mt-7 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[12.5px] font-semibold text-white">
              <MdShield size={13} aria-hidden="true" /> {t('auth.brand.chipPrivacy')}
            </span>
            <span className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[12.5px] font-semibold text-white">
              {t('auth.brand.chipLanguages')}
            </span>
          </div>
        </div>
        <div className="relative flex items-center gap-2.5 border-t border-white/10 px-12 py-6">
          <MdShield size={16} className="flex-shrink-0 text-brand-300" aria-hidden="true" />
          <p className="text-xs text-brand-100/75">{t('auth.brand.trust')}</p>
        </div>
      </aside>

      {/* ── Right: form column ── */}
      <main className="flex min-h-screen flex-col bg-white lg:min-h-0">
        <header className="flex items-center justify-between gap-3 px-6 py-6 sm:px-10">
          <div className="flex items-center gap-2 sm:gap-3">
            {!isStandalone && (
              <Link to="/"
                className="inline-flex items-center min-h-[44px] -ml-3 rounded-lg px-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900">
                {t('auth.backHome')}
              </Link>
            )}
            <Logo size={36} withWordmark className="lg:invisible" />
          </div>
          <LanguageToggle className="min-h-[44px] px-3" />
        </header>

        <div className="flex flex-1 items-center justify-center px-6 pb-10 sm:px-10">
          <div className="w-full max-w-[420px]">
            <h1 className="font-display text-[28px] sm:text-[30px] font-bold leading-tight tracking-tight text-brand-900">
              {t('auth.welcome')}
            </h1>
            <p className="mt-2 text-[15px] text-gray-500">{t('auth.signinSubtitle')}</p>

            {/* Signed-out-for-inactivity notice (staff idle timeout). */}
            {timedOut && (
              <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <MdInfoOutline size={18} className="mt-0.5 flex-shrink-0 text-amber-600" />
                <p className="text-sm text-amber-800">{t('auth.timeoutNotice')}</p>
              </div>
            )}

            {!mfaResolver ? (
            <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
              <div>
                <label htmlFor="login-email" className="block text-sm font-medium text-gray-900">{t('auth.email')}</label>
                <input
                  id="login-email" type="email" required autoFocus autoCapitalize="none" spellCheck={false}
                  inputMode="email" autoComplete="email"
                  className={`mt-2 ${FIELD_BASE} ${fieldState}`}
                  placeholder={t('auth.emailPlaceholder')}
                  value={form.email} onChange={edit('email')} {...invalid} />
              </div>

              <div>
                <div className="flex items-center justify-between gap-4">
                  <label htmlFor="login-password" className="block text-sm font-medium text-gray-900">{t('auth.password')}</label>
                  <button type="button"
                    className="inline-flex min-h-[44px] items-center -my-3 px-1 text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline underline-offset-4"
                    onClick={() => setShowReset(true)}>
                    {t('auth.forgotPassword')}
                  </button>
                </div>
                <div className="relative mt-2">
                  <input
                    id="login-password" type={showPw ? 'text' : 'password'} required autoComplete="current-password"
                    className={`${FIELD_BASE} pr-12 ${fieldState}`}
                    placeholder={t('auth.passwordPlaceholder')}
                    value={form.password} onChange={edit('password')} {...invalid} />
                  <button type="button"
                    aria-label={showPw ? t('auth.hidePassword') : t('auth.showPassword')}
                    className="absolute right-0.5 top-0.5 flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-brand-50 hover:text-brand-600 transition-colors"
                    onClick={() => setShowPw(!showPw)}>
                    {showPw ? <MdVisibilityOff size={18} /> : <MdVisibility size={18} />}
                  </button>
                </div>
              </div>

              {/* The error stays here until the person types (not a toast). */}
              {error && (
                <div id="login-error" role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                  <p className="flex items-start gap-2 text-sm font-medium text-red-800">
                    <MdErrorOutline size={18} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                    {error.message}
                  </p>
                  {error.credentials && (
                    <div className="mt-1 flex flex-wrap gap-x-4 pl-6">
                      <button type="button" onClick={() => setShowReset(true)}
                        className="inline-flex min-h-[44px] items-center text-sm font-semibold text-red-800 underline underline-offset-2">
                        {t('auth.errors.resetPasswordLink')}
                      </button>
                      <Link to="/register"
                        className="inline-flex min-h-[44px] items-center text-sm font-semibold text-red-800 underline underline-offset-2">
                        {t('auth.errors.createAccountLink')}
                      </Link>
                    </div>
                  )}
                </div>
              )}

              <button type="submit" disabled={loading}
                className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 text-[15px] font-semibold text-white transition-colors hover:bg-brand-600 active:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed">
                {loading ? t('auth.signingIn') : t('auth.signIn')}
                {!loading && <span aria-hidden="true">→</span>}
              </button>
            </form>
            ) : (
              /* Second factor — enrolled staff enter their authenticator code.
                 Staff-only surface, so English (patients never enroll). */
              <form onSubmit={handleMfaSubmit} noValidate className="mt-8 space-y-5">
                <div className="flex items-center gap-2 text-brand-700">
                  <MdShield size={18} />
                  <p className="text-sm font-semibold">Two-step verification</p>
                </div>
                <div>
                  <label htmlFor="mfa-code" className="block text-sm font-medium text-gray-900">Enter your 6-digit code</label>
                  <p className="mt-1 text-sm text-gray-500">Open your authenticator app and enter the current code for MAPA.</p>
                  <input
                    id="mfa-code" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoFocus
                    autoComplete="one-time-code"
                    className={`mt-2 ${FIELD_BASE} text-center font-mono tracking-[0.4em]`}
                    placeholder="123456" value={mfaCode}
                    onChange={e => { setMfaCode(e.target.value.replace(/\D/g, '')); setMfaError('') }} />
                  {mfaError && <p role="alert" className="mt-2 text-sm text-red-600">{mfaError}</p>}
                </div>
                <button type="submit" disabled={mfaBusy || mfaCode.length !== 6}
                  className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 text-[15px] font-semibold text-white transition-colors hover:bg-brand-600 active:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed">
                  {mfaBusy ? 'Verifying…' : 'Verify'}
                </button>
                <button type="button"
                  onClick={() => { setMfaResolver(null); setMfaCode(''); setMfaError('') }}
                  className="w-full min-h-[44px] text-sm text-gray-500 hover:text-gray-700">
                  Back to sign in
                </button>
              </form>
            )}

            <p className="mt-6 text-sm text-gray-500">
              {t('auth.noAccount')}{' '}
              <Link to="/register" className="inline-flex min-h-[44px] items-center font-semibold text-brand-600 hover:text-brand-700 hover:underline underline-offset-4">
                {t('auth.registerHere')}
              </Link>
            </p>
            {/* For someone who can't get in at all: a person to ask. */}
            <p className="mt-1 text-xs leading-relaxed text-gray-500">{t('auth.helpStuck')}</p>

            {/* DEV ONLY: picking a demo account fills the fields above (it does
                NOT auto sign-in). Build-time flags, so a production build drops
                the panel and the demo passwords. */}
            {(import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true' || import.meta.env.VITE_ENABLE_SEED === 'true') && (
              <DemoAccountsPanel busy={loading} onPick={(email, password) => {
                setForm({ email, password })
              }} />
            )}
          </div>
        </div>
      </main>

      {showReset && <ResetDialog t={t} initialEmail={form.email} onClose={() => setShowReset(false)} />}
    </div>
  )
}
