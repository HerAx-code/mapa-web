import { useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { MdArrowBack, MdTune, MdGavel, MdLock, MdHub, MdCheckCircle, MdDescription, MdVerified, MdHandshake, MdSchool, MdRocketLaunch } from 'react-icons/md'
import { auth, db, signInAnonymously } from '../firebase'
import Logo from '../components/ui/Logo'
import { PH_REGIONS } from '../utils/hospitalConfig'
import { OWNERSHIP_TYPES } from '../utils/onboarding'

// "For hospitals" — the public onboarding page. A hospital sends an
// EXPRESSION OF INTEREST here; the formal start is a letter of intent from the
// hospital head, then verification, a MOA signed by both sides with the Data
// Privacy Act paperwork, setup + training, and go-live (reports/Hospital
// onboarding requirements.md, revalidated 2026-11-15). Institution-facing,
// so English like the other staff surfaces.
//
// Security: a public write surface. The visitor is signed in anonymously (as
// Register does) and the request id is that session's uid, so the rules allow
// ONE request per session with a pinned shape (firestore.rules
// onboardingRequests). The anonymous session is signed out afterwards.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const FEATURES = [
  { icon: MdTune,  title: "Configure, don't rebuild", body: 'Your name, funders, document checklists and access-code prefix are settings. No code fork, no separate install.' },
  { icon: MdGavel, title: 'RA 11463 workflow',        body: 'The one-stop-shop process — verify once, assess once, endorse to the funders that can help — built in.' },
  { icon: MdLock,  title: 'Your data, isolated',      body: "Each hospital's patient records are walled off from every other hospital, enforced by security rules, not trust." },
  { icon: MdHub,   title: 'Shared agency queues',     body: 'Funding agencies you partner with work one queue across all their partner hospitals.' },
]

const STEPS = [
  { icon: MdDescription,  title: 'Expression of interest', body: 'Send this form, then a letter of intent signed by your hospital head.' },
  { icon: MdVerified,     title: 'Verification',           body: 'We check your facility against the DOH registry (NHFR code, License to Operate, PhilHealth) and call your official number.' },
  { icon: MdHandshake,    title: 'Agreement',              body: 'A no-cost MOA signed by both sides, a data processing agreement, your Data Protection Officer and a privacy impact assessment.' },
  { icon: MdSchool,       title: 'Setup & training',       body: 'We set up your hospital, your staff practice in a training hospital with sample patients, and you sign a go-live acceptance.' },
  { icon: MdRocketLaunch, title: 'Go-live',                body: 'Patients can register with your access codes. We stay close during the first weeks.' },
]

const NEEDS = [
  'NHFR facility code and DOH License to Operate',
  'PhilHealth accreditation number (if accredited)',
  'Letter of intent from the hospital head',
  'Proof of the signatory’s authority',
  'A designated Data Protection Officer',
  'A Hospital Admin and a backup admin from your social-services office',
]

