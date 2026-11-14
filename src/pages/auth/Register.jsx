import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import {
  MdShield, MdVisibility, MdVisibilityOff,
  MdCheckCircle, MdArrowForward, MdArrowBack, MdCancel,
  MdSchedule, MdPlace, MdLocalHospital,
} from 'react-icons/md'
import Logo from '../../components/ui/Logo'
import SearchableSelect from '../../components/ui/SearchableSelect'
import LanguageToggle from '../../components/LanguageToggle'
import { createUserWithEmailAndPassword, fetchSignInMethodsForEmail, deleteUser } from 'firebase/auth'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { useTranslation, Trans } from 'react-i18next'
import ProfileModals from '../../components/ProfileModals'
import TermsModal from '../../components/TermsModal'
import AddressPicker from '../../components/AddressPicker'
import { TERMS_VERSION } from '../../utils/constants'
import { hasReservedToken } from '../../utils/names'
import { ORG, accessCodeRe } from '../../config/org'
import toast from 'react-hot-toast'
import { PENDING_CODE_KEY } from '../../utils/accessCodes'
import { usePublicHospitals } from '../../hooks/usePublicHospitals'

// Marketplace (docs/patient-marketplace-plan.md): registration joins the
// NETWORK, not a hospital. The patient picks a hospital — and enters that
// hospital's access code — each time they file a request.
const ACCESS_CODE_RE = accessCodeRe()

