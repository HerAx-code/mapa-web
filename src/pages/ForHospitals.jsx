import { useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { MdArrowBack, MdTune, MdGavel, MdLock, MdHub, MdCheckCircle } from 'react-icons/md'
import { auth, db, signInAnonymously } from '../firebase'
import Logo from '../components/ui/Logo'
import { PH_REGIONS } from '../utils/hospitalConfig'

// "For hospitals" — the public onboarding page (MAPA Platform Redesign canvas).
// A hospital's social-services office asks to join the network; the request
// lands in the platform admin's queue (/platform/requests). Institution-facing,
// so English like the other staff surfaces.
//
// Security: a public write surface. The visitor is signed in anonymously (as
// Register does) and the request id is that session's uid, so the rules allow
// ONE request per session with a pinned shape (firestore.rules
// onboardingRequests). The anonymous session is signed out afterwards.

const HOSPITAL_TYPES = ['DOH-retained', 'LGU', 'SUC', 'DND', 'Private', 'Other']
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const FEATURES = [
  { icon: MdTune,  title: "Configure, don't rebuild", body: 'Your name, funders, document checklists and access-code prefix are settings. No code fork, no separate install.' },
  { icon: MdGavel, title: 'RA 11463 workflow',        body: 'The one-stop-shop process — verify once, assess once, endorse to every agency that can help — built in.' },
  { icon: MdLock,  title: 'Your data, isolated',      body: "Each hospital's patient records are walled off from every other hospital, enforced by security rules, not trust." },
  { icon: MdHub,   title: 'Shared agency queues',     body: 'Funding agencies you partner with work one queue across all their partner hospitals.' },
]

function Field({ id, label, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[13.5px] font-semibold text-gray-700 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

export default function ForHospitals() {
  const [form, setForm] = useState({ hospitalName: '', hospitalType: 'DOH-retained', region: '', contactName: '', email: '', message: '' })
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const data = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()]))
    if (data.hospitalName.length < 3) return setError('Please enter the hospital name.')
    if (data.contactName.length < 2) return setError('Please enter a contact person.')
    if (!EMAIL_RE.test(data.email)) return setError('Please enter a valid work email.')
    setSending(true)
    let anon = false
    try {
      if (!auth.currentUser) { await signInAnonymously(auth); anon = true }
      await setDoc(doc(db, 'onboardingRequests', auth.currentUser.uid), {
        ...data, status: 'new', createdAt: serverTimestamp(),
      })
      setSent(true)
    } catch (err) {
      console.error('[ForHospitals] request failed:', err)
      setError(err?.code === 'permission-denied'
        ? 'A request was already sent from this browser session. We will be in touch.'
        : 'Could not send the request. Please try again.')
    } finally {
      if (anon || auth.currentUser?.isAnonymous) await signOut(auth).catch(() => {})
      setSending(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-gray-900">
      <header className="border-b border-gray-200/70 bg-canvas/90 backdrop-blur sticky top-0 z-20">
        <div className="max-w-[1180px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo size={30} />
            <span className="font-display text-lg font-bold text-brand-900">MAPA</span>
          </Link>
          <Link to="/login" className="text-sm font-semibold text-brand-600 hover:text-brand-700">Staff log in →</Link>
        </div>
      </header>

      <main className="max-w-[1180px] mx-auto px-4 sm:px-8 py-10 sm:py-16 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14 items-start">
        <section>
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-white px-3.5 py-1.5 text-xs font-semibold text-brand-700">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-400" />For Malasakit Centers and social-services offices
          </span>
          <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-brand-900 mt-5 leading-[1.05]">Bring MAPA to your hospital</h1>
          <p className="text-[17px] leading-relaxed text-gray-600 mt-5 max-w-xl">
            Run your medical assistance desk as a digital one-stop shop. Adopt MAPA by configuring it — your name, your funders,
            your document rules — never forking or rewriting. One workflow, your settings, your data kept to your hospital.
          </p>

          <div className="grid sm:grid-cols-2 gap-4 mt-8">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-gray-200/80 bg-white p-5">
                <span aria-hidden="true" className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Icon size={20} /></span>
                <h2 className="font-semibold text-brand-900 mt-3">{title}</h2>
                <p className="text-sm leading-relaxed text-gray-600 mt-1.5">{body}</p>
              </div>
            ))}
          </div>

          <blockquote className="mt-8 rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 p-6 text-white">
            <p className="font-display text-xl leading-snug">“Hospitals differ in settings, not process.”</p>
            <p className="text-sm text-brand-100 mt-2">RA 11463 sets one Malasakit workflow — MAPA lets each hospital configure it and go live.</p>
          </blockquote>

          <Link to="/" className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700">
            <MdArrowBack size={16} /> Back to home
          </Link>
        </section>

        <section className="rounded-3xl border border-gray-200/80 bg-white p-6 sm:p-8 shadow-[0_24px_60px_-32px_rgba(2,32,15,0.28)] lg:sticky lg:top-24">
          {sent ? (
            <div className="text-center py-8">
              <MdCheckCircle size={44} className="mx-auto text-brand-500" />
              <h2 className="font-display text-2xl font-bold text-brand-900 mt-3">Request received</h2>
              <p className="text-sm text-gray-600 mt-2 max-w-xs mx-auto">
                Thank you. The MAPA network team will reach out to {form.email.trim()} with a setup walkthrough.
              </p>
              <Link to="/" className="btn-secondary mt-6 inline-flex">Back to home</Link>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <h2 className="font-display text-2xl font-bold text-brand-900">Request onboarding</h2>
              <p className="text-sm text-gray-500 mt-1.5">We'll reach out with a setup walkthrough and a data-privacy pack.</p>
              <div className="mt-6 space-y-4">
                <Field id="fh-name" label="Hospital name">
                  <input id="fh-name" className="input" maxLength={150} value={form.hospitalName} onChange={set('hospitalName')} autoComplete="organization" />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field id="fh-type" label="Hospital type">
                    <select id="fh-type" className="input" value={form.hospitalType} onChange={set('hospitalType')}>
                      {HOSPITAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field id="fh-region" label="Region">
                    <input id="fh-region" className="input" list="fh-regions" maxLength={40} value={form.region} onChange={set('region')} placeholder="e.g. BARMM" />
                    <datalist id="fh-regions">{PH_REGIONS.map((r) => <option key={r} value={r} />)}</datalist>
                  </Field>
                </div>
                <Field id="fh-contact" label="Contact person">
                  <input id="fh-contact" className="input" maxLength={120} value={form.contactName} onChange={set('contactName')} autoComplete="name" />
                </Field>
                <Field id="fh-email" label="Work email">
                  <input id="fh-email" type="email" className="input" maxLength={200} value={form.email} onChange={set('email')} autoComplete="email" />
                </Field>
                <Field id="fh-msg" label="Anything we should know? (optional)">
                  <textarea id="fh-msg" className="input min-h-[96px]" maxLength={2000} value={form.message} onChange={set('message')} />
                </Field>
              </div>
              {error && <p role="alert" className="text-sm text-red-600 mt-4">{error}</p>}
              <button type="submit" className="btn-primary w-full justify-center mt-6 min-h-[48px]" disabled={sending}>
                {sending ? 'Sending…' : 'Request onboarding'}
              </button>
              <p className="text-xs text-gray-500 mt-3">We use these details only to contact your office about joining MAPA.</p>
            </form>
          )}
        </section>
      </main>
    </div>
  )
}
