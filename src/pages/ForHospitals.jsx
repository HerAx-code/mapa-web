import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import {
  MdArrowForward, MdGavel, MdLock, MdHub, MdCheckCircle, MdDescription, MdVerified, MdHandshake,
  MdSchool, MdRocketLaunch, MdTune, MdPrint, MdInbox, MdAssignment, MdBarChart, MdReceiptLong,
  MdSmartphone, MdWarningAmber,
} from 'react-icons/md'
import { auth, db, signInAnonymously } from '../firebase'
import Logo from '../components/ui/Logo'
import { ORG } from '../config/org'
import { PH_REGIONS } from '../utils/hospitalConfig'
import { PROVINCES_BY_REGION, citiesFor } from '../data/phProvinces'
import { displayEmail } from '../utils/maskEmail'
import EmailLink from '../components/ui/EmailLink'

// The "Other (not listed)" choice in the address dropdowns.
const OTHER = '__other__'
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
// Page order (review 2026-11-24): what the hospital gets comes before the
// paperwork, because a hospital decides whether to join before it prepares.
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
// PhilHealth is prior coverage on the bill in MAPA, not an assistance funder,
// so it isn't offered here.
const FUNDERS = ['DOH MAIFIP', 'PCSO', 'DSWD AICS', 'LGU assistance', 'Legislator / party-list offices', 'Other']