const EMAIL_RE        = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const NAME_RE         = /^[A-Za-zÑñ\s\-'.,]*$/
const SUFFIXES        = ['', 'Jr.', 'Sr.', 'II', 'III', 'IV', 'V']

// Sanitizers
const sanitizeName  = (val) => val.replace(/[^A-Za-zÑñ\s\-'.,]/g, '').slice(0, 50)
// Accept +63 / 63 international prefix by normalizing to local 09… form
// before the 11-digit truncation. Otherwise pasted "+639171234567" becomes
// "63917123456" and silently fails validation.
const sanitizePhone = (val) => {
  let digits = val.replace(/\D/g, '')
  if (digits.startsWith('63') && digits.length >= 12) digits = '0' + digits.slice(2)
  return digits.slice(0, 11)
}

// Validators
const isStrongPassword = (pw) => {
  if (pw.length < 8) return false
  const types = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter(r => r.test(pw)).length
  return types >= 2
}

// Takes `t` so the strength label is bilingual. Called per-keystroke; kept
// out of the component so it's not redefined on each render.
const getStrength = (pw, t) => {
  if (!pw) return null
  if (pw.length < 6) return { level: 1, label: t('register.password.tooShort'),  color: 'bg-red-400',   width: 'w-1/4' }
  const types = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter(r => r.test(pw)).length
  if (pw.length >= 8 && types >= 3) return { level: 4, label: t('register.password.strong'),    color: 'bg-green-500', width: 'w-full' }
  if (pw.length >= 8 && types >= 2) return { level: 3, label: t('register.password.good'),      color: 'bg-amber-400', width: 'w-2/3'  }
  if (pw.length >= 6 && types >= 2) return { level: 2, label: t('register.password.weakNeed8'), color: 'bg-red-400',   width: 'w-1/3' }
  return                                   { level: 2, label: t('register.password.weakAddLN'), color: 'bg-red-400',   width: 'w-1/3' }
}

function FieldError({ msg }) {
  if (!msg) return null
  return <p className="text-xs text-red-500 mt-1">{msg}</p>
}

// ── Step indicator ────────────────────────────────────────────────────────
// Step labels come from i18n at render time.

function StepIndicator({ current, steps, onJump }) {
  const { t } = useTranslation()
  const currentLabel = steps.find(s => s.num === current)?.label ?? ''
  return (
   <div className="mb-6">
    {/* Each step is an equal-width (flex-1) column with the circle centered and
        the connector absolutely positioned across the gap. This keeps the
        circles evenly spaced no matter how long a (translated) label is —
        whitespace-nowrap + in-flow connectors previously let a long Filipino
        label widen one column and skew the whole row. */}
    <div className="flex items-start max-w-md mx-auto">
      {steps.map((s, i) => {
        // Past steps are clickable for in-place edits; current and future
        // steps are not (future steps would skip validation).
        const canJump = s.num < current
        const CircleWrap = canJump ? 'button' : 'div'
        return (
          <div key={s.num} className="relative flex flex-1 flex-col items-center">
            {/* Connector into this step — spans from the previous circle's
                centre to this one's, pinned to the circle's vertical centre
                (top-4 = half of the h-8 circle) so label height/width never
                moves it. */}
            {i > 0 && (
              <div className={`absolute top-4 -left-1/2 w-full h-0.5 -translate-y-1/2 transition-colors ${
                s.num <= current ? 'bg-brand-500' : 'bg-gray-200'
              }`} />
            )}
            <CircleWrap
              type={canJump ? 'button' : undefined}
              onClick={canJump ? () => onJump?.(s.num) : undefined}
              className={`relative z-10 flex flex-col items-center ${canJump ? 'cursor-pointer group' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                s.num < current  ? 'bg-brand-500 text-white group-hover:bg-brand-600'
                : s.num === current ? 'bg-brand-500 text-white ring-4 ring-brand-100'
                : 'bg-gray-100 text-gray-500'
              }`}>
                {s.num < current ? <MdCheckCircle size={16} /> : s.num}
              </div>
              <span className={`hidden sm:block text-xs mt-1.5 font-medium text-center leading-tight px-1 ${
                s.num === current ? 'text-brand-600'
                : canJump        ? 'text-gray-500 group-hover:text-brand-600'
                : 'text-gray-500'
              }`}>{s.label}</span>
            </CircleWrap>
          </div>
        )
      })}
    </div>
    {/* L3: on mobile the per-step labels are hidden (numbers only), so name the
        current step here. Hidden on sm+ where the labels under each circle show. */}
    <p className="sm:hidden mt-2 text-center text-sm font-medium text-brand-600">
      {t('register.stepProgress', { current, total: steps.length, label: currentLabel })}
    </p>
   </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export default function Register() {
  const { t }                 = useTranslation()
  const navigate              = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { updateUser }        = useAuth()

  // Hide the 'Back to Home' link when running in the installed PWA —
  // Landing.jsx redirects '/' away in standalone mode, so the link
  // would just round-trip the user back here.
  const [isStandalone] = useState(() =>
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true)
  )

  // Step labels — built here so they re-render on language change.
  const STEPS = [
    { num: 1, label: t('register.stepPersonal') },
    { num: 2, label: t('register.stepAccount')  },
    { num: 3, label: t('register.stepFinish')   },
  ]

  // Restore in-progress registration from sessionStorage so a refresh /
  // accidental swipe-back doesn't wipe everything the patient typed.
  // Passwords are NOT persisted — too risky for shared/borrowed devices.
  const DRAFT_KEY = 'mapa_register_draft'
  const loadDraft = () => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY)
      if (!raw) return null
      return JSON.parse(raw)
    } catch { return null }
  }
  const draft = loadDraft()

  const [step, setStep]                     = useState(draft?.step ?? 1)
  // A real hospital prefix for the code example (the first participating
  // hospital's, else this deployment's own).
  const publicHospitals = usePublicHospitals()
  const examplePrefix = publicHospitals[0]?.accessCodePrefix || ORG.accessCodePrefix
  const [loading, setLoading]               = useState(false)
  const [showPw, setShowPw]                 = useState(false)
  const [showConfirmPw, setShowConfirmPw]   = useState(false)
  const [agreedToTerms, setAgreedToTerms]   = useState(false)
  const [errors, setErrors]                 = useState({})
  // Open ProfileModals' Privacy Notice (SettingsModal) from the terms
  // checkbox so the patient can actually read what they're agreeing to.
  const [showPrivacy, setShowPrivacy]       = useState(false)
  const [showTerms, setShowTerms]           = useState(false)

  const [form, setForm] = useState({
    firstName: '', middleName: '', lastName: '', suffix: '',
    email: '',
    contactNumber: '',
    barangay: '', city: '', province: '',
    ...(draft?.form ?? {}),
    // Always start with empty passwords regardless of any persisted state
    password: '', confirmPassword: '',
  })

  // Persist non-sensitive form fields + current step on every change.
  useEffect(() => {
    // eslint-disable-next-line no-unused-vars
    const { password, confirmPassword, hospitalId, ...safe } = form
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ form: safe, step }))
    } catch {}
  }, [form, step])

  const set = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }))
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }))
  }

  // Sanitizing setters
  const setName = (field) => (e) => {
    const clean = sanitizeName(e.target.value)
    setForm(prev => ({ ...prev, [field]: clean }))
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }))
  }

  const setPhone = (e) => {
    const clean = sanitizePhone(e.target.value)
    setForm(prev => ({ ...prev, contactNumber: clean }))
    if (errors.contactNumber) setErrors(prev => ({ ...prev, contactNumber: '' }))
  }

  // AddressPicker emits {province, city, barangay} as one update; mirror
  // that into form state and clear any field-level error for the three
  // address fields so the user sees the validation banners disappear as
  // they correct their entry.
  const onAddressChange = ({ province, city, barangay }) => {
    setForm(prev => ({ ...prev, province, city, barangay }))
    setErrors(prev => ({ ...prev, province: '', city: '', barangay: '' }))
  }

  // Email availability pre-check — fires on blur of the email field so the
  // patient finds out about "already in use" before spending 2+ minutes on
  // Steps 2-3 only to be kicked back. Silent failure on network errors.
  const checkEmailAvailable = async () => {
    const email = form.email.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return
    try {
      const methods = await fetchSignInMethodsForEmail(auth, email)
      if (methods.length > 0) {
        setErrors(prev => ({ ...prev, email: t('register.errors.emailInUse') }))
      }
    } catch { /* network blip — defer to submit-time check */ }
  }

  const strength = getStrength(form.password, t)

  const inputCls = (field) =>
    `input ${errors[field] ? 'border-red-400 bg-red-50' : ''}`

  // ── Per-step validation ─────────────────────────────────────────────────

  const validateStep1 = () => {
    const e = {}
    if (!form.firstName.trim()) e.firstName = t('register.errors.firstNameRequired')
    else if (!NAME_RE.test(form.firstName)) e.firstName = t('register.errors.nameLettersOnly')
    else if (hasReservedToken(form.firstName)) e.firstName = t('register.errors.nameReserved')
    if (!form.lastName.trim())  e.lastName  = t('register.errors.lastNameRequired')
    else if (!NAME_RE.test(form.lastName)) e.lastName = t('register.errors.nameLettersOnly')
    else if (hasReservedToken(form.lastName)) e.lastName = t('register.errors.nameReserved')
    if (form.middleName && !NAME_RE.test(form.middleName)) e.middleName = t('register.errors.nameLettersOnly')
    else if (form.middleName && hasReservedToken(form.middleName)) e.middleName = t('register.errors.nameReserved')

    if (!form.contactNumber) {
      e.contactNumber = t('register.errors.contactRequired')
    } else if (!/^09\d{9}$/.test(form.contactNumber)) {
      e.contactNumber = t('register.errors.contactInvalid')
    }
    if (!form.barangay.trim()) e.barangay = t('register.errors.barangayRequired')
    if (!form.city.trim())     e.city     = t('register.errors.cityRequired')
    if (!form.province.trim()) e.province = t('register.errors.provinceRequired')
    return e
  }

  const validateStep2 = () => {
    const e = {}
    if (!form.email.trim()) {
      e.email = t('register.errors.emailRequired')
    } else if (!EMAIL_RE.test(form.email.trim())) {
      e.email = t('register.errors.emailInvalid')
    }
    if (!isStrongPassword(form.password)) {
      e.password = t('register.errors.passwordWeak')
    }
    if (form.password !== form.confirmPassword) {
      e.confirmPassword = t('register.errors.passwordMismatch')
    }
    return e
  }

  const validateStep3 = () => {
    const e = {}
    if (!agreedToTerms) e.terms = t('register.errors.termsRequired')
    return e
  }

  // ── Navigation ──────────────────────────────────────────────────────────

  const handleNext = () => {
    const errs = step === 1 ? validateStep1() : validateStep2()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      // Scroll the first errored field into view + focus it. Without this,
      // patients on long forms (Step 1's 11 fields) tap Next from the
      // bottom and see nothing happen because the errors render off-screen.
      const firstField = Object.keys(errs)[0]
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-field="${firstField}"]`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el?.focus({ preventScroll: true })
      })
      return
    }
    setErrors({})
    setStep(s => s + 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleBack = () => {
    setErrors({})
    setStep(s => s - 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // A scanned code slip (/register?code=…) no longer decides anything at
  // sign-up: keep the code for the request flow, which pre-selects its
  // hospital, and strip it from the URL so it doesn't linger in history.
  useEffect(() => {
    const qrCode = (searchParams.get('code') || '').trim().toUpperCase()
    if (!qrCode) return
    if (ACCESS_CODE_RE.test(qrCode)) {
      try { sessionStorage.setItem(PENDING_CODE_KEY, qrCode) } catch { /* ignore */ }
      toast(t('register.toast.codeSaved'), { icon: 'ℹ️', duration: 6000 })
    }
    searchParams.delete('code')
    setSearchParams(searchParams, { replace: true })
    // Run once on mount; deps intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Submit ──────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    // #11 — Idempotency guard: prevent double-submit on slow phones where
    // React's disabled-prop re-render lags behind a double-tap.
    if (loading) return

    const errs = validateStep3()
    if (Object.keys(errs).length > 0) { setErrors(errs); return }

    setLoading(true)
    let createdAuthUser = null   // tracked for rollback on Firestore failure
    try {
      // Normalize email to lowercase for consistent storage. Firebase Auth
      // is case-insensitive on the auth side, but downstream display and
      // search queries are case-sensitive against the user doc.
      const normalizedEmail = form.email.trim().toLowerCase()
      const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, form.password)
      createdAuthUser = cred.user
      const uid  = cred.user.uid
      const name = [form.firstName, form.middleName, form.lastName, form.suffix]
        .map(s => s.trim()).filter(Boolean).join(' ')
      const address = [form.barangay, form.city, form.province]
        .map(s => s.trim()).filter(Boolean).join(', ')
      const patientId = `PAT-${Date.now().toString().slice(-6)}`

      const userData = {
        name, email: normalizedEmail, role: 'patient',
        contact: form.contactNumber, address,
        barangay: form.barangay.trim(),
        city:     form.city.trim(),
        province: form.province.trim(),
        suffix:   form.suffix || null,
        patientId,
        agencyId: null, rank: null, cooldown: 0,
        deletion: false, active: true,
        // Terms of Use acceptance record (who = this uid, when, which version).
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      }

      // Network account: no hospital and no code yet (the rules refuse
      // either at sign-up). The first request claims both.
      try {
        await setDoc(doc(db, 'users', uid), userData)
      } catch (writeErr) {
        // #1 — Roll back the orphan Auth account so the patient can retry
        // without their email being "already in use" with no profile.
        try { await deleteUser(createdAuthUser) }
        catch (delErr) { console.error('[Register] orphan Auth rollback failed (profile write):', delErr) }
        createdAuthUser = null
        throw writeErr
      }

      // Immediately sync role into AuthContext so PrivateRoute sees 'patient'
      // before onAuthStateChanged re-reads the doc (timing fix)
      updateUser({ uid, ...userData })

      // Successful registration — discard the draft so a future visit to
      // /register doesn't pre-fill someone else's data.
      try { sessionStorage.removeItem(DRAFT_KEY) } catch {}

      toast.success(t('register.toast.welcome', { name: form.firstName }))
      navigate('/patient/hospitals')
    } catch (err) {
      // #1 — If Auth account was created before this throw and not already
      // rolled back inside the transaction handler above, drop it so the
      // patient can retry registration cleanly.
      if (createdAuthUser) {
        try { await deleteUser(createdAuthUser) }
        catch (delErr) { console.error('[Register] orphan Auth rollback failed (outer catch):', delErr) }
      }
      if (err.code === 'auth/email-already-in-use') {
        setErrors({ email: t('register.errors.emailInUse') })
        setStep(2)
      } else if (err.code === 'auth/weak-password') {
        setErrors({ password: t('register.errors.passwordTooWeak') })
        setStep(2)
      } else {
        toast.error(err.message || t('register.errors.generic'))
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="relative min-h-screen w-full bg-white lg:grid lg:grid-cols-[24rem_1fr]">

      {/* ── Left: "apply" brand panel (desktop only) — matches the Login
          brand column. Sticky so it stays put while the long form scrolls. */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-brand-900 lg:flex lg:flex-col lg:justify-between lg:sticky lg:top-0 lg:h-screen">
        <div className="brand-aurora" aria-hidden="true" />
        <div className="relative px-10 pt-12">
          <span className="inline-flex items-center gap-2.5">
            <img
              src="/mapa-logo.png"
              alt="MAPA"
              className="h-10 w-10 rounded-[11px] object-contain ring-1 ring-white/15" />
            <span className="font-display text-[19px] font-bold tracking-tight text-white">MAPA</span>
          </span>
          <h2 className="mt-10 font-display text-[28px] font-bold leading-[1.12] tracking-tight text-white text-balance">
            {t('register.brand.headline')}
          </h2>
          <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-brand-100/85">
            {t('register.brand.sub')}
          </p>
          <div className="mt-8 border-t border-white/15 pt-6">
            <h3 className="text-[13px] font-semibold text-white">{t('register.brand.readyTitle')}</h3>
            <ul className="mt-3.5 space-y-3">
              {[1, 2, 3].map(i => (
                <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-brand-100/85">
                  <MdCheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-300" aria-hidden="true" />
                  {t(`register.brand.ready${i}`)}
                </li>
              ))}
            </ul>
          </div>
          {/* Marketplace: a code from the CHOSEN hospital, per request. */}
          <div className="mt-6 rounded-2xl border border-white/15 bg-white/[0.07] p-4">
            <h3 className="text-[13px] font-semibold text-white">{t('register.brand.codeTitle')}</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-brand-100/85">{t('register.brand.codeBody')}</p>
            <div className="mt-3 rounded-xl border border-dashed border-brand-300/60 bg-brand-900/40 px-3 py-2.5">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-brand-100/70">{t('register.brand.codeExample')}</p>
              <p className="mt-0.5 font-mono text-[15px] font-semibold tracking-[0.12em] text-white">
                <span className="text-brand-300">{examplePrefix}</span>-{new Date().getFullYear()}-00014
              </p>
              <p className="mt-1 text-[11.5px] text-brand-100/80">{t('register.brand.codePrefixNote')}</p>
            </div>
          </div>
        </div>
        <div className="relative space-y-2.5 px-10 py-8 text-[13px] text-brand-100/80">
          <p className="flex items-center gap-2"><MdSchedule size={16} className="flex-shrink-0 text-brand-300" aria-hidden="true" /> {t('register.brand.trustTime')}</p>
          <p className="flex items-center gap-2"><MdShield size={16} className="flex-shrink-0 text-brand-300" aria-hidden="true" /> {t('register.brand.trustPrivacy')}</p>
          <p className="flex items-center gap-2"><MdPlace size={16} className="flex-shrink-0 text-brand-300" aria-hidden="true" /> {t('register.brand.trustHelp')}</p>
        </div>
      </aside>

      {/* ── Right: form column ── */}
      <main className="flex min-h-screen flex-col bg-white">
        <header className="flex items-center justify-between gap-4 px-6 py-6 sm:px-10">
          {/* Logo on mobile (the brand panel carries it on desktop). */}
          <Logo size={36} withWordmark className="lg:invisible" />
          <LanguageToggle />
        </header>

        <div className="flex flex-1 justify-center px-6 pb-12 sm:px-10">
          <div className="w-full max-w-xl">
            {!isStandalone && (
              <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-600 mb-6">← {t('register.backHome')}</Link>
            )}

            {/* DEV ONLY (build-time flags): demo accounts live on Log in. */}
            {(import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true' || import.meta.env.VITE_ENABLE_SEED === 'true') && (
              <Link to="/login" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800 hover:bg-amber-100">
                <span>Demo accounts (dev only) — sign in as any role with one click</span>
                <span aria-hidden="true">→</span>
              </Link>
            )}

            <div className="mb-6">
              <h1 className="font-display text-[26px] font-bold tracking-tight text-brand-900">{t('register.title')}</h1>
              <p className="text-sm text-gray-500 mt-1">{t('register.subtitle')}</p>
            </div>

            {/* Step indicator — past steps are clickable so the patient can
                edit a typo without manually clicking Back N times. */}
          <StepIndicator current={step} steps={STEPS} onJump={(n) => { setErrors({}); setStep(n) }} />

          {/* All step content + nav buttons live inside one <form> so the
              keyboard's Go / Done key triggers the appropriate action.
              On Step 3 it creates the account. */}
          <form onSubmit={(e) => {
            e.preventDefault()
            if (step < 3) handleNext()
            else handleSubmit()
          }}>

          {/* ── Step 1 — Personal Info ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="mb-2">
                <p className="text-sm font-semibold text-gray-800">{t('register.step1.sectionTitle')}</p>
                <p className="text-xs text-gray-500 mt-0.5">{t('register.step1.sectionDesc')}</p>
              </div>

              {/* Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="reg-firstName" className="block text-sm font-medium text-gray-700 mb-1">{t('register.step1.firstName')} <span className="text-red-400">*</span></label>
                  <input id="reg-firstName" data-field="firstName" className={inputCls('firstName')} placeholder="Juan"
                    value={form.firstName} onChange={setName('firstName')}
                    autoComplete="given-name" autoCapitalize="words" maxLength={50} />
                  <FieldError msg={errors.firstName} />
                </div>
                <div>
                  <label htmlFor="reg-lastName" className="block text-sm font-medium text-gray-700 mb-1">{t('register.step1.lastName')} <span className="text-red-400">*</span></label>
                  <input id="reg-lastName" data-field="lastName" className={inputCls('lastName')} placeholder="Dela Cruz"
                    value={form.lastName} onChange={setName('lastName')}
                    autoComplete="family-name" autoCapitalize="words" maxLength={50} />
                  <FieldError msg={errors.lastName} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label htmlFor="reg-middleName" className="block text-sm font-medium text-gray-700 mb-1">{t('register.step1.middleName')} <span className="text-gray-500 font-normal">{t('register.step1.optional')}</span></label>
                  <input id="reg-middleName" data-field="middleName" className={inputCls('middleName')} placeholder="Santos"
                    value={form.middleName} onChange={setName('middleName')}
                    autoComplete="additional-name" autoCapitalize="words" maxLength={50} />
                  <FieldError msg={errors.middleName} />
                </div>
                <div>
                  <label htmlFor="reg-suffix" className="block text-sm font-medium text-gray-700 mb-1">{t('register.step1.suffix')}</label>
                  <SearchableSelect
                    id="reg-suffix"
                    value={form.suffix}
                    onChange={v => set('suffix')({ target: { value: v } })}
                    options={SUFFIXES.map(s => ({ value: s, label: s || `— ${t('register.step1.suffixNone')} —` }))} />
                </div>
              </div>

              {/* Contact */}
              <div>
                <label htmlFor="reg-contactNumber" className="block text-sm font-medium text-gray-700 mb-1">{t('register.step1.contactNumber')} <span className="text-red-400">*</span></label>
                <input id="reg-contactNumber" data-field="contactNumber" className={inputCls('contactNumber')} placeholder="09171234567"
                  inputMode="numeric" autoComplete="tel" maxLength={11}
                  value={form.contactNumber} onChange={setPhone} />
                <FieldError msg={errors.contactNumber} />
                {!errors.contactNumber && (
                  <p className="text-xs text-gray-500 mt-0.5">{t('register.step1.contactHint')}</p>
                )}
              </div>

              {/* Address — cascading BARMM Province → City → Barangay
                  picker. "Other (not listed)" reveals free-text inputs
                  for origins outside the BARMM list (Region XII, NCR,
                  etc.). Implementation lives in <AddressPicker>. */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">{t('register.step1.addressLabel')} <span className="text-red-400">*</span></p>
                <p className="text-xs text-gray-500 mb-2">{t('register.step1.addressHint')}</p>
                <AddressPicker
                  value={{ province: form.province, city: form.city, barangay: form.barangay }}
                  onChange={onAddressChange}
                  errors={{ province: errors.province, city: errors.city, barangay: errors.barangay }}
                  hideLabels
                  labels={{
                    selectProvince:    t('register.step1.selectProvince'),
                    selectCity:        t('register.step1.selectCity'),
                    selectBarangay:    t('register.step1.barangay'),
                    pickProvinceFirst: t('register.step1.selectCity'),
                    otherNotListed:    t('register.step1.otherNotListed'),
                    otherProvince:     t('register.step1.otherProvince'),
                    otherCity:         t('register.step1.otherCity'),
                    otherBarangay:     t('register.step1.barangay'),
                  }}
                />
              </div>
            </div>
          )}

          {/* ── Step 2 — Account Setup ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="mb-2">
                <p className="text-sm font-semibold text-gray-800">{t('register.step2.sectionTitle')}</p>
                <p className="text-xs text-gray-500 mt-0.5">{t('register.step2.sectionDesc')}</p>
              </div>

              <div>
                <label htmlFor="reg-email" className="block text-sm font-medium text-gray-700 mb-1">{t('register.step2.email')} <span className="text-red-400">*</span></label>
                <input id="reg-email" type="email" data-field="email" className={inputCls('email')} placeholder="juan@gmail.com"
                  inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
                  value={form.email} onChange={set('email')} onBlur={checkEmailAvailable} />
                <FieldError msg={errors.email} />
              </div>

              <div>
                <label htmlFor="reg-password" className="block text-sm font-medium text-gray-700 mb-1">{t('register.step2.password')} <span className="text-red-400">*</span></label>
                <div className="relative">
                  <input id="reg-password" type={showPw ? 'text' : 'password'} data-field="password" className={`${inputCls('password')} pr-10`}
                    placeholder={t('register.step2.passwordPlaceholder')}
                    autoComplete="new-password"
                    value={form.password} onChange={set('password')} />
                  <button type="button"
                    aria-label={showPw ? t('register.step2.hidePassword') : t('register.step2.showPassword')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-gray-500 hover:text-gray-600 hover:bg-gray-100 rounded-md"
                    onClick={() => setShowPw(p => !p)}>
                    {showPw ? <MdVisibilityOff size={16} /> : <MdVisibility size={16} />}
                  </button>
                </div>
                {strength && (
                  <div className="mt-1.5">
                    <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-1 rounded-full transition-all ${strength.color} ${strength.width}`} />
                    </div>
                    <p className={`text-xs mt-0.5 font-medium ${
                      strength.level >= 4 ? 'text-green-600' : strength.level === 3 ? 'text-amber-600' : 'text-red-500'
                    }`}>{strength.label}</p>
                  </div>
                )}
                <FieldError msg={errors.password} />
              </div>

              <div>
                <label htmlFor="reg-confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">{t('register.step2.confirmPassword')} <span className="text-red-400">*</span></label>
                <div className="relative">
                  <input id="reg-confirmPassword" type={showConfirmPw ? 'text' : 'password'} data-field="confirmPassword" className={`${inputCls('confirmPassword')} pr-16`}
                    placeholder={t('register.step2.confirmPlaceholder')}
                    autoComplete="new-password"
                    value={form.confirmPassword} onChange={set('confirmPassword')} />
                  {/* Live match indicator — only shown once the patient has
                      typed in BOTH password fields. Green check on match,
                      red x when they diverge. Saves the "click Next to find
                      out" round-trip. */}
                  {form.password && form.confirmPassword && (
                    <span className="absolute right-10 top-1/2 -translate-y-1/2">
                      {form.password === form.confirmPassword
                        ? <MdCheckCircle size={16} className="text-green-500" />
                        : <MdCancel size={16} className="text-red-400" />}
                    </span>
                  )}
                  <button type="button"
                    aria-label={showConfirmPw ? t('register.step2.hidePassword') : t('register.step2.showPassword')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-gray-500 hover:text-gray-600 hover:bg-gray-100 rounded-md"
                    onClick={() => setShowConfirmPw(p => !p)}>
                    {showConfirmPw ? <MdVisibilityOff size={16} /> : <MdVisibility size={16} />}
                  </button>
                </div>
                <FieldError msg={errors.confirmPassword} />
              </div>
            </div>
          )}

          {/* ── Step 3 — Review + Terms ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="mb-2">
                <p className="text-sm font-semibold text-gray-800">{t('register.step3.sectionTitle')}</p>
                <p className="text-xs text-gray-500 mt-0.5">{t('register.step3.sectionDesc')}</p>
              </div>

              {/* What happens next: the hospital is chosen per request. */}
              <div className="flex gap-3 rounded-xl border border-brand-100 bg-brand-50 p-3">
                <MdLocalHospital size={20} className="mt-0.5 flex-shrink-0 text-brand-600" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-brand-900">{t('register.step3.nextTitle')}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-brand-800">{t('register.step3.nextBody')}</p>
                </div>
              </div>

              {/* Review summary — collapsed by default. Lets the patient
                  catch typos in email / phone / name before submitting. */}
              <details className="border border-gray-100 rounded-xl overflow-hidden group">
                <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-between list-none">
                  <span>{t('register.step3.reviewToggle')}</span>
                  <MdArrowForward size={16} className="text-gray-500 transition-transform group-open:rotate-90" />
                </summary>
                <dl className="px-4 pb-3 pt-1 space-y-2 border-t border-gray-50">
                  <div>
                    <dt className="text-xs text-gray-500">{t('register.step1.firstName')}</dt>
                    <dd className="text-sm text-gray-800">
                      {[form.firstName, form.middleName, form.lastName, form.suffix].filter(Boolean).join(' ') || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">{t('register.step2.email')}</dt>
                    <dd className="text-sm text-gray-800 break-all">{form.email || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">{t('register.step1.contactNumber')}</dt>
                    <dd className="text-sm text-gray-800">{form.contactNumber || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">{t('register.step1.addressLabel')}</dt>
                    <dd className="text-sm text-gray-800">
                      {[form.barangay, form.city, form.province].filter(Boolean).join(', ') || '—'}
                    </dd>
                  </div>
                </dl>
              </details>

              {/* Terms — Privacy Notice opens an in-page modal so the
                  patient can actually read what they're agreeing to. */}
              <div className={`border rounded-xl p-3 transition-colors ${errors.terms ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-gray-50'}`}>
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input type="checkbox" className="w-4 h-4 accent-brand-500 flex-shrink-0 mt-0.5"
                    checked={agreedToTerms}
                    onChange={e => { setAgreedToTerms(e.target.checked); if (errors.terms) setErrors(p => ({ ...p, terms: '' })) }} />
                  <span className="text-xs text-gray-600 leading-relaxed">
                    <Trans i18nKey="register.step3.termsAgree" components={{
                      link: <button type="button"
                        className="text-brand-600 hover:text-brand-700 underline underline-offset-2 font-medium"
                        onClick={(e) => { e.preventDefault(); setShowPrivacy(true) }} />,
                      termslink: <button type="button"
                        className="text-brand-600 hover:text-brand-700 underline underline-offset-2 font-medium"
                        onClick={(e) => { e.preventDefault(); setShowTerms(true) }} />
                    }} />
                  </span>
                </label>
                <FieldError msg={errors.terms} />
              </div>
            </div>
          )}

          {/* ── Navigation buttons ── Primary uses type="submit" so the
              form's onSubmit fires it, enabling Enter / Go on mobile. */}
          <div className="flex gap-3 mt-6">
            {step > 1 && (
              <button type="button" className="btn-secondary flex items-center justify-center gap-1.5"
                onClick={handleBack} disabled={loading}>
                <MdArrowBack size={16} /> {t('register.back')}
              </button>
            )}
            {step < 3 ? (
              <button type="submit" className="btn-primary flex-1 flex items-center justify-center gap-1.5">
                {t('register.next')} <MdArrowForward size={16} />
              </button>
            ) : (
              <button type="submit" className="btn-primary flex-1 flex items-center justify-center gap-1.5"
                disabled={loading}>
                {loading ? t('register.creating') : `${t('register.create')} →`}
              </button>
            )}
          </div>

          </form>

            <p className="text-center text-xs text-gray-500 mt-6">
              {t('register.haveAccount')}{' '}
              <Link to="/login" className="text-brand-500 hover:text-brand-600 font-medium">{t('register.signIn')}</Link>
            </p>
          </div>
        </div>
      </main>

      {/* Privacy Notice modal — reuses ProfileModals' SettingsModal which
          renders the full RA 10173 privacy notice. */}
      <ProfileModals
        activeModal={showPrivacy ? 'settings' : null}
        onClose={() => setShowPrivacy(false)}
        onSetModal={() => {}}
      />

      {/* Terms of Use — readable document behind the agreement checkbox. */}
      <TermsModal
        open={showTerms}
        onClose={() => setShowTerms(false)}
        onPrivacy={() => { setShowTerms(false); setShowPrivacy(true) }}
      />
    </div>
  )
}
