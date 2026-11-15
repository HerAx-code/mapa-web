import { useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { MdArrowForward, MdGavel, MdLock, MdHub, MdCheckCircle, MdDescription, MdVerified, MdHandshake, MdSchool, MdRocketLaunch, MdTune, MdPrint } from 'react-icons/md'
import { auth, db, signInAnonymously } from '../firebase'
import Logo from '../components/ui/Logo'
import { ORG } from '../config/org'
import { PH_REGIONS } from '../utils/hospitalConfig'
import { OWNERSHIP_TYPES, ownershipOf, REPLY_WORKING_DAYS } from '../utils/onboarding'

// "For hospitals" — the public page where a hospital REQUESTS TO JOIN the MAPA
// network (form 2, 2026-11-15; reports/Hospital onboarding requirements.md).
// It collects only what the request stage needs: the facility as on its DOH
// license (NHFR code, ownership, address, official contacts), the requesting
// office and officer, the head of facility who signs, and optional current
// funders — plus the officer's declaration of authority and privacy-notice
// consent. The LTO, PhilHealth accreditation and other documents are checked
// at verification. The signed letter of intent follows through official
// channels, quoting the reference number shown on submission. The facility is
// verified against the DOH registry and called back on the number listed
// THERE, not the number typed here. Institution-facing, so English.
//
// Security: a public write surface. The visitor is signed in anonymously (as
// Register does) and the request id is that session's uid, so the rules allow
// ONE request per session with a pinned shape (firestore.rules
// onboardingForm2Ok). The anonymous session is signed out afterwards.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
export const PRIVACY_NOTICE_VERSION = '2026-11-15'
// The reply promised on the acknowledgement; the Super Admin board flags it.
export const RESPONSE_WORKING_DAYS = REPLY_WORKING_DAYS

const OFFICES = ['Medical Social Service', 'Malasakit Center', 'Hospital Administration', 'Other']
const FUNDERS = ['DOH MAIFIP', 'PCSO', 'DSWD AICS', 'PhilHealth', 'LGU assistance', 'Legislator / party-list offices', 'Other']

const FEATURES = [
  { icon: MdGavel, title: 'Follows the RA 11463 process', body: 'One verification of documents, one assessment by your social worker, and endorsement to the funders who can help — as in a Malasakit Center.' },
  { icon: MdLock,  title: 'Patient data stays with your hospital', body: 'Each hospital sees only its own patients and cases. Funders see only the cases endorsed to them.' },
  { icon: MdHub,   title: 'Funders work from one queue', body: 'Partner agencies receive endorsements from all their partner hospitals in one place, with per-hospital daily slots.' },
  { icon: MdTune,  title: 'Set up for your hospital', body: 'Your hospital name, office, funders, document checklist and access-code prefix are configured for you — no separate system to install.' },
]

const STEPS = [
  { icon: MdDescription,  title: 'Request and letter of intent', body: 'Submit this request, then send a letter of intent signed by the head of facility, quoting your reference number.' },
  { icon: MdVerified,     title: 'Verification',                 body: 'We check your facility in the DOH National Health Facility Registry and call your hospital on the official number listed there.' },
  { icon: MdHandshake,    title: 'Agreement',                    body: 'A no-cost Memorandum of Agreement signed by both sides, with a data processing agreement, your Data Protection Officer and a privacy impact assessment.' },
  { icon: MdSchool,       title: 'Setup and training',           body: 'We set up your hospital; your staff practise in a training hospital with sample patients; your hospital signs a go-live acceptance.' },
  { icon: MdRocketLaunch, title: 'Go-live',                      body: 'Patients file requests with access codes your office issues. We support your team closely during the first weeks.' },
]

const NEEDS = [
  'NHFR facility code (from your DOH License to Operate)',
  'A current DOH License to Operate and, if accredited, your PhilHealth accreditation — checked at verification',
  'A letter of intent signed by the head of facility',
  'Proof of the signatory’s authority (e.g. office order or board resolution)',
  'A designated Data Protection Officer',
  'A Hospital Admin and a backup admin from your social-services office',
]

function Field({ id, label, hint, required, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[13.5px] font-semibold text-gray-700 mb-1.5">
        {label}{required && <span className="text-red-500" aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}

function Section({ n, title, desc, children }) {
  return (
    <fieldset className="grid gap-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-10 py-8 border-t border-gray-200/80 first:border-0 first:pt-0">
      <div>
        <legend className="flex items-center gap-2.5 font-display text-lg font-bold text-brand-900">
          <span aria-hidden="true" className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-sm text-brand-700">{n}</span>
          {title}
        </legend>
        {desc && <p className="mt-2 text-sm leading-relaxed text-gray-500">{desc}</p>}
      </div>
      <div className="rounded-2xl border border-gray-200/80 bg-white p-5 sm:p-6 space-y-5">{children}</div>
    </fieldset>
  )
}

const EMPTY = {
  hospitalName: '', hospitalType: 'DOH-retained', nhfrCode: '', province: '', city: '', region: '',
  officialPhone: '', officialEmail: '',
  requestingOffice: 'Medical Social Service', contactName: '', contactPosition: '', email: '', contactPhone: '',
  signatoryName: '', signatoryPosition: '',
  funders: [], malasakitOnSite: false, message: '',
  certifiedAuthority: false, privacyConsent: false,
}

// Reference shown to the hospital and quoted on its letter of intent:
// MAPA-HR-YYMMDD-XXXX (date + the first 4 characters of the request id).
export const referenceFor = (id, date = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `MAPA-HR-${String(date.getFullYear()).slice(2)}${p(date.getMonth() + 1)}${p(date.getDate())}-${id.slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`
}

// The first problem in the form, or ''.
export function validateRequest(d) {
  if (d.hospitalName.length < 3) return 'Enter the hospital name as it appears on its DOH License to Operate.'
  if (d.nhfrCode.length < 3) return 'Enter the hospital’s NHFR facility code.'
  if (d.province.length < 2 || d.city.length < 2) return 'Enter the province and the city or municipality.'
  if (d.officialPhone.replace(/\D/g, '').length < 7) return 'Enter the hospital’s official phone number.'
  if (!EMAIL_RE.test(d.officialEmail)) return 'Enter the hospital’s official email address.'
  if (d.contactName.length < 2 || d.contactPosition.length < 2) return 'Enter the requesting officer’s name and position.'
  if (!EMAIL_RE.test(d.email)) return 'Enter the requesting officer’s email address.'
  if (d.signatoryName.length < 2 || d.signatoryPosition.length < 2) return 'Enter the name and position of the head of facility who will sign.'
  if (!d.certifiedAuthority) return 'Confirm that you are authorized to submit this request.'
  if (!d.privacyConsent) return 'Confirm that you have read the privacy notice.'
  return ''
}

export default function ForHospitals() {
  const [form, setForm] = useState(EMPTY)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(null) // { referenceNo }
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))
  const tick = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.checked }))
  const toggleFunder = (f) => setForm((p) => ({ ...p, funders: p.funders.includes(f) ? p.funders.filter(x => x !== f) : [...p.funders, f] }))
  const signer = ownershipOf(form.hospitalType)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const data = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]))
    const problem = validateRequest(data)
    if (problem) return setError(problem)
    setSending(true)
    let anon = false
    try {
      if (!auth.currentUser) { await signInAnonymously(auth); anon = true }
      const id = auth.currentUser.uid
      const referenceNo = referenceFor(id)
      await setDoc(doc(db, 'onboardingRequests', id), {
        ...data, formVersion: 2, referenceNo, privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        status: 'new', createdAt: serverTimestamp(),
      })
      setSent({ referenceNo })
    } catch (err) {
      console.error('[ForHospitals] request failed:', err)
      setError(err?.code === 'permission-denied'
        ? 'A request was already submitted from this browser session. The network team will contact your office.'
        : 'The request could not be submitted. Please try again.')
    } finally {
      if (anon || auth.currentUser?.isAnonymous) await signOut(auth).catch(() => {})
      setSending(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-gray-900">
      <header className="border-b border-gray-200/70 bg-canvas/90 backdrop-blur sticky top-0 z-20 print:hidden">
        <div className="max-w-[1180px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo size={30} />
            <span className="font-display text-lg font-bold text-brand-900">MAPA</span>
          </Link>
          <Link to="/login" className="text-sm font-semibold text-brand-600 hover:text-brand-700">Staff log in →</Link>
        </div>
      </header>

      <main className="print:hidden">
        {/* ── Intro ── */}
        <section className="max-w-[1180px] mx-auto px-4 sm:px-8 pt-10 sm:pt-16 grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:gap-14 items-start">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-white px-3.5 py-1.5 text-xs font-semibold text-brand-700">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-400" />For hospitals, Malasakit Centers and social-services offices
            </span>
            <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-brand-900 mt-5 leading-[1.05]">Request to join the MAPA network</h1>
            <p className="text-[17px] leading-relaxed text-gray-600 mt-5 max-w-2xl">
              MAPA lets your social-services office receive, verify, assess and endorse medical assistance requests online,
              following the RA 11463 one-stop-shop process, with your patients’ records kept to your hospital.
            </p>
            <a href="#request" className="btn-primary mt-7 inline-flex min-h-[48px] px-6 items-center gap-2">Start the request <MdArrowForward size={18} /></a>
          </div>
          <aside className="rounded-2xl border border-gray-200/80 bg-white p-6">
            <h2 className="font-semibold text-brand-900">At a glance</h2>
            <ul className="mt-3 space-y-2.5 text-sm text-gray-700">
              <li className="flex gap-2"><MdCheckCircle size={17} className="mt-0.5 flex-shrink-0 text-green-600" aria-hidden="true" />No cost to the hospital during the pilot, and no purchase obligation</li>
              <li className="flex gap-2"><MdCheckCircle size={17} className="mt-0.5 flex-shrink-0 text-green-600" aria-hidden="true" />Patients never pay</li>
              <li className="flex gap-2"><MdCheckCircle size={17} className="mt-0.5 flex-shrink-0 text-green-600" aria-hidden="true" />The request takes about 10 minutes; have your NHFR facility code ready</li>
              <li className="flex gap-2"><MdCheckCircle size={17} className="mt-0.5 flex-shrink-0 text-green-600" aria-hidden="true" />We reply within {RESPONSE_WORKING_DAYS} working days after checking the DOH registry</li>
            </ul>
          </aside>
        </section>

        {/* ── How joining works ── */}
        <section className="max-w-[1180px] mx-auto px-4 sm:px-8 mt-14">
          <h2 className="font-display text-2xl font-bold text-brand-900">How joining works</h2>
          <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="rounded-2xl border border-gray-200/80 bg-white p-5">
                <div className="flex items-center gap-2.5">
                  <span aria-hidden="true" className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Icon size={18} /></span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Step {i + 1}</span>
                </div>
                <p className="font-semibold text-brand-900 mt-3">{title}</p>
                <p className="text-sm leading-relaxed text-gray-600 mt-1">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── What you'll need · who signs · what you get ── */}
        <section className="max-w-[1180px] mx-auto px-4 sm:px-8 mt-10 grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-gray-200/80 bg-white p-6">
            <h2 className="font-semibold text-brand-900">What your hospital will need</h2>
            <ul className="mt-3 space-y-2">
              {NEEDS.map(n => (
                <li key={n} className="flex gap-2 text-sm text-gray-700"><MdCheckCircle size={16} className="mt-0.5 flex-shrink-0 text-brand-500" aria-hidden="true" />{n}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-gray-200/80 bg-white p-6">
            <h2 className="font-semibold text-brand-900">Who signs the agreement</h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              {OWNERSHIP_TYPES.filter(o => ['DOH-retained', 'BARMM MOH', 'LGU', 'Private'].includes(o.value)).map(o => (
                <div key={o.value}>
                  <dt className="font-medium text-gray-800">{o.label}</dt>
                  <dd className="text-gray-600">{o.signer} · <span className="text-gray-500">{o.authority}</span></dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="rounded-2xl border border-gray-200/80 bg-white p-6">
            <h2 className="font-semibold text-brand-900">What your hospital gets</h2>
            <ul className="mt-3 space-y-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-3">
                  <span aria-hidden="true" className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Icon size={16} /></span>
                  <div><p className="text-sm font-semibold text-gray-800">{title}</p><p className="text-sm leading-relaxed text-gray-600">{body}</p></div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      {/* ── The request form (its own wide section) ── */}
      <section id="request" className="scroll-mt-20 max-w-[1180px] mx-auto px-4 sm:px-8 mt-16 pb-16">
        {sent ? (
          <div className="rounded-3xl border border-gray-200/80 bg-white p-6 sm:p-10 max-w-2xl mx-auto">
            <MdCheckCircle size={44} className="text-brand-500" />
            <h2 className="font-display text-2xl font-bold text-brand-900 mt-3">Request received</h2>
            <p className="text-sm text-gray-600 mt-2">Reference number</p>
            <p className="font-mono text-2xl font-bold text-gray-900 tracking-wide">{sent.referenceNo}</p>
            <ol className="mt-6 space-y-3 text-sm text-gray-700 list-decimal pl-5">
              <li>Send a <strong>letter of intent</strong> signed by the head of facility, addressed to the MAPA Network Operator and quoting <span className="font-mono">{sent.referenceNo}</span>{ORG.contactEmail ? <>, to <a className="font-semibold text-brand-700 underline break-all" href={`mailto:${ORG.contactEmail}?subject=${encodeURIComponent(`Letter of intent — ${sent.referenceNo}`)}`}>{ORG.contactEmail}</a></> : null}.</li>
              <li>Within <strong>{RESPONSE_WORKING_DAYS} working days</strong>, the network team will check your facility in the DOH National Health Facility Registry and call your hospital on the official number listed there.</li>
              <li>We will then send the agreement documents to {form.officialEmail.trim()}.</li>
            </ol>
            <div className="mt-7 flex flex-wrap gap-2 print:hidden">
              <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => window.print()}><MdPrint size={16} /> Print acknowledgement</button>
              <Link to="/" className="btn-secondary inline-flex">Back to home</Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="print:hidden">
            <div className="max-w-2xl">
              <h2 className="font-display text-3xl font-bold text-brand-900">Request form</h2>
              <p className="text-[15px] text-gray-600 mt-2">
                Fields marked <span className="text-red-500">*</span> are required. Your hospital is verified against the DOH registry before any agreement.
              </p>
            </div>
            <div className="mt-8">
              <Section n={1} title="Facility" desc="As written on your DOH License to Operate. We use these to find the hospital in the DOH National Health Facility Registry.">
                <Field id="fh-name" label="Hospital name (as on the DOH License to Operate)" required>
                  <input id="fh-name" className="input" maxLength={150} value={form.hospitalName} onChange={set('hospitalName')} autoComplete="organization" />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <Field id="fh-nhfr" label="NHFR facility code" required hint="On your DOH License to Operate; also your DOH online-licensing username.">
                    <input id="fh-nhfr" className="input font-mono" maxLength={30} value={form.nhfrCode} onChange={set('nhfrCode')} />
                  </Field>
                  <Field id="fh-type" label="Ownership" required>
                    <select id="fh-type" className="input" value={form.hospitalType} onChange={set('hospitalType')}>
                      {OWNERSHIP_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                  <Field id="fh-province" label="Province" required>
                    <input id="fh-province" className="input" maxLength={80} value={form.province} onChange={set('province')} />
                  </Field>
                  <Field id="fh-city" label="City / municipality" required>
                    <input id="fh-city" className="input" maxLength={80} value={form.city} onChange={set('city')} />
                  </Field>
                  <Field id="fh-region" label="Region">
                    <input id="fh-region" className="input" list="fh-regions" maxLength={40} value={form.region} onChange={set('region')} placeholder="e.g. BARMM" />
                    <datalist id="fh-regions">{PH_REGIONS.map((r) => <option key={r} value={r} />)}</datalist>
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <Field id="fh-phone" label="Hospital official phone" required>
                    <input id="fh-phone" type="tel" className="input" maxLength={40} value={form.officialPhone} onChange={set('officialPhone')} autoComplete="tel" />
                  </Field>
                  <Field id="fh-oemail" label="Hospital or office official email" required>
                    <input id="fh-oemail" type="email" className="input" maxLength={200} value={form.officialEmail} onChange={set('officialEmail')} />
                  </Field>
                </div>
              </Section>

              <Section n={2} title="Requesting office" desc="The office and officer submitting this request. We contact this person about next steps.">
                <Field id="fh-office" label="Office" required>
                  <select id="fh-office" className="input sm:max-w-xs" value={form.requestingOffice} onChange={set('requestingOffice')}>
                    {OFFICES.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <Field id="fh-contact" label="Requesting officer" required>
                    <input id="fh-contact" className="input" maxLength={120} value={form.contactName} onChange={set('contactName')} autoComplete="name" />
                  </Field>
                  <Field id="fh-position" label="Position" required>
                    <input id="fh-position" className="input" maxLength={120} value={form.contactPosition} onChange={set('contactPosition')} placeholder="e.g. Head, Medical Social Service" />
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <Field id="fh-email" label="Officer’s email" required>
                    <input id="fh-email" type="email" className="input" maxLength={200} value={form.email} onChange={set('email')} autoComplete="email" />
                  </Field>
                  <Field id="fh-cphone" label="Officer’s direct number">
                    <input id="fh-cphone" type="tel" className="input" maxLength={40} value={form.contactPhone} onChange={set('contactPhone')} />
                  </Field>
                </div>
              </Section>

              <Section n={3} title="Head of facility" desc="The person who will sign the Memorandum of Agreement for the hospital.">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <Field id="fh-sig" label="Name" required>
                    <input id="fh-sig" className="input" maxLength={120} value={form.signatoryName} onChange={set('signatoryName')} />
                  </Field>
                  <Field id="fh-sigpos" label="Position" required>
                    <input id="fh-sigpos" className="input" maxLength={120} value={form.signatoryPosition} onChange={set('signatoryPosition')} placeholder="e.g. Chief of Hospital" />
                  </Field>
                </div>
                {signer && <p className="text-sm text-gray-500">For a {signer.label} hospital, the agreement is usually signed by: <span className="text-gray-700">{signer.signer}</span>.</p>}
              </Section>

              <Section n={4} title="Current medical assistance" desc="Optional. Helps us link the funding agencies your office already works with.">
                <div>
                  <p className="text-[13.5px] font-semibold text-gray-700 mb-2.5">Funders your office works with</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                    {FUNDERS.map((f) => (
                      <label key={f} className="flex items-center gap-2.5 text-sm text-gray-700 cursor-pointer min-h-[36px]">
                        <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={form.funders.includes(f)} onChange={() => toggleFunder(f)} /> {f}
                      </label>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2.5 text-sm text-gray-700 cursor-pointer min-h-[36px]">
                  <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={form.malasakitOnSite} onChange={tick('malasakitOnSite')} /> The hospital has a Malasakit Center on site
                </label>
                <Field id="fh-msg" label="Other information">
                  <textarea id="fh-msg" className="input min-h-[96px]" maxLength={2000} value={form.message} onChange={set('message')} />
                </Field>
              </Section>

              <Section n={5} title="Declarations" desc="Required before submitting.">
                <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-500" checked={form.certifiedAuthority} onChange={tick('certifiedAuthority')} />
                  <span>I am authorized by the head of facility to submit this request on behalf of the hospital, and the information above is true and correct.<span className="text-red-500" aria-hidden="true"> *</span></span>
                </label>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-[13px] leading-relaxed text-gray-600">
                  <p className="font-semibold text-gray-700">Privacy notice (RA 10173)</p>
                  <p className="mt-1">
                    The MAPA network operator collects the names, positions and work contact details above, and the facility details, only to evaluate this request,
                    verify the facility and contact your office about joining. They are seen only by the network team. If the hospital joins, they become part of its
                    onboarding record; if the request is declined or withdrawn, they are deleted one year after the last action.
                    You may ask to access, correct or delete them{ORG.contactEmail ? <> by writing to <a className="underline" href={`mailto:${ORG.contactEmail}`}>{ORG.contactEmail}</a></> : null}.
                  </p>
                </div>
                <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-500" checked={form.privacyConsent} onChange={tick('privacyConsent')} />
                  <span>I have read the privacy notice and agree to these details being processed for this request.<span className="text-red-500" aria-hidden="true"> *</span></span>
                </label>
              </Section>
            </div>

            <div className="mt-2 border-t border-gray-200/80 pt-8 lg:grid lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-10">
              <div className="hidden lg:block" />
              <div>
                {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <button type="submit" className="btn-primary justify-center min-h-[52px] px-8 text-base" disabled={sending}>
                    {sending ? 'Submitting…' : 'Submit request'}
                  </button>
                  <p className="text-sm text-gray-500">You will get a reference number to quote on your letter of intent.</p>
                </div>
              </div>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