function Field({ id, label, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[13.5px] font-semibold text-gray-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}

const EMPTY = {
  hospitalName: '', hospitalType: 'DOH-retained', region: '', nhfrCode: '', officialPhone: '',
  contactName: '', contactPosition: '', email: '', signatoryName: '', signatoryPosition: '', message: '',
}

export default function ForHospitals() {
  const [form, setForm] = useState(EMPTY)
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
            Run your medical assistance desk as a digital one-stop shop — configured to your hospital, your funders and your
            document rules, with your patients' data kept to your hospital.
          </p>
          <p className="mt-4 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-green-50 px-4 py-2.5 text-sm font-semibold text-green-800">
            <span>Free during the pilot</span><span aria-hidden="true">·</span>
            <span>No obligation to purchase</span><span aria-hidden="true">·</span>
            <span>Patients never pay</span>
          </p>

          {/* How joining works */}
          <h2 className="font-display text-xl font-bold text-brand-900 mt-10">How joining works</h2>
          <ol className="mt-4 space-y-3">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="flex gap-3 rounded-2xl border border-gray-200/80 bg-white p-4">
                <span aria-hidden="true" className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Icon size={18} /></span>
                <div>
                  <p className="font-semibold text-brand-900"><span className="text-gray-400 mr-1.5">{i + 1}.</span>{title}</p>
                  <p className="text-sm leading-relaxed text-gray-600 mt-0.5">{body}</p>
                </div>
              </li>
            ))}
          </ol>

          {/* What you'll need + who signs */}
          <div className="grid gap-4 md:grid-cols-2 mt-8">
            <div className="rounded-2xl border border-gray-200/80 bg-white p-5">
              <h2 className="font-semibold text-brand-900">What you'll need</h2>
              <ul className="mt-3 space-y-2">
                {NEEDS.map(n => (
                  <li key={n} className="flex gap-2 text-sm text-gray-700"><MdCheckCircle size={16} className="mt-0.5 flex-shrink-0 text-brand-500" aria-hidden="true" />{n}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-gray-200/80 bg-white p-5">
              <h2 className="font-semibold text-brand-900">Who signs the MOA</h2>
              <dl className="mt-3 space-y-2.5 text-sm">
                {OWNERSHIP_TYPES.filter(o => ['DOH-retained', 'BARMM MOH', 'LGU', 'Private'].includes(o.value)).map(o => (
                  <div key={o.value}>
                    <dt className="font-medium text-gray-800">{o.label}</dt>
                    <dd className="text-gray-600">{o.signer} · <span className="text-gray-500">{o.authority}</span></dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 mt-8">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-gray-200/80 bg-white p-5">
                <span aria-hidden="true" className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Icon size={20} /></span>
                <h2 className="font-semibold text-brand-900 mt-3">{title}</h2>
                <p className="text-sm leading-relaxed text-gray-600 mt-1.5">{body}</p>
              </div>
            ))}
          </div>

          <Link to="/" className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700">
            <MdArrowBack size={16} /> Back to home
          </Link>
        </section>

        <section className="rounded-3xl border border-gray-200/80 bg-white p-6 sm:p-8 shadow-[0_24px_60px_-32px_rgba(2,32,15,0.28)] lg:sticky lg:top-24">
          {sent ? (
            <div className="text-center py-8">
              <MdCheckCircle size={44} className="mx-auto text-brand-500" />
              <h2 className="font-display text-2xl font-bold text-brand-900 mt-3">Expression of interest received</h2>
              <p className="text-sm text-gray-600 mt-2 max-w-xs mx-auto">
                Thank you. The MAPA network team will contact {form.email.trim()}. To start formally, please prepare a
                letter of intent signed by your hospital head.
              </p>
              <Link to="/" className="btn-secondary mt-6 inline-flex">Back to home</Link>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <h2 className="font-display text-2xl font-bold text-brand-900">Express interest</h2>
              <p className="text-sm text-gray-500 mt-1.5">This starts the conversation. The formal start is a letter of intent from your hospital head.</p>
              <div className="mt-6 space-y-4">
                <Field id="fh-name" label="Hospital name (as licensed)">
                  <input id="fh-name" className="input" maxLength={150} value={form.hospitalName} onChange={set('hospitalName')} autoComplete="organization" />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field id="fh-type" label="Ownership">
                    <select id="fh-type" className="input" value={form.hospitalType} onChange={set('hospitalType')}>
                      {OWNERSHIP_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </Field>
                  <Field id="fh-region" label="Region">
                    <input id="fh-region" className="input" list="fh-regions" maxLength={40} value={form.region} onChange={set('region')} placeholder="e.g. BARMM" />
                    <datalist id="fh-regions">{PH_REGIONS.map((r) => <option key={r} value={r} />)}</datalist>
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field id="fh-nhfr" label="NHFR facility code (optional)" hint="From your DOH license.">
                    <input id="fh-nhfr" className="input font-mono" maxLength={30} value={form.nhfrCode} onChange={set('nhfrCode')} />
                  </Field>
                  <Field id="fh-phone" label="Hospital official phone">
                    <input id="fh-phone" type="tel" className="input" maxLength={40} value={form.officialPhone} onChange={set('officialPhone')} autoComplete="tel" />
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field id="fh-contact" label="Your name">
                    <input id="fh-contact" className="input" maxLength={120} value={form.contactName} onChange={set('contactName')} autoComplete="name" />
                  </Field>
                  <Field id="fh-position" label="Your position">
                    <input id="fh-position" className="input" maxLength={120} value={form.contactPosition} onChange={set('contactPosition')} placeholder="e.g. Head, Medical Social Work" />
                  </Field>
                </div>
                <Field id="fh-email" label="Work email">
                  <input id="fh-email" type="email" className="input" maxLength={200} value={form.email} onChange={set('email')} autoComplete="email" />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field id="fh-sig" label="Authorized signatory (optional)">
                    <input id="fh-sig" className="input" maxLength={120} value={form.signatoryName} onChange={set('signatoryName')} />
                  </Field>
                  <Field id="fh-sigpos" label="Signatory's position">
                    <input id="fh-sigpos" className="input" maxLength={120} value={form.signatoryPosition} onChange={set('signatoryPosition')} placeholder="e.g. Chief of Hospital" />
                  </Field>
                </div>
                <Field id="fh-msg" label="Funders you work with, or anything we should know (optional)">
                  <textarea id="fh-msg" className="input min-h-[96px]" maxLength={2000} value={form.message} onChange={set('message')} placeholder="e.g. PCSO, DSWD, AMBaG; Malasakit Center on site" />
                </Field>
              </div>
              {error && <p role="alert" className="text-sm text-red-600 mt-4">{error}</p>}
              <button type="submit" className="btn-primary w-full justify-center mt-6 min-h-[48px]" disabled={sending}>
                {sending ? 'Sending…' : 'Send expression of interest'}
              </button>
              <p className="text-xs text-gray-500 mt-3">We use these details only to contact your office about joining MAPA.</p>
            </form>
          )}
        </section>
      </main>
    </div>
  )
}
