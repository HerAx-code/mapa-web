import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  MdShield, MdVerified, MdVisibility, MdVisibilityOff,
  MdCheckCircle, MdArrowForward, MdArrowBack, MdCancel,
} from 'react-icons/md'
import { createUserWithEmailAndPassword, fetchSignInMethodsForEmail, deleteUser } from 'firebase/auth'
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, runTransaction } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { useTranslation, Trans } from 'react-i18next'
import ProfileModals from '../../components/ProfileModals'
import { BARMM_PROVINCES, BARMM_MUNICIPALITIES } from '../../utils/barmm'
import { BARANGAYS } from '../../utils/barmm-barangays'
import toast from 'react-hot-toast'

const CURRENT_YEAR        = new Date().getFullYear()
const HOSPITAL_PREFIX     = `CRMC-${CURRENT_YEAR}-`
const ACCESS_CODE_RE      = /^CRMC-\d{4}-\d{5}$/
// Match any CRMC-YYYY- prefix the patient types — codes issued in a prior
// calendar year must remain enterable.
const ACCESS_CODE_PREFIX_RE = /^CRMC-(\d{4})-/
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
  return (
    <div className="flex items-center justify-center mb-6">
      {steps.map((s, i) => {
        // Past steps are clickable for in-place edits; current and future
        // steps are not (future steps would skip validation).
        const canJump = s.num < current
        const CircleWrap = canJump ? 'button' : 'div'
        return (
          <div key={s.num} className="flex items-center">
            {/* Circle */}
            <CircleWrap
              type={canJump ? 'button' : undefined}
              onClick={canJump ? () => onJump?.(s.num) : undefined}
              className={`flex flex-col items-center ${canJump ? 'cursor-pointer group' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                s.num < current  ? 'bg-brand-500 text-white group-hover:bg-brand-600'
                : s.num === current ? 'bg-brand-500 text-white ring-4 ring-brand-100'
                : 'bg-gray-100 text-gray-400'
              }`}>
                {s.num < current ? <MdCheckCircle size={16} /> : s.num}
              </div>
              <span className={`hidden sm:block text-xs mt-1 font-medium whitespace-nowrap ${
                s.num === current ? 'text-brand-600'
                : canJump        ? 'text-gray-500 group-hover:text-brand-600'
                : 'text-gray-400'
              }`}>{s.label}</span>
            </CircleWrap>
            {/* Connector — mb-4 compensates for label height on sm+ so the line
                aligns with circle centers. On mobile (label hidden) no offset. */}
            {i < steps.length - 1 && (
              <div className={`h-0.5 w-12 sm:w-16 mx-1 mb-0 sm:mb-4 transition-all ${
                s.num < current ? 'bg-brand-500' : 'bg-gray-200'
              }`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export default function Register() {
  const { t }                 = useTranslation()
  const navigate              = useNavigate()
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
  // Open ProfileModals' Privacy Notice (SettingsModal) from the terms
  // checkbox so the patient can actually read what they're agreeing to.
  const [showPrivacy, setShowPrivacy]       = useState(false)

  const [form, setForm] = useState({
    firstName: '', middleName: '', lastName: '', suffix: '',
    email: '',
    contactNumber: '',
    barangay: '', city: '', province: '',
    hospitalId: HOSPITAL_PREFIX,
    ...(draft?.form ?? {}),
    // Always start with empty passwords regardless of any persisted state
    password: '', confirmPassword: '',
  })

  // BARMM address is a cascading Province -> City/Municipality dropdown
  // (barangay stays free text). "Other (not listed)" reveals a free-text
  // field so a value outside the BARMM list (Special Geographic Area,
  // Region XII origin, etc.) is still enterable. These flags track whether
  // the user is in free-text mode; they're derived from any restored draft.
  const draftProvince = draft?.form?.province ?? ''
  const draftCity     = draft?.form?.city ?? ''
  const [provinceOther, setProvinceOther] = useState(
    !!draftProvince && !BARMM_PROVINCES.includes(draftProvince)
  )
  const [cityOther, setCityOther] = useState(
    !!draftCity && !(BARMM_MUNICIPALITIES[draftProvince] ?? []).includes(draftCity)
  )
  // Barangay is a dropdown only for covered municipalities (Cotabato City +
  // Maguindanao); everywhere else it stays free text. This flag tracks the
  // "Other" free-text mode within a covered municipality.
  const [barangayOther, setBarangayOther] = useState(() => {
    const list = BARANGAYS[draftProvince]?.[draftCity]
    return !!(draft?.form?.barangay) && !!list && !list.includes(draft.form.barangay)
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

  // Province select: picking a province resets the dependent city. "Other"
  // switches both province and city to free-text entry.
  const onProvinceSelect = (e) => {
    const v = e.target.value
    setBarangayOther(false)
    if (v === '__other__') {
      setProvinceOther(true); setCityOther(true)
      setForm(prev => ({ ...prev, province: '', city: '', barangay: '' }))
    } else {
      setProvinceOther(false); setCityOther(false)
      setForm(prev => ({ ...prev, province: v, city: '', barangay: '' }))
    }
    setErrors(prev => ({ ...prev, province: '', city: '', barangay: '' }))
  }

  // City/municipality select within a chosen BARMM province. Changing it
  // resets the dependent barangay.
  const onCitySelect = (e) => {
    const v = e.target.value
    setBarangayOther(false)
    if (v === '__other__') {
      setCityOther(true)
      setForm(prev => ({ ...prev, city: '', barangay: '' }))
    } else {
      setCityOther(false)
      setForm(prev => ({ ...prev, city: v, barangay: '' }))
    }
    setErrors(prev => ({ ...prev, city: '', barangay: '' }))
  }

  // Barangay select — only rendered for covered municipalities.
  const onBarangaySelect = (e) => {
    const v = e.target.value
    if (v === '__other__') {
      setBarangayOther(true)
      setForm(prev => ({ ...prev, barangay: '' }))
    } else {
      setBarangayOther(false)
      setForm(prev => ({ ...prev, barangay: v }))
    }
    if (errors.barangay) setErrors(prev => ({ ...prev, barangay: '' }))
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

  const handleHospitalIdChange = (e) => {
    const val = e.target.value.toUpperCase()
    // Honor whatever year the patient typed — codes from prior years are
    // still valid. Fall back to the current-year prefix only if the input
    // doesn't yet contain a parseable CRMC-YYYY- prefix.
    const prefixMatch = val.match(ACCESS_CODE_PREFIX_RE)
    const prefix      = prefixMatch ? `CRMC-${prefixMatch[1]}-` : HOSPITAL_PREFIX
    const suffix      = val.slice(prefix.length).replace(/\D/g, '').slice(0, 5)
    setForm(prev => ({ ...prev, hospitalId: prefix + suffix }))
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

  // ── Hospital ID verify ──────────────────────────────────────────────────

  // #17 — Per-session rate limit on Verify. Without throttle, a script
  // could iterate CRMC-YYYY-00001..99999 to enumerate which codes are
  // claimed (and by side effect, leak the names of registered patients).
  // This is a SOFT layer: a determined attacker can clear sessionStorage
  // or open many tabs. A proper fix would be a Cloud Function with per-IP
  // throttle + reCAPTCHA v3; deferred until pilot abuse signals show up.
  const VERIFY_BUCKET_KEY = 'mapa_verify_attempts'
  const VERIFY_WINDOW_MS  = 60 * 60 * 1000   // 1 hour rolling window
  const VERIFY_MAX        = 10                // attempts/window
  const recordVerifyAttempt = () => {
    try {
      const now = Date.now()
      const raw = sessionStorage.getItem(VERIFY_BUCKET_KEY)
      const all = raw ? JSON.parse(raw) : []
      const recent = all.filter(t => now - t < VERIFY_WINDOW_MS)
      recent.push(now)
      sessionStorage.setItem(VERIFY_BUCKET_KEY, JSON.stringify(recent))
      return recent.length
    } catch { return 0 }
  }
  const countRecentVerifyAttempts = () => {
    try {
      const raw = sessionStorage.getItem(VERIFY_BUCKET_KEY)
      if (!raw) return 0
      const now = Date.now()
      return JSON.parse(raw).filter(t => now - t < VERIFY_WINDOW_MS).length
    } catch { return 0 }
  }

  const handleVerify = async () => {
    if (!ACCESS_CODE_RE.test(form.hospitalId)) {
      setErrors(prev => ({ ...prev, hospitalId: t('register.errors.codeFormat', { year: CURRENT_YEAR }) }))
      return
    }
    if (countRecentVerifyAttempts() >= VERIFY_MAX) {
      setErrors(prev => ({ ...prev, hospitalId: t('register.errors.verifyRateLimit') }))
      return
    }
    recordVerifyAttempt()
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
        hospitalId: form.hospitalId, patientId,
        agencyId: null, rank: null, cooldown: 0,
        deletion: false, active: true,
        createdAt: serverTimestamp(),
      }

      // #2 — Transactional hospital ID claim: re-read status INSIDE the
      // transaction and abort if another patient won the race between
      // the patient's Verify click and Submit. Prevents a second patient's
      // claim from silently overwriting the first patient's record.
      try {
        await runTransaction(db, async (tx) => {
          const hidRef  = doc(db, 'hospitalIds', form.hospitalId)
          const hidSnap = await tx.get(hidRef)
          if (!hidSnap.exists()) throw new Error('CODE_NOT_FOUND')
          if (hidSnap.data().status !== 'available') throw new Error('CODE_USED')
          tx.set(doc(db, 'users', uid), userData)
          tx.update(hidRef, {
            status: 'used', usedBy: name, patId: uid,
            date: new Date().toLocaleDateString(),
            time: new Date().toLocaleTimeString(),
          })
        })
      } catch (txErr) {
        // #1 — Roll back the orphan Auth account so the patient can retry
        // (e.g. with a different access code) without their email being
        // permanently "already in use" with no profile attached.
        try { await deleteUser(createdAuthUser) } catch {}
        createdAuthUser = null
        if (String(txErr.message) === 'CODE_USED') {
          setErrors({ hospitalId: t('register.errors.codeUsed') })
          setHospitalVerified(false)
          setStep(3)
          return
        }
        if (String(txErr.message) === 'CODE_NOT_FOUND') {
          setErrors({ hospitalId: t('register.errors.codeNotFound') })
          setHospitalVerified(false)
          setStep(3)
          return
        }
        throw txErr
      }

      // Immediately sync role into AuthContext so PrivateRoute sees 'patient'
      // before onAuthStateChanged re-reads the doc (timing fix)
      updateUser({ uid, ...userData })

      // Successful registration — discard the draft so a future visit to
      // /register doesn't pre-fill someone else's data.
      try { sessionStorage.removeItem(DRAFT_KEY) } catch {}

      toast.success(t('register.toast.welcome', { name: form.firstName }))
      navigate('/patient/request')
    } catch (err) {
      // #1 — If Auth account was created before this throw and not already
      // rolled back inside the transaction handler above, drop it so the
      // patient can retry registration cleanly.
      if (createdAuthUser) {
        try { await deleteUser(createdAuthUser) } catch {}
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md sm:max-w-lg">
        {!isStandalone && (
          <div className="flex items-center gap-2 mb-6">
            <Link to="/" className="text-sm text-gray-400 hover:text-gray-600">← {t('register.backHome')}</Link>
          </div>
        )}

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

          {/* Step indicator — past steps are clickable so the patient can
              edit a typo without manually clicking Back N times. */}
          <StepIndicator current={step} steps={STEPS} onJump={(n) => { setErrors({}); setStep(n) }} />

          {/* All step content + nav buttons live inside one <form> so the
              keyboard's Go / Done key triggers the appropriate action.
              On Step 3, an unverified code routes Enter to Verify first
              so the patient doesn't have to switch hands to a tiny button. */}
          <form onSubmit={(e) => {
            e.preventDefault()
            if (step < 3) handleNext()
            else if (!hospitalVerified) handleVerify()
            else handleSubmit()
          }}>

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
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('register.step1.firstName')} <span className="text-red-400">*</span></label>
                  <input data-field="firstName" className={inputCls('firstName')} placeholder="Juan"
                    value={form.firstName} onChange={setName('firstName')}
                    autoComplete="given-name" autoCapitalize="words" maxLength={50} />
                  <FieldError msg={errors.firstName} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('register.step1.lastName')} <span className="text-red-400">*</span></label>
                  <input data-field="lastName" className={inputCls('lastName')} placeholder="Dela Cruz"
                    value={form.lastName} onChange={setName('lastName')}
                    autoComplete="family-name" autoCapitalize="words" maxLength={50} />
                  <FieldError msg={errors.lastName} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('register.step1.middleName')} <span className="text-gray-400 font-normal">{t('register.step1.optional')}</span></label>
                  <input data-field="middleName" className={inputCls('middleName')} placeholder="Santos"
                    value={form.middleName} onChange={setName('middleName')}
                    autoComplete="additional-name" autoCapitalize="words" maxLength={50} />
                  <FieldError msg={errors.middleName} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('register.step1.suffix')}</label>
                  <select className="input" value={form.suffix} onChange={set('suffix')}>
                    {SUFFIXES.map(s => <option key={s} value={s}>{s || `— ${t('register.step1.suffixNone')} —`}</option>)}
                  </select>
                </div>
              </div>

              {/* Contact */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('register.step1.contactNumber')} <span className="text-red-400">*</span></label>
                <input data-field="contactNumber" className={inputCls('contactNumber')} placeholder="09171234567"
                  inputMode="numeric" autoComplete="tel" maxLength={11}
                  value={form.contactNumber} onChange={setPhone} />
                <FieldError msg={errors.contactNumber} />
                {!errors.contactNumber && (
                  <p className="text-xs text-gray-400 mt-0.5">{t('register.step1.contactHint')}</p>
                )}
              </div>

              {/* Address — cascading BARMM Province -> City/Municipality.
                  Barangay stays free text (BARMM has ~2,600 barangays). The
                  "Other (not listed)" option reveals a free-text fallback so
                  origins outside the BARMM list stay enterable. */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">{t('register.step1.addressLabel')} <span className="text-red-400">*</span></p>
                <p className="text-xs text-gray-400 mb-2">{t('register.step1.addressHint')}</p>
                <div className="space-y-2">
                  {/* Province */}
                  <div>
                    <select
                      data-field="province"
                      className={`${inputCls('province')} ${(!provinceOther && !form.province) ? 'text-gray-400' : ''}`}
                      value={provinceOther ? '__other__' : form.province}
                      onChange={onProvinceSelect}>
                      <option value="">{t('register.step1.selectProvince')}</option>
                      {BARMM_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                      <option value="__other__">{t('register.step1.otherNotListed')}</option>
                    </select>
                    {provinceOther && (
                      <input className={`${inputCls('province')} mt-2`} placeholder={t('register.step1.otherProvince')}
                        value={form.province} onChange={set('province')}
                        autoCapitalize="words" maxLength={60} />
                    )}
                    <FieldError msg={errors.province} />
                  </div>

                  {/* City / Municipality */}
                  <div>
                    {provinceOther ? (
                      <input data-field="city" className={inputCls('city')} placeholder={t('register.step1.otherCity')}
                        value={form.city} onChange={set('city')}
                        autoCapitalize="words" maxLength={60} />
                    ) : (
                      <>
                        <select
                          data-field="city"
                          className={`${inputCls('city')} ${(!cityOther && !form.city) ? 'text-gray-400' : ''}`}
                          value={cityOther ? '__other__' : form.city}
                          onChange={onCitySelect}
                          disabled={!form.province && !cityOther}>
                          <option value="">{t('register.step1.selectCity')}</option>
                          {(BARMM_MUNICIPALITIES[form.province] ?? []).map(c => <option key={c} value={c}>{c}</option>)}
                          <option value="__other__">{t('register.step1.otherNotListed')}</option>
                        </select>
                        {cityOther && (
                          <input className={`${inputCls('city')} mt-2`} placeholder={t('register.step1.otherCity')}
                            value={form.city} onChange={set('city')}
                            autoCapitalize="words" maxLength={60} />
                        )}
                      </>
                    )}
                    <FieldError msg={errors.city} />
                  </div>

                  {/* Barangay — dropdown for covered municipalities
                      (Cotabato City + Maguindanao); free text elsewhere.
                      "Other (not listed)" reveals a free-text fallback. */}
                  <div>
                    {(() => {
                      const bgyList = (!provinceOther && !cityOther)
                        ? BARANGAYS[form.province]?.[form.city]
                        : null
                      if (!bgyList) {
                        return (
                          <input data-field="barangay" className={inputCls('barangay')} placeholder={t('register.step1.barangay')}
                            value={form.barangay} onChange={set('barangay')}
                            autoComplete="address-line1" autoCapitalize="words" maxLength={80} />
                        )
                      }
                      return (
                        <>
                          <select
                            data-field="barangay"
                            className={`${inputCls('barangay')} ${(!barangayOther && !form.barangay) ? 'text-gray-400' : ''}`}
                            value={barangayOther ? '__other__' : form.barangay}
                            onChange={onBarangaySelect}>
                            <option value="">{t('register.step1.barangay')}</option>
                            {bgyList.map(b => <option key={b} value={b}>{b}</option>)}
                            <option value="__other__">{t('register.step1.otherNotListed')}</option>
                          </select>
                          {barangayOther && (
                            <input className={`${inputCls('barangay')} mt-2`} placeholder={t('register.step1.barangay')}
                              value={form.barangay} onChange={set('barangay')}
                              autoCapitalize="words" maxLength={80} />
                          )}
                        </>
                      )
                    })()}
                    <FieldError msg={errors.barangay} />
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
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('register.step2.email')} <span className="text-red-400">*</span></label>
                <input type="email" data-field="email" className={inputCls('email')} placeholder="juan@gmail.com"
                  inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
                  value={form.email} onChange={set('email')} onBlur={checkEmailAvailable} />
                <FieldError msg={errors.email} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('register.step2.password')} <span className="text-red-400">*</span></label>
                <div className="relative">
                  <input type={showPw ? 'text' : 'password'} data-field="password" className={`${inputCls('password')} pr-10`}
                    placeholder={t('register.step2.passwordPlaceholder')}
                    autoComplete="new-password"
                    value={form.password} onChange={set('password')} />
                  <button type="button"
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md"
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
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('register.step2.confirmPassword')} <span className="text-red-400">*</span></label>
                <div className="relative">
                  <input type={showConfirmPw ? 'text' : 'password'} data-field="confirmPassword" className={`${inputCls('confirmPassword')} pr-16`}
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
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md"
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
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('register.step3.accessCode')} <span className="text-red-400">*</span></label>
                {/* Stack vertically on mobile so the input has room to show
                    "CRMC-YYYY-NNNNN" without truncation. Verify uses the
                    secondary button style — it's a sub-action, not the page
                    goal (Create Account is). */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    data-field="hospitalId"
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
                    <button type="button"
                      className="btn-secondary px-4 sm:flex-shrink-0 flex items-center justify-center min-h-[40px] sm:min-w-[80px]"
                      onClick={handleVerify} disabled={verifying}>
                      {verifying
                        ? <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                        : t('register.step3.verifyBtn')}
                    </button>
                  )}
                </div>
                <FieldError msg={errors.hospitalId} />
                {!errors.hospitalId && !hospitalVerified && (
                  <p className="text-xs text-gray-400 mt-1">{t('register.step3.accessCodeHint')}</p>
                )}
                {/* If the code shows as already used, give the patient an
                    actionable recovery path — they may be a real holder
                    whose code was claimed by someone else. Without this
                    fallback, the patient is stuck with no way forward. */}
                {errors.hospitalId === t('register.errors.codeUsed') && (
                  <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <p className="text-xs text-amber-700 mb-2">
                      {t('register.step3.codeUsedRecovery')}
                    </p>
                    <a href={`mailto:mss@crmc.gov.ph?subject=${encodeURIComponent('Report: access code already used')}&body=${encodeURIComponent(`I tried to register with access code ${form.hospitalId} but it shows as already used. I am the rightful holder.`)}`}
                      className="text-xs text-amber-700 font-semibold underline underline-offset-2">
                      {t('register.step3.codeUsedRecoveryAction')} →
                    </a>
                  </div>
                )}
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                <p className="text-xs text-blue-700">
                  {t('register.step3.noCodeHint')}
                </p>
              </div>

              {/* Review summary — collapsed by default. Lets the patient
                  catch typos in email / phone / name before submitting. */}
              <details className="border border-gray-100 rounded-xl overflow-hidden group">
                <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-between list-none">
                  <span>{t('register.step3.reviewToggle')}</span>
                  <MdArrowForward size={16} className="text-gray-400 transition-transform group-open:rotate-90" />
                </summary>
                <dl className="px-4 pb-3 pt-1 space-y-2 border-t border-gray-50">
                  <div>
                    <dt className="text-xs text-gray-400">{t('register.step1.firstName')}</dt>
                    <dd className="text-sm text-gray-800">
                      {[form.firstName, form.middleName, form.lastName, form.suffix].filter(Boolean).join(' ') || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-400">{t('register.step2.email')}</dt>
                    <dd className="text-sm text-gray-800 break-all">{form.email || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-400">{t('register.step1.contactNumber')}</dt>
                    <dd className="text-sm text-gray-800">{form.contactNumber || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-400">{t('register.step1.addressLabel')}</dt>
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
                        onClick={(e) => { e.preventDefault(); setShowPrivacy(true) }} />
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

          <p className="text-center text-xs text-gray-500 mt-4">
            {t('register.haveAccount')}{' '}
            <Link to="/login" className="text-brand-500 hover:text-brand-600 font-medium">{t('register.signIn')}</Link>
          </p>
        </div>
      </div>

      {/* Privacy Notice modal — reuses ProfileModals' SettingsModal which
          renders the full RA 10173 privacy notice. */}
      <ProfileModals
        activeModal={showPrivacy ? 'settings' : null}
        onClose={() => setShowPrivacy(false)}
        onSetModal={() => {}}
      />
    </div>
  )
}