// What the hospital's office actually works with once it joins.
const FEATURES = [
  { icon: MdInbox,       title: 'One queue for every request', body: 'Requests arrive with their documents and an ID selfie. Your office verifies, assesses and endorses them from one queue: no paper forms to re-encode.' },
  { icon: MdAssignment,  title: 'Intake sheet and classification', body: 'The Unified Intake Sheet online, with the DOH AO 2021-0044 classification worked out from your poverty line, and a Certificate of Eligibility to print.' },
  { icon: MdHub,         title: 'Endorse to several funders at once', body: 'Send one request to the partner agencies that can fund it. Each decides its part from its own queue, with per-hospital daily slots, and the Guarantee Letters come back to the case.' },
  { icon: MdReceiptLong, title: 'Guarantee Letters in one ledger', body: 'See every letter for your patients: valid, expiring, used or expired, with totals per agency.' },
  { icon: MdBarChart,    title: 'Reports you already file', body: 'Export the DOH monthly assistance report, without names, from the cases themselves.' },
  { icon: MdLock,        title: 'Patient data stays with your hospital', body: 'Each hospital sees only its own patients and cases. Funders see only the cases endorsed to them.' },
  { icon: MdSmartphone,  title: 'Patients apply from their phones', body: 'In Filipino or English, free of charge. Patients who can’t apply online are helped at your office.' },
  { icon: MdTune,        title: 'Set up for your hospital', body: 'Your name, office, funders, document checklist and access-code prefix are configured for you, with a training hospital to practise in. Nothing to install.' },
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

// Each form field's input id, so an error can point at it.
const FIELD_ID = {
  hospitalName: 'fh-name', nhfrCode: 'fh-nhfr', hospitalType: 'fh-type', region: 'fh-region', province: 'fh-province', city: 'fh-city',
  officialPhone: 'fh-phone', officialEmail: 'fh-oemail', contactName: 'fh-contact', contactPosition: 'fh-position',
  email: 'fh-email', signatoryName: 'fh-sig', signatoryPosition: 'fh-sigpos',
  certifiedAuthority: 'fh-cert', privacyConsent: 'fh-privacy',
}

function Field({ id, label, hint, required, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[13.5px] font-semibold text-gray-700 mb-1.5">
        {label}{required && <span className="text-red-500" aria-hidden="true"> *</span>}
      </label>
      {children}
      {error && <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}
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
  // Ownership starts unchosen so a private or LGU hospital doesn't send the
  // default by mistake (and get the wrong signer hint).
  hospitalName: '', hospitalType: '', nhfrCode: '', province: '', city: '', region: '',
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

// Every problem in the form, in page order: [{ field, message }]. A message
// that covers two fields is attached to the first one that is wrong.
export function validateFields(d) {
  const out = []
  const add = (field, message) => out.push({ field, message })
  if (d.hospitalName.length < 3) add('hospitalName', 'Enter the hospital name as it appears on its DOH License to Operate.')
  if (d.nhfrCode.length < 3) add('nhfrCode', 'Enter the hospital’s NHFR facility code.')
  if (!OWNERSHIP_TYPES.some(o => o.value === d.hospitalType)) add('hospitalType', 'Choose the hospital’s ownership.')
  if (!PH_REGIONS.includes(d.region)) add('region', 'Choose the region.')
  if (d.province.length < 2 || d.city.length < 2) add(d.province.length < 2 ? 'province' : 'city', 'Enter the province and the city or municipality.')
  if (d.officialPhone.replace(/\D/g, '').length < 7) add('officialPhone', 'Enter the hospital’s official phone number.')
  if (!EMAIL_RE.test(d.officialEmail)) add('officialEmail', 'Enter the hospital’s official email address.')
  if (d.contactName.length < 2 || d.contactPosition.length < 2) add(d.contactName.length < 2 ? 'contactName' : 'contactPosition', 'Enter the requesting officer’s name and position.')
  if (!EMAIL_RE.test(d.email)) add('email', 'Enter the requesting officer’s email address.')
  if (d.signatoryName.length < 2 || d.signatoryPosition.length < 2) add(d.signatoryName.length < 2 ? 'signatoryName' : 'signatoryPosition', 'Enter the name and position of the head of facility who will sign.')
  if (!d.certifiedAuthority) add('certifiedAuthority', 'Confirm that you are authorized to submit this request.')
  if (!d.privacyConsent) add('privacyConsent', 'Confirm that you have read the privacy notice.')
  return out
}

// The first problem in the form, or ''.
export function validateRequest(d) {
  return validateFields(d)[0]?.message ?? ''
}

export default function ForHospitals() {
  const [form, setForm] = useState(EMPTY)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(null) // { referenceNo, officialEmail }
  const [error, setError] = useState('')
  const [problems, setProblems] = useState([]) // [{ field, message }] from the last submit
  const summaryRef = useRef(null)

  const errorFor = (k) => problems.find(p => p.field === k)?.message
  // Fixing a field clears its message; the rest stay until the next submit.
  const clear = (k) => setProblems(ps => ps.some(p => p.field === k) ? ps.filter(p => p.field !== k) : ps)
  const set = (k) => (e) => { setForm((p) => ({ ...p, [k]: e.target.value })); clear(k) }
  const tick = (k) => (e) => { setForm((p) => ({ ...p, [k]: e.target.checked })); clear(k) }
  const toggleFunder = (f) => setForm((p) => ({ ...p, funders: p.funders.includes(f) ? p.funders.filter(x => x !== f) : [...p.funders, f] }))
  const signer = form.hospitalType ? ownershipOf(form.hospitalType) : null

  // Address dropdowns: "Other (not listed)" switches a field to typing.
  const [provinceOther, setProvinceOther] = useState(false)
  const [cityOther, setCityOther] = useState(false)
  const cityList = provinceOther ? null : citiesFor(form.region, form.province)
  const chooseRegion = (e) => {
    setForm((p) => ({ ...p, region: e.target.value, province: '', city: '' }))
    setProvinceOther(false); setCityOther(false); clear('region')
  }
  const chooseProvince = (e) => {
    const other = e.target.value === OTHER
    setForm((p) => ({ ...p, province: other ? '' : e.target.value, city: '' }))
    setProvinceOther(other); setCityOther(false); clear('province')
  }
  const chooseCity = (e) => {
    const other = e.target.value === OTHER
    setForm((p) => ({ ...p, city: other ? '' : e.target.value }))
    setCityOther(other); clear('city')
  }

  // Accessible props for a required input: required, invalid, and pointing at its message.
  const a11y = (k) => {
    const id = FIELD_ID[k]
    const bad = !!errorFor(k)
    return { required: true, 'aria-invalid': bad || undefined, 'aria-describedby': bad ? `${id}-error` : undefined }
  }

  const focusField = (field) => (e) => {
    e.preventDefault()
    const el = document.getElementById(FIELD_ID[field])
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el?.focus({ preventScroll: true })
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const data = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]))
    const found = validateFields(data)
    setProblems(found)
    if (found.length) {
      // Move to the summary at the top of the form, which links to each field.
      requestAnimationFrame(() => {
        summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        summaryRef.current?.focus({ preventScroll: true })
      })
      return
    }
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
      setSent({ referenceNo, officialEmail: data.officialEmail })
      window.scrollTo({ top: 0 })
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
    <div className="min-h-screen bg-canvas text-gray-900 flex flex-col">
      <header className="border-b border-gray-200/70 bg-canvas/90 backdrop-blur sticky top-0 z-20 print:hidden">
        <div className="max-w-[1180px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo size={30} />
            <span className="font-display text-lg font-bold text-brand-900">MAPA</span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-4 text-sm font-semibold">
            <Link to="/" className="inline-flex min-h-[44px] items-center px-2 text-gray-600 hover:text-brand-700">For patients</Link>
            <Link to="/login" className="inline-flex min-h-[44px] items-center px-2 text-brand-600 hover:text-brand-700">Staff log in →</Link>
          </nav>
        </div>
      </header>

      {sent ? (
        // ── Acknowledgement — replaces the page, so the reference is the first thing seen ──
        <section className="flex-1 max-w-[1180px] w-full mx-auto px-4 sm:px-8 py-12 sm:py-16">
          <div className="rounded-3xl border border-gray-200/80 bg-white p-6 sm:p-10 max-w-2xl mx-auto">
            <MdCheckCircle size={44} className="text-brand-500" />
            <h1 className="font-display text-2xl font-bold text-brand-900 mt-3">Request received</h1>
            <p className="text-sm text-gray-600 mt-2">Reference number</p>
            <p className="font-mono text-2xl font-bold text-gray-900 tracking-wide">{sent.referenceNo}</p>
            {/* The reference is shown only here (nothing is emailed yet), and the
                letter of intent must quote it — so say so plainly. */}
            <p className="mt-4 flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 print:hidden">
              <MdWarningAmber size={18} className="mt-0.5 flex-shrink-0 text-amber-600" aria-hidden="true" />
              Print this page or write the reference number down before you leave. It is not sent by email, and your letter of intent must quote it.
            </p>
            <ol className="mt-6 space-y-3 text-sm text-gray-700 list-decimal pl-5">
              <li>Send a <strong>letter of intent</strong> signed by the head of facility, addressed to the MAPA Network Operator and quoting <span className="font-mono">{sent.referenceNo}</span>{ORG.contactEmail ? <>, to <EmailLink email={ORG.contactEmail} subject={`Letter of intent — ${sent.referenceNo}`} className="font-semibold text-brand-700 underline break-all" /></> : null}.</li>
              <li>Within <strong>{RESPONSE_WORKING_DAYS} working days</strong>, the network team will check your facility in the DOH National Health Facility Registry and call your hospital on the official number listed there.</li>
              <li>We will then send the agreement documents to <span className="break-all">{sent.officialEmail}</span>.</li>
            </ol>
            <div className="mt-7 flex flex-wrap gap-2 print:hidden">
              <button type="button" className="btn-secondary inline-flex items-center gap-1.5 min-h-[44px]" onClick={() => window.print()}><MdPrint size={16} /> Print acknowledgement</button>
              <Link to="/" className="btn-secondary inline-flex items-center min-h-[44px]">Back to home</Link>
            </div>
          </div>
        </section>
      ) : (
        <>
          <main className="print:hidden">
            {/* ── 1 · Intro ── */}
            <section className="max-w-[1180px] mx-auto px-4 sm:px-8 pt-10 sm:pt-16 grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:gap-14 items-start">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-white px-3.5 py-1.5 text-xs font-semibold text-brand-700">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-400" />For hospitals, Malasakit Centers and social-services offices
                </span>
                <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-brand-900 mt-5 leading-[1.05]">Request to join the MAPA network</h1>
                <p className="text-[17px] leading-relaxed text-gray-600 mt-5 max-w-2xl">
                  MAPA lets your social-services office receive, verify, assess and endorse medical assistance requests online,
                  in a workflow modelled on the RA 11463 one-stop shop, with your patients’ records kept to your hospital.
                </p>
                <a href="#request" className="btn-primary mt-7 inline-flex min-h-[48px] px-6 items-center gap-2">Start the request <MdArrowForward size={18} /></a>
              </div>
              <aside className="rounded-2xl border border-gray-200/80 bg-white p-6">
                <h2 className="font-semibold text-brand-900">At a glance</h2>
                <ul className="mt-3 space-y-2.5 text-sm text-gray-700">
                  <li className="flex gap-2"><MdCheckCircle size={17} className="mt-0.5 flex-shrink-0 text-green-600" aria-hidden="true" />No cost to the hospital to join, and no purchase obligation</li>
                  <li className="flex gap-2"><MdCheckCircle size={17} className="mt-0.5 flex-shrink-0 text-green-600" aria-hidden="true" />Patients never pay</li>
                  <li className="flex gap-2"><MdCheckCircle size={17} className="mt-0.5 flex-shrink-0 text-green-600" aria-hidden="true" />The request takes about 10 minutes; have your NHFR facility code ready</li>
                  <li className="flex gap-2"><MdCheckCircle size={17} className="mt-0.5 flex-shrink-0 text-green-600" aria-hidden="true" />We reply within {RESPONSE_WORKING_DAYS} working days after checking the DOH registry</li>
                </ul>
              </aside>
            </section>

            {/* ── 2 · What your hospital gets — before the paperwork ── */}
            <section className="max-w-[1180px] mx-auto px-4 sm:px-8 mt-14">
              <h2 className="font-display text-2xl font-bold text-brand-900">What your hospital gets</h2>
              <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {FEATURES.map(({ icon: Icon, title, body }) => (
                  <li key={title} className="rounded-2xl border border-gray-200/80 bg-white p-5">
                    <span aria-hidden="true" className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Icon size={18} /></span>
                    <p className="font-semibold text-brand-900 mt-3">{title}</p>
                    <p className="text-sm leading-relaxed text-gray-600 mt-1">{body}</p>
                  </li>
                ))}
              </ul>
            </section>

            {/* ── 3 · How joining works ── */}
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

            {/* ── 4 · Prepare: what you'll need · who signs ── */}
            <section className="max-w-[1180px] mx-auto px-4 sm:px-8 mt-14">
              <h2 className="font-display text-2xl font-bold text-brand-900">What to prepare</h2>
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-gray-200/80 bg-white p-6">
                  <h3 className="font-semibold text-brand-900">What your hospital will need</h3>
                  <ul className="mt-3 space-y-2">
                    {NEEDS.map(n => (
                      <li key={n} className="flex gap-2 text-sm text-gray-700"><MdCheckCircle size={16} className="mt-0.5 flex-shrink-0 text-brand-500" aria-hidden="true" />{n}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl border border-gray-200/80 bg-white p-6">
                  <h3 className="font-semibold text-brand-900">Who signs the agreement</h3>
                  <p className="mt-1 text-sm text-gray-500">For example:</p>
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
            </section>
          </main>

          {/* ── 5 · The request form (its own wide section) ── */}
          <section id="request" className="scroll-mt-20 max-w-[1180px] w-full mx-auto px-4 sm:px-8 mt-16 pb-16 print:hidden">
            <form onSubmit={submit} noValidate>
              <div className="max-w-2xl">
                <h2 className="font-display text-3xl font-bold text-brand-900">Request form</h2>
                <p className="text-[15px] text-gray-600 mt-2">
                  Fields marked <span className="text-red-500">*</span> are required. Your hospital is verified against the DOH registry before any agreement.
                </p>
              </div>

              {/* Error summary: every problem at once, each linking to its field. */}
              {problems.length > 0 && (
                <div ref={summaryRef} tabIndex={-1} role="alert" aria-labelledby="fh-summary-title"
                  className="mt-6 max-w-2xl scroll-mt-24 rounded-xl border border-red-200 bg-red-50 px-4 py-3 outline-none focus:ring-2 focus:ring-red-300">
                  <p id="fh-summary-title" className="text-sm font-semibold text-red-800">
                    {problems.length === 1 ? 'One thing needs fixing before you can submit:' : `${problems.length} things need fixing before you can submit:`}
                  </p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {problems.map(p => (
                      <li key={p.field}>
                        <a href={`#${FIELD_ID[p.field]}`} onClick={focusField(p.field)} className="text-red-700 underline underline-offset-2 hover:text-red-900">{p.message}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-8">
                <Section n={1} title="Facility" desc="As written on your DOH License to Operate. We use these to find the hospital in the DOH National Health Facility Registry.">
                  <Field id="fh-name" label="Hospital name (as on the DOH License to Operate)" required error={errorFor('hospitalName')}>
                    <input id="fh-name" className="input" maxLength={150} value={form.hospitalName} onChange={set('hospitalName')} autoComplete="organization" {...a11y('hospitalName')} />
                  </Field>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <Field id="fh-nhfr" label="NHFR facility code" required error={errorFor('nhfrCode')} hint="On your DOH License to Operate; also your DOH online-licensing username.">
                      <input id="fh-nhfr" className="input font-mono" maxLength={30} value={form.nhfrCode} onChange={set('nhfrCode')} {...a11y('nhfrCode')} />
                    </Field>
                    <Field id="fh-type" label="Ownership" required error={errorFor('hospitalType')}>
                      <select id="fh-type" className="input" value={form.hospitalType} onChange={set('hospitalType')} {...a11y('hospitalType')}>
                        <option value="" disabled>Choose…</option>
                        {OWNERSHIP_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </Field>
                  </div>
                  {/* Region → province → city as dropdowns (2026-11-25). Every
                      province has a list; a city list exists for BARMM and
                      Metro Manila, so elsewhere the city is typed. "Other
                      (not listed)" opens a typed field (e.g. Sulu, whose
                      region is unsettled). */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                    <Field id="fh-region" label="Region" required error={errorFor('region')}>
                      <select id="fh-region" className="input" value={form.region} onChange={chooseRegion} {...a11y('region')}>
                        <option value="" disabled>Choose…</option>
                        {PH_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </Field>
                    <Field id="fh-province" label="Province" required error={errorFor('province')}>
                      <select id="fh-province" className="input" disabled={!form.region}
                        value={provinceOther ? OTHER : form.province} onChange={chooseProvince} {...a11y('province')}>
                        <option value="" disabled>{form.region ? 'Choose…' : 'Choose the region first'}</option>
                        {(PROVINCES_BY_REGION[form.region] ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
                        <option value={OTHER}>Other (not listed)</option>
                      </select>
                      {provinceOther && (
                        <input className="input mt-2" maxLength={80} placeholder="Type the province" aria-label="Province (not listed)"
                          value={form.province} onChange={set('province')} />
                      )}
                    </Field>
                    <Field id="fh-city" label="City / municipality" required error={errorFor('city')}>
                      {cityList ? (
                        <>
                          <select id="fh-city" className="input" value={cityOther ? OTHER : form.city} onChange={chooseCity} {...a11y('city')}>
                            <option value="" disabled>Choose…</option>
                            {cityList.map((c) => <option key={c} value={c}>{c}</option>)}
                            <option value={OTHER}>Other (not listed)</option>
                          </select>
                          {cityOther && (
                            <input className="input mt-2" maxLength={80} placeholder="Type the city or municipality" aria-label="City or municipality (not listed)"
                              value={form.city} onChange={set('city')} />
                          )}
                        </>
                      ) : (
                        <input id="fh-city" className="input" maxLength={80} value={form.city} onChange={set('city')}
                          disabled={!form.province && !provinceOther}
                          placeholder={form.province || provinceOther ? 'Type the city or municipality' : 'Choose the province first'}
                          {...a11y('city')} />
                      )}
                    </Field>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <Field id="fh-phone" label="Hospital official phone" required error={errorFor('officialPhone')}>
                      <input id="fh-phone" type="tel" className="input" maxLength={40} value={form.officialPhone} onChange={set('officialPhone')} autoComplete="tel" {...a11y('officialPhone')} />
                    </Field>
                    <Field id="fh-oemail" label="Hospital or office official email" required error={errorFor('officialEmail')}>
                      <input id="fh-oemail" type="email" className="input" maxLength={200} value={form.officialEmail} onChange={set('officialEmail')} {...a11y('officialEmail')} />
                    </Field>
                  </div>
                </Section>

                <Section n={2} title="Requesting office" desc="The office and officer submitting this request. We contact this person about next steps.">
                  <Field id="fh-office" label="Office" required>
                    <select id="fh-office" className="input sm:max-w-xs" value={form.requestingOffice} onChange={set('requestingOffice')} required>
                      {OFFICES.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </Field>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <Field id="fh-contact" label="Requesting officer" required error={errorFor('contactName')}>
                      <input id="fh-contact" className="input" maxLength={120} value={form.contactName} onChange={set('contactName')} autoComplete="name" {...a11y('contactName')} />
                    </Field>
                    <Field id="fh-position" label="Position" required error={errorFor('contactPosition')}>
                      <input id="fh-position" className="input" maxLength={120} value={form.contactPosition} onChange={set('contactPosition')} placeholder="e.g. Head, Medical Social Service" {...a11y('contactPosition')} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <Field id="fh-email" label="Officer’s email" required error={errorFor('email')}>
                      <input id="fh-email" type="email" className="input" maxLength={200} value={form.email} onChange={set('email')} autoComplete="email" {...a11y('email')} />
                    </Field>
                    <Field id="fh-cphone" label="Officer’s direct number">
                      <input id="fh-cphone" type="tel" className="input" maxLength={40} value={form.contactPhone} onChange={set('contactPhone')} />
                    </Field>
                  </div>
                </Section>

                <Section n={3} title="Head of facility" desc="The person who will sign the Memorandum of Agreement for the hospital.">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <Field id="fh-sig" label="Name" required error={errorFor('signatoryName')}>
                      <input id="fh-sig" className="input" maxLength={120} value={form.signatoryName} onChange={set('signatoryName')} {...a11y('signatoryName')} />
                    </Field>
                    <Field id="fh-sigpos" label="Position" required error={errorFor('signatoryPosition')}>
                      <input id="fh-sigpos" className="input" maxLength={120} value={form.signatoryPosition} onChange={set('signatoryPosition')} placeholder="e.g. Chief of Hospital" {...a11y('signatoryPosition')} />
                    </Field>
                  </div>
                  {signer && <p className="text-sm text-gray-500">For this ownership ({signer.label}), the agreement is usually signed by: <span className="text-gray-700">{signer.signer}</span>.</p>}
                </Section>

                <Section n={4} title="Current medical assistance" desc="Optional. Helps us link the funding agencies your office already works with.">
                  <fieldset>
                    <legend className="text-[13.5px] font-semibold text-gray-700 mb-2">Funders your office works with</legend>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                      {FUNDERS.map((f) => (
                        <label key={f} className="flex items-center gap-3 text-sm text-gray-700 cursor-pointer min-h-[44px]">
                          <input type="checkbox" className="h-5 w-5 accent-brand-500" checked={form.funders.includes(f)} onChange={() => toggleFunder(f)} /> {f}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="flex items-center gap-3 text-sm text-gray-700 cursor-pointer min-h-[44px]">
                    <input type="checkbox" className="h-5 w-5 accent-brand-500" checked={form.malasakitOnSite} onChange={tick('malasakitOnSite')} /> The hospital has a Malasakit Center on site
                  </label>
                  <Field id="fh-msg" label="Other information">
                    <textarea id="fh-msg" className="input min-h-[96px]" maxLength={2000} value={form.message} onChange={set('message')} />
                  </Field>
                </Section>

                <Section n={5} title="Declarations" desc="Required before submitting.">
                  <div>
                    <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer min-h-[44px] py-1">
                      <input id="fh-cert" type="checkbox" className="mt-0.5 h-5 w-5 flex-shrink-0 accent-brand-500" checked={form.certifiedAuthority} onChange={tick('certifiedAuthority')} {...a11y('certifiedAuthority')} />
                      <span>I am authorized by the head of facility to submit this request on behalf of the hospital, and the information above is true and correct.<span className="text-red-500" aria-hidden="true"> *</span></span>
                    </label>
                    {errorFor('certifiedAuthority') && <p id="fh-cert-error" className="ml-8 text-xs font-medium text-red-600">{errorFor('certifiedAuthority')}</p>}
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-[13px] leading-relaxed text-gray-600">
                    <p className="font-semibold text-gray-700">Privacy notice (RA 10173)</p>
                    <p className="mt-1">
                      The MAPA network operator collects the names, positions and work contact details above, and the facility details, only to evaluate this request,
                      verify the facility and contact your office about joining. They are seen only by the network team. If the hospital joins, they become part of its
                      onboarding record; if the request is declined or withdrawn, they are deleted one year after the last action.
                      You may ask to access, correct or delete them{ORG.contactEmail ? <> by writing to <EmailLink email={ORG.contactEmail} className="underline break-all" /></> : null}.
                    </p>
                  </div>
                  <div>
                    <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer min-h-[44px] py-1">
                      <input id="fh-privacy" type="checkbox" className="mt-0.5 h-5 w-5 flex-shrink-0 accent-brand-500" checked={form.privacyConsent} onChange={tick('privacyConsent')} {...a11y('privacyConsent')} />
                      <span>I have read the privacy notice and agree to these details being processed for this request.<span className="text-red-500" aria-hidden="true"> *</span></span>
                    </label>
                    {errorFor('privacyConsent') && <p id="fh-privacy-error" className="ml-8 text-xs font-medium text-red-600">{errorFor('privacyConsent')}</p>}
                  </div>
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
          </section>
        </>
      )}

      {/* ── 6 · Footer ── */}
      <footer className="mt-auto bg-brand-900 text-white px-4 sm:px-8 py-8 print:hidden">
        <div className="max-w-[1180px] mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Logo size={28} />
            <div>
              <p className="text-sm font-bold">MAPA</p>
              <p className="text-xs text-brand-200/80">Medical Assistance Portal Access</p>
            </div>
          </div>
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-brand-100/80">
            <li><Link to="/" className="inline-flex min-h-[44px] items-center hover:text-white">For patients</Link></li>
            <li><Link to="/login" className="inline-flex min-h-[44px] items-center hover:text-white">Staff log in</Link></li>
            {ORG.contactEmail && <li className="break-all">Contact: {displayEmail(ORG.contactEmail)}</li>}
            <li>© {new Date().getFullYear()} MAPA</li>
          </ul>
        </div>
      </footer>
    </div>
  )
}
