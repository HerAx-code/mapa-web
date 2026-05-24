import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  MdShield, MdVerified, MdVisibility, MdVisibilityOff,
  MdCheckCircle, MdArrowForward, MdArrowBack,
} from 'react-icons/md'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'

const CURRENT_YEAR    = new Date().getFullYear()
const HOSPITAL_PREFIX = `CRMC-${CURRENT_YEAR}-`
const ACCESS_CODE_RE  = /^CRMC-\d{4}-\d{5}$/
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

function StepIndicator({ current, steps }) {
  return (
    <div className="flex items-center justify-center mb-6">
      {steps.map((s, i) => (
        <div key={s.num} className="flex items-center">
          {/* Circle */}
          <div className="flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
              s.num < current  ? 'bg-brand-500 text-white'
              : s.num === current ? 'bg-brand-500 text-white ring-4 ring-brand-100'
              : 'bg-gray-100 text-gray-400'
            }`}>
              {s.num < current ? <MdCheckCircle size={16} /> : s.num}
            </div>
            <span className={`hidden sm:block text-xs mt-1 font-medium whitespace-nowrap ${
              s.num === current ? 'text-brand-600' : 'text-gray-400'
            }`}>{s.label}</span>
          </div>
          {/* Connector — mb-4 compensates for label height on sm+ so the line
              aligns with circle centers. On mobile (label hidden) no offset. */}
          {i < steps.length - 1 && (
            <div className={`h-0.5 w-12 sm:w-16 mx-1 mb-0 sm:mb-4 transition-all ${
              s.num < current ? 'bg-brand-500' : 'bg-gray-200'
            }`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export default function Register() {
  const { t }                 = useTranslation()
  const navigate              = useNavigate()
  const { updateUser }        = useAuth()

  // Step labels — built here so they re-render on language change.
  const STEPS = [
    { num: 1, label: t('register.stepPersonal') },
    { num: 2, label: t('register.stepAccount')  },
    { num: 3, label: t('register.stepCode')     },
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
  const [hospitalVerified, setHospitalVerified] = useState(false)
  const [verifying, setVerifying]           = useState(false)
  const [loading, setLoading]               = useState(false)
  const [showPw, setShowPw]                 = useState(false)
  const [showConfirmPw, setShowConfirmPw]   = useState(false)
  const [agreedToTerms, setAgreedToTerms]   = useState(false)
  const [errors, setErrors]                 = useState({})

  const [form, setForm] = useState({
    firstName: '', middleName: '', lastName: '', suffix: '',
    email: '', password: '', confirmPassword: '',
    contactNumber: '',
    barangay: '', city: '', province: '',
    hospitalId: HOSPITAL_PREFIX,
    ...(draft?.form ?? {}),
    // Always start with empty passwords regardless of any persisted state
    password: '', confirmPassword: '',
  })

  // Persist non-sensitive form fields + current step on every change.
  useEffect(() => {
    const { password, confirmPassword, ...safe } = form
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

  const handleHospitalIdChange = (e) => {
    let val = e.target.value.toUpperCase()
    if (!val.startsWith(HOSPITAL_PREFIX)) val = HOSPITAL_PREFIX
    // Keep prefix + only digits after, max 5 digits
    const suffix = val.slice(HOSPITAL_PREFIX.length).replace(/\D/g, '').slice(0, 5)
    setForm(prev => ({ ...prev, hospitalId: HOSPITAL_PREFIX + suffix }))
    setHospitalVerified(false)
    if (errors.hospitalId) setErrors(prev => ({ ...prev, hospitalId: '' }))
  }

  const strength = getStrength(form.password, t)

  const inputCls = (field) =>
    `input ${errors[field] ? 'border-red-400 bg-red-50' : ''}`

  // ── Per-step validation ─────────────────────────────────────────────────

  const validateStep1 = () => {
    const e = {}
    if (!form.firstName.trim()) e.firstName = t('register.errors.firstNameRequired')
    else if (!NAME_RE.test(form.firstName)) e.firstName = t('register.errors.nameLettersOnly')
    if (!form.lastName.trim())  e.lastName  = t('register.errors.lastNameRequired')
    else if (!NAME_RE.test(form.lastName)) e.lastName = t('register.errors.nameLettersOnly')
    if (form.middleName && !NAME_RE.test(form.middleName)) e.middleName = t('register.errors.nameLettersOnly')

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
    if (!ACCESS_CODE_RE.test(form.hospitalId)) e.hospitalId = t('register.errors.codeFormat', { year: CURRENT_YEAR })
    else if (!hospitalVerified)                e.hospitalId = t('register.errors.codeVerifyFirst')
    if (!agreedToTerms)                        e.terms      = t('register.errors.termsRequired')
    return e
  }

  // ── Navigation ──────────────────────────────────────────────────────────

  const handleNext = () => {
    const errs = step === 1 ? validateStep1() : validateStep2()
    if (Object.keys(errs).length > 0) { setErrors(errs); return }
    setErrors({})
    setStep(s => s + 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleBack = () => {
    setErrors({})
    setStep(s => s - 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ── Hospital ID verify ──────────────────────────────────────────────────

  const handleVerify = async () => {
    if (!ACCESS_CODE_RE.test(form.hospitalId)) {
      setErrors(prev => ({ ...prev, hospitalId: t('register.errors.codeFormat', { year: CURRENT_YEAR }) }))
      return
    }
    setVerifying(true)
    try {
      const snap = await getDoc(doc(db, 'hospitalIds', form.hospitalId))
      if (!snap.exists()) {
        setErrors(prev => ({ ...prev, hospitalId: t('register.errors.codeNotFound') }))
      } else if (snap.data().status !== 'available') {
        setErrors(prev => ({ ...prev, hospitalId: t('register.errors.codeUsed') }))
      } else {
        setHospitalVerified(true)
        setErrors(prev => ({ ...prev, hospitalId: '' }))
        toast.success(t('register.toast.codeVerified'))
      }
    } catch {
      toast.error(t('register.errors.verifyFailed'))
    } finally {
      setVerifying(false)
    }
  }

  // ── Submit ──────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    const errs = validateStep3()
    if (Object.keys(errs).length > 0) { setErrors(errs); return }

    setLoading(true)
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email.trim(), form.password)
      const uid  = cred.user.uid
      const name = [form.firstName, form.middleName, form.lastName, form.suffix]
        .map(s => s.trim()).filter(Boolean).join(' ')
      const address = [form.barangay, form.city, form.province]
        .map(s => s.trim()).filter(Boolean).join(', ')
      const patientId = `PAT-${Date.now().toString().slice(-6)}`

      const userData = {
        name, email: form.email.trim(), role: 'patient',
        contact: form.contactNumber, address,
        barangay: form.barangay.trim(),
        city:     form.city.trim(),
        province: form.province.trim(),
        suffix:   form.suffix || null,
        hospitalId: form.hospitalId, patientId,
        agencyId: null, rank: null, cooldown: 0,
        deletion: false, active: true,
        createdAt: serverTimestamp(),
      }

      await setDoc(doc(db, 'users', uid), userData)

      await updateDoc(doc(db, 'hospitalIds', form.hospitalId), {
        status: 'used', usedBy: name, patId: uid,
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString(),
      })

      // Immediately sync role into AuthContext so PrivateRoute sees 'patient'
      // before onAuthStateChanged re-reads the doc (timing fix)
      updateUser({ uid, ...userData })

      // Successful registration — discard the draft so a future visit to
      // /register doesn't pre-fill someone else's data.
      try { sessionStorage.removeItem(DRAFT_KEY) } catch {}

      toast.success(t('register.toast.welcome', { name: form.firstName }))
      navigate('/patient/dashboard')
    } catch (err) {
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-6">
          <Link to="/" className="text-sm text-gray-400 hover:text-gray-600">← {t('register.backHome')}</Link>
        </div>

        <div className="card p-6">
          {/* Header */}
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 bg-brand-500 rounded-lg flex items-center justify-center">
              <MdShield size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">{t('register.title')}</h1>
              <p className="text-xs text-gray-500">{t('register.subtitle')}</p>
            </div>
          </div>

          {/* Step indicator */}
          <StepIndicator current={step} steps={STEPS} />

          {/* ── Step 1 — Personal Info ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="mb-2">
                <p className="text-sm font-semibold text-gray-800">{t('register.step1.sectionTitle')}</p>
                <p className="text-xs text-gray-400 mt-0.5">{t('register.step1.sectionDesc')}</p>
              </div>

              {/* Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">{t('register.step1.firstName')} <span className="text-red-400">*</span></label>
                  <input className={inputCls('firstName')} placeholder="Juan"
                    value={form.firstName} onChange={setName('firstName')}
                    autoComplete="given-name" autoCapitalize="words" maxLength={50} />
                  <FieldError msg={errors.firstName} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">{t('register.step1.lastName')} <span className="text-red-400">*</span></label>
                  <input className={inputCls('lastName')} placeholder="Dela Cruz"
                    value={form.lastName} onChange={setName('lastName')}
                    autoComplete="family-name" autoCapitalize="words" maxLength={50} />
                  <FieldError msg={errors.lastName} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">{t('register.step1.middleName')} <span className="text-gray-400 font-normal">{t('register.step1.optional')}</span></label>
                  <input className={inputCls('middleName')} placeholder="Santos"
                    value={form.middleName} onChange={setName('middleName')}
                    autoComplete="additional-name" autoCapitalize="words" maxLength={50} />
                  <FieldError msg={errors.middleName} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">{t('register.step1.suffix')}</label>
                  <select className="input" value={form.suffix} onChange={set('suffix')}>
                    {SUFFIXES.map(s => <option key={s} value={s}>{s || t('register.step1.suffixNone')}</option>)}
                  </select>
                </div>
              </div>

              {/* Contact */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">{t('register.step1.contactNumber')} <span className="text-red-400">*</span></label>
                <input className={inputCls('contactNumber')} placeholder="09171234567"
                  inputMode="numeric" autoComplete="tel" maxLength={11}
                  value={form.contactNumber} onChange={setPhone} />
                <FieldError msg={errors.contactNumber} />
                {!errors.contactNumber && (
                  <p className="text-xs text-gray-400 mt-0.5">{t('register.step1.contactHint')}</p>
                )}
              </div>

              {/* Address */}
              <div>
                <p className="text-xs font-medium text-gray-700 mb-1">{t('register.step1.addressLabel')} <span className="text-red-400">*</span></p>
                <p className="text-xs text-gray-400 mb-2">{t('register.step1.addressHint')}</p>
                <div className="space-y-2">
                  <div>
                    <input className={inputCls('barangay')} placeholder={t('register.step1.barangay')}
                      value={form.barangay} onChange={set('barangay')}
                      autoComplete="address-line1" autoCapitalize="words" maxLength={80} />
                    <FieldError msg={errors.barangay} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <input className={inputCls('city')} placeholder={t('register.step1.city')}
                        value={form.city} onChange={set('city')}
                        autoComplete="address-level2" autoCapitalize="words" maxLength={60} />
                      <FieldError msg={errors.city} />
                    </div>
                    <div>
                      <input className={inputCls('province')} placeholder={t('register.step1.province')}
                        value={form.province} onChange={set('province')}
                        autoComplete="address-level1" autoCapitalize="words" maxLength={60} />
                      <FieldError msg={errors.province} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2 — Account Setup ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="mb-2">
                <p className="text-sm font-semibold text-gray-800">{t('register.step2.sectionTitle')}</p>
                <p className="text-xs text-gray-400 mt-0.5">{t('register.step2.sectionDesc')}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">{t('register.step2.email')} <span className="text-red-400">*</span></label>
                <input type="email" className={inputCls('email')} placeholder="juan@gmail.com"
                  inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
                  value={form.email} onChange={set('email')} />
                <FieldError msg={errors.email} />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">{t('register.step2.password')} <span className="text-red-400">*</span></label>
                <div className="relative">
                  <input type={showPw ? 'text' : 'password'} className={`${inputCls('password')} pr-9`}
                    placeholder={t('register.step2.passwordPlaceholder')}
                    autoComplete="new-password"
                    value={form.password} onChange={set('password')} />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
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
                <label className="block text-xs font-medium text-gray-700 mb-1">{t('register.step2.confirmPassword')} <span className="text-red-400">*</span></label>
                <div className="relative">
                  <input type={showConfirmPw ? 'text' : 'password'} className={`${inputCls('confirmPassword')} pr-9`}
                    placeholder={t('register.step2.confirmPlaceholder')}
                    autoComplete="new-password"
                    value={form.confirmPassword} onChange={set('confirmPassword')} />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                    onClick={() => setShowConfirmPw(p => !p)}>
                    {showConfirmPw ? <MdVisibilityOff size={16} /> : <MdVisibility size={16} />}
                  </button>
                </div>
                <FieldError msg={errors.confirmPassword} />
              </div>
            </div>
          )}

          {/* ── Step 3 — Access Code + Terms ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="mb-2">
                <p className="text-sm font-semibold text-gray-800">{t('register.step3.sectionTitle')}</p>
                <p className="text-xs text-gray-400 mt-0.5">{t('register.step3.sectionDesc')}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">{t('register.step3.accessCode')} <span className="text-red-400">*</span></label>
                <div className="flex gap-2">
                  <input
                    className={`${inputCls('hospitalId')} flex-1 font-mono ${hospitalVerified ? 'border-green-400 bg-green-50' : ''}`}
                    placeholder={`CRMC-${CURRENT_YEAR}-00001`}
                    value={form.hospitalId}
                    onChange={handleHospitalIdChange}
                    inputMode="numeric"
                    autoCapitalize="characters"
                    autoComplete="off"
                    disabled={hospitalVerified}
                  />
                  {hospitalVerified ? (
                    <div className="flex items-center gap-2 px-2 flex-shrink-0">
                      <span className="flex items-center gap-1 text-green-600 text-sm font-medium">
                        <MdVerified size={18} /> {t('register.step3.verified')}
                      </span>
                      <button
                        type="button"
                        className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
                        onClick={() => setHospitalVerified(false)}>
                        {t('register.step3.edit')}
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="btn-primary px-4 flex-shrink-0 flex items-center justify-center min-w-[80px]"
                      onClick={handleVerify} disabled={verifying}>
                      {verifying
                        ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : t('register.step3.verifyBtn')}
                    </button>
                  )}
                </div>
                <FieldError msg={errors.hospitalId} />
                {!errors.hospitalId && !hospitalVerified && (
                  <p className="text-xs text-gray-400 mt-1">{t('register.step3.accessCodeHint')}</p>
                )}
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                <p className="text-xs text-blue-700">
                  {t('register.step3.noCodeHint')}
                </p>
              </div>

              {/* Terms */}
              <div className={`border rounded-xl p-3 transition-colors ${errors.terms ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-gray-50'}`}>
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input type="checkbox" className="w-4 h-4 accent-brand-500 flex-shrink-0 mt-0.5"
                    checked={agreedToTerms}
                    onChange={e => { setAgreedToTerms(e.target.checked); if (errors.terms) setErrors(p => ({ ...p, terms: '' })) }} />
                  <span className="text-xs text-gray-600 leading-relaxed">
                    {t('register.step3.termsAgree')}
                  </span>
                </label>
                <FieldError msg={errors.terms} />
              </div>
            </div>
          )}

          {/* ── Navigation buttons ── Primary always flex-1 so the page's
              main action keeps the same visual weight across all 3 steps. */}
          <div className="flex gap-3 mt-6">
            {step > 1 && (
              <button type="button" className="btn-secondary flex items-center justify-center gap-1.5"
                onClick={handleBack} disabled={loading}>
                <MdArrowBack size={16} /> {t('register.back')}
              </button>
            )}
            {step < 3 ? (
              <button type="button" className="btn-primary flex-1 flex items-center justify-center gap-1.5"
                onClick={handleNext}>
                {t('register.next')} <MdArrowForward size={16} />
              </button>
            ) : (
              <button type="button" className="btn-primary flex-1 flex items-center justify-center gap-1.5"
                onClick={handleSubmit} disabled={loading}>
                {loading ? t('register.creating') : `${t('register.create')} →`}
              </button>
            )}
          </div>

          <p className="text-center text-xs text-gray-500 mt-4">
            {t('register.haveAccount')}{' '}
            <Link to="/login" className="text-brand-500 hover:text-brand-600 font-medium">{t('register.signIn')}</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
