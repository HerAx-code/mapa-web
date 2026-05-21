import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  MdShield, MdVerified, MdVisibility, MdVisibilityOff,
  MdCheckCircle, MdArrowForward, MdArrowBack,
} from 'react-icons/md'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import toast from 'react-hot-toast'

const CURRENT_YEAR    = new Date().getFullYear()
const HOSPITAL_PREFIX = `CRMC-${CURRENT_YEAR}-`
const ACCESS_CODE_RE  = /^CRMC-\d{4}-\d{5}$/
const EMAIL_RE        = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const NAME_RE         = /^[A-Za-zÑñ\s\-'.,]*$/
const SUFFIXES        = ['', 'Jr.', 'Sr.', 'II', 'III', 'IV', 'V']

// Sanitizers
const sanitizeName  = (val) => val.replace(/[^A-Za-zÑñ\s\-'.,]/g, '').slice(0, 50)
const sanitizePhone = (val) => val.replace(/\D/g, '').slice(0, 11)

// Validators
const isStrongPassword = (pw) => {
  if (pw.length < 8) return false
  const types = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter(r => r.test(pw)).length
  return types >= 2
}

const getStrength = (pw) => {
  if (!pw) return null
  if (pw.length < 6) return { level: 1, label: 'Too short',         color: 'bg-red-400',   width: 'w-1/4' }
  const types = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter(r => r.test(pw)).length
  if (pw.length >= 8 && types >= 3) return { level: 4, label: 'Strong', color: 'bg-green-500', width: 'w-full' }
  if (pw.length >= 8 && types >= 2) return { level: 3, label: 'Good',   color: 'bg-amber-400', width: 'w-2/3'  }
  if (pw.length >= 6 && types >= 2) return { level: 2, label: 'Weak — needs 8+ chars', color: 'bg-red-400', width: 'w-1/3' }
  return { level: 2, label: 'Weak — add letters & numbers', color: 'bg-red-400', width: 'w-1/3' }
}

function FieldError({ msg }) {
  if (!msg) return null
  return <p className="text-xs text-red-500 mt-1">{msg}</p>
}

// ── Step indicator ────────────────────────────────────────────────────────

const STEPS = [
  { num: 1, label: 'Personal Info'  },
  { num: 2, label: 'Account Setup'  },
  { num: 3, label: 'Access Code'    },
]

function StepIndicator({ current }) {
  return (
    <div className="flex items-center justify-center mb-6">
      {STEPS.map((s, i) => (
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
            <span className={`text-xs mt-1 font-medium whitespace-nowrap ${
              s.num === current ? 'text-brand-600' : 'text-gray-400'
            }`}>{s.label}</span>
          </div>
          {/* Connector */}
          {i < STEPS.length - 1 && (
            <div className={`h-0.5 w-12 sm:w-16 mx-1 mb-4 transition-all ${
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
  const navigate              = useNavigate()
  const { updateUser }        = useAuth()

  const [step, setStep]                     = useState(1)
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
  })

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

  const strength = getStrength(form.password)

  const inputCls = (field) =>
    `input ${errors[field] ? 'border-red-400 bg-red-50' : ''}`

  // ── Per-step validation ─────────────────────────────────────────────────

  const validateStep1 = () => {
    const e = {}
    if (!form.firstName.trim()) e.firstName = 'First name is required.'
    else if (!NAME_RE.test(form.firstName)) e.firstName = 'Letters only.'
    if (!form.lastName.trim())  e.lastName  = 'Last name is required.'
    else if (!NAME_RE.test(form.lastName)) e.lastName = 'Letters only.'
    if (form.middleName && !NAME_RE.test(form.middleName)) e.middleName = 'Letters only.'

    if (!form.contactNumber) {
      e.contactNumber = 'Contact number is required.'
    } else if (!/^09\d{9}$/.test(form.contactNumber)) {
      e.contactNumber = 'Enter a valid 11-digit Philippine mobile number (e.g. 09171234567).'
    }
    if (!form.barangay.trim()) e.barangay = 'Barangay is required.'
    if (!form.city.trim())     e.city     = 'City/Municipality is required.'
    if (!form.province.trim()) e.province = 'Province is required.'
    return e
  }

  const validateStep2 = () => {
    const e = {}
    if (!form.email.trim()) {
      e.email = 'Email address is required.'
    } else if (!EMAIL_RE.test(form.email.trim())) {
      e.email = 'Please enter a valid email address.'
    }
    if (!isStrongPassword(form.password)) {
      e.password = 'Password must be at least 8 characters and include letters and numbers.'
    }
    if (form.password !== form.confirmPassword) {
      e.confirmPassword = 'Passwords do not match.'
    }
    return e
  }

  const validateStep3 = () => {
    const e = {}
    if (!ACCESS_CODE_RE.test(form.hospitalId)) e.hospitalId = `Format: CRMC-${CURRENT_YEAR}-00001`
    else if (!hospitalVerified)                e.hospitalId = 'Please verify your Patient Access Code first.'
    if (!agreedToTerms)                        e.terms      = 'You must accept the Privacy Notice and Terms of Use.'
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
      setErrors(prev => ({ ...prev, hospitalId: `Format: CRMC-${CURRENT_YEAR}-00001` }))
      return
    }
    setVerifying(true)
    try {
      const snap = await getDoc(doc(db, 'hospitalIds', form.hospitalId))
      if (!snap.exists()) {
        setErrors(prev => ({ ...prev, hospitalId: 'Access code not found. Please check and try again.' }))
      } else if (snap.data().status !== 'available') {
        setErrors(prev => ({ ...prev, hospitalId: 'This access code has already been used.' }))
      } else {
        setHospitalVerified(true)
        setErrors(prev => ({ ...prev, hospitalId: '' }))
        toast.success('Access code verified!')
      }
    } catch {
      toast.error('Verification failed. Please try again.')
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

      toast.success(`Welcome, ${form.firstName}! Your account has been created.`)
      navigate('/patient/dashboard')
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        setErrors({ email: 'This email is already registered.' })
        setStep(2)
      } else if (err.code === 'auth/weak-password') {
        setErrors({ password: 'Password is too weak. Please choose a stronger one.' })
        setStep(2)
      } else {
        toast.error(err.message || 'Registration failed.')
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
          <Link to="/" className="text-sm text-gray-400 hover:text-gray-600">← Back to Home</Link>
        </div>

        <div className="card p-6">
          {/* Header */}
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 bg-brand-500 rounded-lg flex items-center justify-center">
              <MdShield size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Apply for Patient Account</h1>
              <p className="text-xs text-gray-500">Create an account to apply for medical assistance.</p>
            </div>
          </div>

          {/* Step indicator */}
          <StepIndicator current={step} />

          {/* ── Step 1 — Personal Info ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="mb-2">
                <p className="text-sm font-semibold text-gray-800">Personal Information</p>
                <p className="text-xs text-gray-400 mt-0.5">Enter your name and contact details as they appear on your official ID.</p>
              </div>

              {/* Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">First Name <span className="text-red-400">*</span></label>
                  <input className={inputCls('firstName')} placeholder="Juan"
                    value={form.firstName} onChange={setName('firstName')}
                    autoComplete="given-name" autoCapitalize="words" maxLength={50} />
                  <FieldError msg={errors.firstName} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Last Name <span className="text-red-400">*</span></label>
                  <input className={inputCls('lastName')} placeholder="Dela Cruz"
                    value={form.lastName} onChange={setName('lastName')}
                    autoComplete="family-name" autoCapitalize="words" maxLength={50} />
                  <FieldError msg={errors.lastName} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Middle Name <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input className={inputCls('middleName')} placeholder="Santos"
                    value={form.middleName} onChange={setName('middleName')}
                    autoComplete="additional-name" autoCapitalize="words" maxLength={50} />
                  <FieldError msg={errors.middleName} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Suffix</label>
                  <select className="input" value={form.suffix} onChange={set('suffix')}>
                    {SUFFIXES.map(s => <option key={s} value={s}>{s || 'None'}</option>)}
                  </select>
                </div>
              </div>

              {/* Contact */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Contact Number <span className="text-red-400">*</span></label>
                <input className={inputCls('contactNumber')} placeholder="09171234567"
                  inputMode="numeric" autoComplete="tel" maxLength={11}
                  value={form.contactNumber} onChange={setPhone} />
                <FieldError msg={errors.contactNumber} />
                {!errors.contactNumber && (
                  <p className="text-xs text-gray-400 mt-0.5">11-digit Philippine mobile number, digits only</p>
                )}
              </div>

              {/* Address */}
              <div>
                <p className="text-xs font-medium text-gray-700 mb-1">Complete Address <span className="text-red-400">*</span></p>
                <p className="text-xs text-gray-400 mb-2">Appears on your official certificate.</p>
                <div className="space-y-2">
                  <div>
                    <input className={inputCls('barangay')} placeholder="Barangay"
                      value={form.barangay} onChange={set('barangay')}
                      autoComplete="address-line1" autoCapitalize="words" maxLength={80} />
                    <FieldError msg={errors.barangay} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <input className={inputCls('city')} placeholder="City / Municipality"
                        value={form.city} onChange={set('city')}
                        autoComplete="address-level2" autoCapitalize="words" maxLength={60} />
                      <FieldError msg={errors.city} />
                    </div>
                    <div>
                      <input className={inputCls('province')} placeholder="Province"
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
                <p className="text-sm font-semibold text-gray-800">Account Setup</p>
                <p className="text-xs text-gray-400 mt-0.5">Create your login credentials. Use an email you can access — we'll send reset links and notifications there.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email Address <span className="text-red-400">*</span></label>
                <input type="email" className={inputCls('email')} placeholder="juan@gmail.com"
                  inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
                  value={form.email} onChange={set('email')} />
                <FieldError msg={errors.email} />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Password <span className="text-red-400">*</span></label>
                <div className="relative">
                  <input type={showPw ? 'text' : 'password'} className={`${inputCls('password')} pr-9`}
                    placeholder="Min. 8 characters, letters + numbers"
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
                <label className="block text-xs font-medium text-gray-700 mb-1">Confirm Password <span className="text-red-400">*</span></label>
                <div className="relative">
                  <input type={showConfirmPw ? 'text' : 'password'} className={`${inputCls('confirmPassword')} pr-9`}
                    placeholder="Repeat your password"
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
                <p className="text-sm font-semibold text-gray-800">Patient Access Code</p>
                <p className="text-xs text-gray-400 mt-0.5">Your Patient Access Code is required. It was provided to you by CRMC Medical Social Services.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Patient Access Code <span className="text-red-400">*</span></label>
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
                    <div className="flex items-center gap-1 text-green-600 text-sm font-medium px-2 flex-shrink-0">
                      <MdVerified size={18} /> Verified
                    </div>
                  ) : (
                    <button type="button" className="btn-primary px-4 flex-shrink-0"
                      onClick={handleVerify} disabled={verifying}>
                      {verifying ? '...' : 'Verify'}
                    </button>
                  )}
                </div>
                <FieldError msg={errors.hospitalId} />
                {!errors.hospitalId && !hospitalVerified && (
                  <p className="text-xs text-gray-400 mt-1">Enter the 5-digit number after the prefix</p>
                )}
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                <p className="text-xs text-blue-700">
                  Don't have an access code? Visit <strong>CRMC Medical Social Services</strong> to be assessed and receive one.
                </p>
              </div>

              {/* Terms */}
              <div className={`border rounded-xl p-3 transition-colors ${errors.terms ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-gray-50'}`}>
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input type="checkbox" className="w-4 h-4 accent-brand-500 flex-shrink-0 mt-0.5"
                    checked={agreedToTerms}
                    onChange={e => { setAgreedToTerms(e.target.checked); if (errors.terms) setErrors(p => ({ ...p, terms: '' })) }} />
                  <span className="text-xs text-gray-600 leading-relaxed">
                    I agree to the <span className="text-brand-500 font-medium">Privacy Notice</span> and <span className="text-brand-500 font-medium">Terms of Use</span>. I consent to CRMC collecting my personal information for medical assistance purposes.
                  </span>
                </label>
                <FieldError msg={errors.terms} />
              </div>
            </div>
          )}

          {/* ── Navigation buttons ── */}
          <div className={`flex gap-3 mt-6 ${step === 1 ? 'justify-end' : 'justify-between'}`}>
            {step > 1 && (
              <button type="button" className="btn-secondary flex items-center gap-1.5"
                onClick={handleBack} disabled={loading}>
                <MdArrowBack size={16} /> Back
              </button>
            )}
            {step < 3 ? (
              <button type="button" className="btn-primary flex items-center gap-1.5"
                onClick={handleNext}>
                Next <MdArrowForward size={16} />
              </button>
            ) : (
              <button type="button" className="btn-primary flex items-center gap-1.5 flex-1"
                onClick={handleSubmit} disabled={loading}>
                {loading ? 'Creating account...' : 'Create Account →'}
              </button>
            )}
          </div>

          <p className="text-center text-xs text-gray-500 mt-4">
            Already have an account?{' '}
            <Link to="/login" className="text-brand-500 hover:text-brand-600 font-medium">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
