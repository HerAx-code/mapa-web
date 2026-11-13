/* eslint-disable i18next/no-literal-string -- IntakeWizard keeps its English +
   Filipino copy co-located as inline pairs and renders ONE of them via L()
   according to the active EN/FIL toggle (i18n.language), like the rest of the
   app shows a single language. The literals are the translations themselves, so
   the no-literal-string rule (which assumes untranslated text) doesn't apply;
   a file-level disable is cleaner than per-string exemptions. */
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { ORG } from '../../config/org'
import SearchableSelect from '../../components/ui/SearchableSelect'
import { useAuth } from '../../contexts/AuthContext'
import Layout from '../../components/Layout'
import {
  blankSheet, EMPTY_FAMILY_MEMBER, RELATIONSHIPS, EXPENSE_FIELDS, MAX_HOUSEHOLD_OTHERS,
  SHORTFALL_SOURCES, EXPENSE_DOUBLE_CHECK_RATIO, expenseTotal, monthlyShortfall, expensesLookMistyped,
  FACT_SECTIONS, sectionVerification,
} from '../../utils/intakeSheet'
import {
  validateIntakeStep, validateIntakeAll, memberHasData, othersFromHouseholdSize, todayIso,
} from '../../utils/intakeValidation'
import {
  MdArrowBack, MdArrowForward, MdCheckCircle, MdGroups,
  MdWork, MdReceipt, MdMedicalServices, MdAdd, MdRemove,
} from 'react-icons/md'
import toast from 'react-hot-toast'

// Patient-facing Household Information wizard. A deliberately simple,
// large-text, one-step-at-a-time, inline-bilingual flow for elderly /
// low-literacy users. Writes only the FACTUAL portion of intakeSheet to the
// patient's request; the gateway social worker adds the assessment separately.

// Pick one language from an inline en/fil pair, following the active EN/FIL
// toggle. Filipino locales start with 'fil' (react-i18next); everything else
// (en, en-US, …) takes English.
const pick = (lang, en, fil) => (lang && lang.toLowerCase().startsWith('fil') ? fil : en)

// Single-language question label, following the toggle. When `htmlFor` is given
// Q renders as a real <label> tied to that input id so the question text becomes
// the field's accessible name (a11y: WCAG 1.3.1 / 4.1.2); section-heading uses
// omit htmlFor and stay a <div>.
function Q({ en, fil, required, htmlFor }) {
  const { i18n } = useTranslation()
  const content = (
    <span className="block text-lg font-semibold text-gray-900 leading-snug">
      {/* Non-breaking space keeps the * on the same line as the last word. */}
      {pick(i18n.language, en, fil)}{required && <>{' '}<span className="text-red-500" aria-hidden="true">*</span></>}
    </span>
  )
  return htmlFor
    ? <label htmlFor={htmlFor} className="mb-2 block">{content}</label>
    : <div className="mb-2">{content}</div>
}

// Smaller field label for the inputs inside a household-member card, so the
// step's main question stays the most prominent text on screen.
function SubQ({ en, fil, required, htmlFor }) {
  const { i18n } = useTranslation()
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-base font-medium text-gray-800">
      {pick(i18n.language, en, fil)}{required && <>{' '}<span className="text-red-500" aria-hidden="true">*</span></>}
    </label>
  )
}

// Make SearchableSelect's trigger the same height/size as the text inputs.
const selectTriggerCls = '!rounded-xl !px-4 !py-3 !text-base'

const EMPLOYMENT = [
  { value: '',              en: 'Select…',        fil: 'Pumili…' },
  { value: 'employed',      en: 'Employed',       fil: 'May trabaho' },
  { value: 'self-employed', en: 'Self-employed',  fil: 'May sariling hanapbuhay' },
  { value: 'unemployed',    en: 'Unemployed',     fil: 'Walang trabaho' },
  { value: 'retired',       en: 'Retired',        fil: 'Retirado' },
  { value: 'other',         en: 'Other',          fil: 'Iba pa' },
]

const STEPS = [
  { key: 'family',   Icon: MdGroups,          en: 'Your household',     fil: 'Ang inyong sambahayan' },
  { key: 'income',   Icon: MdWork,            en: 'Income & work',      fil: 'Kita at trabaho' },
  { key: 'expenses', Icon: MdReceipt,         en: 'Monthly expenses',   fil: 'Buwanang gastusin' },
  { key: 'medical',  Icon: MdMedicalServices, en: 'Medical details',    fil: 'Detalye ng sakit' },
  { key: 'review',   Icon: MdCheckCircle,     en: 'Review & save',      fil: 'Suriin at i-save' },
]

const inputCls = 'w-full text-base rounded-xl border border-gray-200 px-4 py-3 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none'
// Applied when validation jumps the patient back to a step -- visually
// pinpoints WHICH required field is missing, since the toast alone
// doesn't make that obvious on the small "back to step 0" round trip.
const inputErrCls = 'border-red-400 ring-2 ring-red-100'

// DOM id for a validation field key ('member.2.age' -> 'iw-member-2-age'), so
// the flagged input can be scrolled to and focused — including SearchableSelect,
// which takes an id but no ref.
const fieldId = (field) => `iw-${field.replace(/\./g, '-')}`

// Firestore stores blank numbers as null; inputs need '' (a null value prop
// makes React treat the input as uncontrolled).
const blankIfNull = (v) => (v == null ? '' : v)

// Shape a stored intake for the form: nulls -> '', member rows padded to the
// "people who live with you" count. Rows are never trimmed here — a stored
// sheet with more rows than the count shows them all, and validation asks the
// patient to make the two match.
function hydrateSheet(stored) {
  const base = { ...blankSheet(), ...(stored ?? {}) }
  for (const k of ['householdSize', 'monthlyIncome', 'estimatedTotalCost']) base[k] = blankIfNull(base[k])
  base.expenses = Object.fromEntries(
    Object.entries({ ...blankSheet().expenses, ...(base.expenses ?? {}) }).map(([k, v]) => [k, blankIfNull(v)])
  )
  const members = (base.familyMembers ?? []).filter(memberHasData).map(m => ({
    ...EMPTY_FAMILY_MEMBER, ...m, age: blankIfNull(m.age), monthlyContribution: blankIfNull(m.monthlyContribution),
  }))
  const others = othersFromHouseholdSize(base.householdSize)
  while (others !== '' && members.length < others) members.push({ ...EMPTY_FAMILY_MEMBER })
  base.familyMembers = members
  return base
}

export default function IntakeWizard() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { i18n } = useTranslation()
  // One language at a time, following the header's EN/FIL toggle.
  const L = (en, fil) => pick(i18n.language, en, fil)

  const [request, setRequest] = useState(null)
  const [sheet, setSheet]     = useState(() => blankSheet())
  const [step, setStep]       = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  // Auto-save indicator state. autoSaving flips during the debounced write
  // (separate from `saving` which drives the explicit "Save and finish
  // later" / Submit buttons). lastSavedAt is the timestamp of the last
  // successful save -- rendered as a small "Saved · 2:45 PM" near the
  // progress bar so the patient sees progress is being preserved.
  const [autoSaving, setAutoSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  // Field name flagged by validation, or null. Drives the red-border state
  // on the matching input + scrolls it into view via ref. Cleared as soon
  // as the patient touches it (via the set() helper).
  const [errorField, setErrorField] = useState(null)
  // What the patient is typing in "how many people live with you". Applied to
  // the sheet (rows added/removed) on blur, not per keystroke — typing "12"
  // must not pass through 1 row and trigger a "remove members?" prompt.
  const [othersDraft, setOthersDraft] = useState('')
  // The social worker locks the answers once the assessment is complete
  // (firestore.rules then rejects patient writes). Live: an unlock by the
  // social worker re-enables the form without a reload.
  const locked = request?.intakeSheet?.factsLocked === true
  // One-shot hydration guard: the onSnapshot listener fires after every save
  // (the save itself triggers a snapshot), so we only seed the form state
  // from Firestore once -- otherwise the patient's in-progress edits would
  // be clobbered on every keystroke-save.
  const hydrated = useRef(false)
  // Debounce timer for auto-save; refreshed on every field change.
  const autoSaveTimer = useRef(null)

  useEffect(() => {
    if (!id) return
    const unsub = onSnapshot(doc(db, 'requests', id), snap => {
      if (!snap.exists()) { toast.error(L('Request not found.', 'Hindi nakita ang kahilingan.')); navigate('/patient/request'); return }
      const data = { id: snap.id, ...snap.data() }
      setRequest(data)
      if (!hydrated.current) {
        const s = hydrateSheet(data.intakeSheet)
        setSheet(s)
        setOthersDraft(String(othersFromHouseholdSize(s.householdSize)))
        hydrated.current = true
      }
      setLoading(false)
    }, () => { setLoading(false); toast.error(L('Failed to load your request.', 'Hindi na-load ang inyong kahilingan.')) })
    return unsub
  }, [id, navigate])

  const clearError = (f) => { if (errorField === f) setErrorField(null) }
  const set = (f) => (e) => {
    clearError(f)
    setSheet(p => ({ ...p, [f]: e.target.value }))
  }
  const setEmployment = (v) => {
    clearError('employmentType')
    // Leaving "Other" discards its description so a stale one isn't saved.
    setSheet(p => ({ ...p, employmentType: v, employmentTypeOther: v === 'other' ? (p.employmentTypeOther ?? '') : '' }))
  }

  // Scroll the flagged field into view + focus the input the moment
  // validation jumps the patient back to a step. Without this, they're
  // dropped at the top of step N looking at a banner and have to scroll
  // to find what's wrong.
  useEffect(() => {
    if (!errorField) return
    const el = document.getElementById(fieldId(errorField))
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.focus?.()
  }, [errorField, step])
  const setExp = (k) => (e) => {
    clearError(`expenses.${k}`)
    // A changed amount needs a fresh "the amounts are correct" confirmation.
    setSheet(p => ({ ...p, _amountsConfirmed: false, expenses: { ...(p.expenses ?? {}), [k]: e.target.value } }))
  }
  const toggleCoverage = (v) => {
    clearError('shortfallCoverage')
    setSheet(p => {
      const cur = p.shortfallCoverage ?? []
      const next = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v]
      return { ...p, shortfallCoverage: next, shortfallCoverageOther: next.includes('other') ? (p.shortfallCoverageOther ?? '') : '' }
    })
  }
  const members = sheet.familyMembers ?? []
  const setMember = (i, f, v) => {
    clearError(`member.${i}.${f}`)
    setSheet(p => {
      const next = [...(p.familyMembers ?? [])]; next[i] = { ...next[i], [f]: v }; return { ...p, familyMembers: next }
    })
  }

  // Apply the "people who live with you" count: exactly that many member rows.
  // Shrinking asks first when it would drop rows the patient already filled in.
  // `value` lets the − / + buttons apply a count immediately; typing applies
  // on blur.
  const commitOthers = (value = othersDraft) => {
    const raw = String(value).trim()
    const n = Number(raw)
    if (raw === '' || !Number.isInteger(n) || n < 0 || n > MAX_HOUSEHOLD_OTHERS) {
      // Leave the rows alone; Next/Submit validation explains the allowed range.
      setSheet(p => ({ ...p, householdSize: '' }))
      return
    }
    const lost = members.slice(n).filter(memberHasData).length
    if (lost > 0 && !window.confirm(L(
      `Remove ${lost} household member${lost === 1 ? '' : 's'} you already entered?`,
      `Alisin ang ${lost} kasaping nailagay na ninyo?`))) {
      setOthersDraft(String(othersFromHouseholdSize(sheet.householdSize)))
      return
    }
    const next = members.slice(0, n)
    while (next.length < n) next.push({ ...EMPTY_FAMILY_MEMBER })
    setOthersDraft(String(n))
    clearError('householdSize')
    setSheet(p => ({ ...p, householdSize: n + 1, familyMembers: next }))
  }

  // Persist the patient's facts onto the request, merging over any existing
  // intake so the gateway assessment fields are never clobbered.
  const toNum = (v) => (v === '' || v == null ? null : Number(v))
  const persist = async () => {
    const payload = {
      ...(request?.intakeSheet ?? {}),
      familyMembers: members.filter(memberHasData).map(m => ({
        name: m.name?.trim() ?? '', relationship: m.relationship ?? '',
        age: toNum(m.age), occupation: m.occupation?.trim() ?? '',
        monthlyContribution: toNum(m.monthlyContribution),
      })),
      householdSize:      toNum(sheet.householdSize),
      monthlyIncome:      toNum(sheet.monthlyIncome),
      employmentType:     sheet.employmentType ?? '',
      employmentTypeOther: sheet.employmentType === 'other' ? (sheet.employmentTypeOther ?? '').trim() : '',
      employer:           sheet.employer ?? '',
      lengthOfEmployment: sheet.lengthOfEmployment ?? '',
      incomeSource:       sheet.incomeSource ?? '',
      expenses: Object.fromEntries(Object.entries(sheet.expenses ?? {}).map(([k, v]) => [k, toNum(v)])),
      // Only meaningful while expenses exceed income; cleared otherwise so a
      // stale answer doesn't linger after the amounts are corrected.
      shortfallCoverage:      monthlyShortfall(sheet) > 0 ? (sheet.shortfallCoverage ?? []) : [],
      shortfallCoverageOther: monthlyShortfall(sheet) > 0 && (sheet.shortfallCoverage ?? []).includes('other')
        ? (sheet.shortfallCoverageOther ?? '').trim() : '',
      diagnosis:          sheet.diagnosis ?? '',
      attendingPhysician: sheet.attendingPhysician ?? '',
      dateOfAdmission:    sheet.dateOfAdmission ?? '',
      estimatedTotalCost: toNum(sheet.estimatedTotalCost),
      patientFilledAt:    serverTimestamp(),
    }
    await updateDoc(doc(db, 'requests', id), { intakeSheet: payload, updatedAt: serverTimestamp() })
  }

  // Auto-save: debounced 2s after the last field change, plus an immediate
  // save when the patient moves between steps. The target audience often
  // works on slow connections and gets interrupted -- losing 4 steps of
  // typed input because they backgrounded the tab for 10 minutes is a
  // real concern. Silent: no toast (would be too noisy). The lastSavedAt
  // indicator near the progress bar tells the patient their work is safe.
  //
  // Gated on:
  //   - hydrated: don't save before initial Firestore load completes
  //     (otherwise we'd write blankSheet() over any existing intake)
  //   - !saving: don't fight a concurrent manual save (saveAndExit/finish)
  useEffect(() => {
    if (!hydrated.current || saving || locked) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(async () => {
      setAutoSaving(true)
      try {
        await persist()
        setLastSavedAt(new Date())
      } catch (err) {
        console.error('[IntakeWizard] auto-save failed:', err)
      } finally {
        setAutoSaving(false)
      }
    }, 2000)
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
    // sheet is the form state; saving the timestamp helpers / id / request
    // don't need to be deps -- persist() reads from closure at fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet])

  // Immediate save on step change so the patient never loses work when
  // Next/Back is tapped, even if the 2s debounce hasn't fired.
  useEffect(() => {
    if (!hydrated.current || saving || locked) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    setAutoSaving(true)
    persist()
      .then(() => setLastSavedAt(new Date()))
      .catch(err => console.error('[IntakeWizard] step-change save failed:', err))
      .finally(() => setAutoSaving(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const saveAndExit = async () => {
    setSaving(true)
    try { await persist(); toast.success(L('Saved. You can finish later.', 'Na-save. Maaari ninyong tapusin mamaya.')); navigate('/patient/request') }
    catch { toast.error(L('Could not save — please try again.', 'Hindi na-save — pakisubukang muli.')) }
    finally { setSaving(false) }
  }

  const flagField = (field, stepIdx, message) => {
    toast.error(message)
    setErrorField(field)
    setStep(stepIdx)
  }

  // Next: the current step must be valid before moving on. A locked sheet is
  // read-only, so Next just pages through it.
  const goNext = () => {
    if (locked) { setStep(s => s + 1); return }
    const e = validateIntakeStep(STEPS[step].key, sheet)
    if (e) { flagField(e.field, step, L(e.en, e.fil)); return }
    setStep(s => s + 1)
  }

  const finish = async () => {
    // Re-check every step: the review's Edit links let patients jump around.
    const e = validateIntakeAll(sheet, STEPS.map(s => s.key))
    if (e) { flagField(e.field, STEPS.findIndex(s => s.key === e.stepKey), L(e.en, e.fil)); return }
    setSaving(true)
    try { await persist(); toast.success(L('Your household information was submitted.', 'Naisumite ang inyong impormasyon ng sambahayan.')); navigate('/patient/request') }
    catch { toast.error(L('Could not save — please try again.', 'Hindi na-save — pakisubukang muli.')) }
    finally { setSaving(false) }
  }

  const cur = STEPS[step]
  const isLast = step === STEPS.length - 1

  // Revision 9c: sections the social worker flagged. Kept in the list after
  // the patient changes them (marked "Updated") so the patient sees progress
  // instead of the note vanishing on the first autosave.
  const corrections = FACT_SECTIONS
    .map(sec => {
      const stored = request?.intakeSheet?.factsVerification?.[sec.key]
      if (stored?.status !== 'needs_correction') return null
      const eff = sectionVerification(request.intakeSheet, sec.key)
      return { ...sec, note: stored.note ?? '', updated: eff.status === 'changed' }
    })
    .filter(Boolean)
  const stepCorrection = corrections.find(c => c.key === cur.key)

  if (loading) {
    return <Layout breadcrumb="Household Information"><div className="p-6 w-full max-w-xl mx-auto"><div className="card p-6 h-48 animate-pulse" /></div></Layout>
  }

  return (
    <Layout breadcrumb={L('Household Information', 'Impormasyon ng Sambahayan')}>
      <div className="px-4 py-5 sm:p-6 w-full max-w-xl mx-auto">

        {/* Header + progress */}
        <button onClick={() => navigate('/patient/request')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600 font-medium mb-3">
          <MdArrowBack size={16} /> {L('Back to my request', 'Bumalik sa kahilingan')}
        </button>
        <div className="flex items-center gap-2 mb-3">
          <cur.Icon className="text-brand-500 flex-shrink-0" size={24} />
          <h1 className="font-display text-xl font-bold text-gray-900">{L(cur.en, cur.fil)}</h1>
        </div>
        <div className="flex items-center gap-1.5 mb-1">
          {STEPS.map((s, i) => (
            <div key={s.key} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-brand-500' : 'bg-gray-200'}`} />
          ))}
        </div>
        <div className="flex items-center justify-between mb-5">
          <p className="text-xs text-gray-500">{L(`Step ${step + 1} of ${STEPS.length}`, `Hakbang ${step + 1} sa ${STEPS.length}`)}</p>
          {/* Tiny auto-save indicator. Stays gentle so it doesn't compete
              with the form -- the patient only needs to know "my work is
              being saved". On error we surface a console log; no toast,
              since the next field change or step navigation retries. */}
          {autoSaving ? (
            <p className="text-xs text-gray-500 italic">{L('Saving…', 'Sine-save…')}</p>
          ) : lastSavedAt ? (
            <p className="text-xs text-gray-500">
              {L('Saved', 'Na-save')} · {lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          ) : null}
        </div>

        {locked && (
          <div className="mb-4 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-base text-brand-900" role="status">
            <p className="font-semibold">{L('Your answers are locked', 'Naka-lock na ang inyong mga sagot')}</p>
            <p className="mt-1 text-sm text-brand-800">
              {L(`${ORG.gatewayName} has finished assessing your request using these answers. If something is wrong, send them a message and they can reopen it for you.`,
                 `Natapos na ng ${ORG.gatewayName} ang pagsusuri gamit ang mga sagot na ito. Kung may mali, padalhan sila ng mensahe at maaari nila itong buksan muli.`)}
            </p>
          </div>
        )}

        {/* Revision 9c: the social worker sent sections back for correction. */}
        {!locked && corrections.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3" role="status">
            <p className="text-base font-semibold text-amber-900">
              {L(`${ORG.gatewayName} asked you to correct some answers`, `Pinapaitama ng ${ORG.gatewayName} ang ilang sagot`)}
            </p>
            <ul className="mt-2 space-y-2">
              {corrections.map(c => (
                <li key={c.key} className="text-sm text-amber-900">
                  <button type="button" onClick={() => setStep(STEPS.findIndex(s => s.key === c.key))}
                    className="font-semibold underline underline-offset-2 hover:text-amber-700 min-h-[44px] sm:min-h-0 text-left">
                    {L(c.en, c.fil)}
                  </button>
                  {c.updated
                    ? <span className="ml-2 inline-flex items-center gap-1 text-green-700"><MdCheckCircle size={14} /> {L('Updated', 'Naitama na')}</span>
                    : c.note && <span className="block text-amber-800">“{c.note}”</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* A disabled fieldset makes every input inside read-only at once. */}
        <fieldset disabled={locked} className="card p-5 space-y-5 min-w-0">
          {stepCorrection && !stepCorrection.updated && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-base text-amber-900">
              <p className="font-semibold">{L('Please correct this part', 'Pakitama ang bahaging ito')}</p>
              {stepCorrection.note && <p className="mt-1 text-sm">“{stepCorrection.note}”</p>}
            </div>
          )}
          {/* ── Family ── */}
          {cur.key === 'family' && (
            <>
              <div>
                <Q en="How many people live with you, not counting yourself?" fil="Ilan ang kasama ninyo sa bahay, hindi kasama ang sarili?" required htmlFor={fieldId('householdSize')} />
                {/* − / + for one-tap changes (members appear immediately);
                    typing still works and applies when the box loses focus. */}
                <div className="flex items-stretch gap-2 max-w-[16rem]">
                  <button type="button"
                    onClick={() => commitOthers(Math.max(0, (Number(othersDraft) || 0) - 1))}
                    disabled={!(Number(othersDraft) > 0)}
                    aria-label={L('One person fewer', 'Bawasan ng isa')}
                    className="min-w-[52px] rounded-xl border border-gray-200 bg-white text-gray-700 inline-flex items-center justify-center hover:bg-gray-50 disabled:opacity-40">
                    <MdRemove size={22} />
                  </button>
                  <input id={fieldId('householdSize')} type="number" min="0" max={MAX_HOUSEHOLD_OTHERS} step="1" inputMode="numeric"
                    className={`${inputCls} text-center text-xl font-semibold tabular-nums ${errorField === 'householdSize' ? inputErrCls : ''}`}
                    value={othersDraft}
                    onChange={e => { clearError('householdSize'); setOthersDraft(e.target.value) }}
                    onBlur={() => commitOthers()}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    placeholder="0" />
                  <button type="button"
                    onClick={() => commitOthers(Math.min(MAX_HOUSEHOLD_OTHERS, (Number(othersDraft) || 0) + 1))}
                    disabled={Number(othersDraft) >= MAX_HOUSEHOLD_OTHERS}
                    aria-label={L('One person more', 'Dagdagan ng isa')}
                    className="min-w-[52px] rounded-xl border border-gray-200 bg-white text-gray-700 inline-flex items-center justify-center hover:bg-gray-50 disabled:opacity-40">
                    <MdAdd size={22} />
                  </button>
                </div>
                <p className="text-sm text-gray-500 mt-2">{L('Enter 0 if you live alone.', 'Ilagay ang 0 kung mag-isa kayo.')}</p>
                {sheet.householdSize !== '' && (
                  <p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800">
                    <MdGroups size={18} className="flex-shrink-0" />
                    {L(`Your household: ${sheet.householdSize} ${sheet.householdSize === 1 ? 'person' : 'people'}, including you`,
                       `Inyong sambahayan: ${sheet.householdSize} tao, kasama kayo`)}
                  </p>
                )}
              </div>
              {members.map((m, i) => {
                const f = (k) => `member.${i}.${k}`
                const errCls = (k) => (errorField === f(k) ? inputErrCls : '')
                const titleId = `iw-member-${i}-title`
                // No overflow-hidden on the card: it would clip the
                // Relationship dropdown's open list. The header rounds its own
                // corners instead.
                return (
                  <section key={i} aria-labelledby={titleId} className="rounded-xl border border-gray-200">
                    <h2 id={titleId} className="flex items-center gap-2.5 rounded-t-xl border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-base font-semibold text-gray-800">
                      <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white" aria-hidden="true">{i + 1}</span>
                      <span className="truncate">{m.name?.trim() || L(`Household member ${i + 1}`, `Kasapi ${i + 1}`)}</span>
                    </h2>
                    <div className="space-y-4 p-4">
                      <div>
                        <SubQ en="Full name" fil="Buong pangalan" required htmlFor={fieldId(f('name'))} />
                        <input id={fieldId(f('name'))} className={`${inputCls} ${errCls('name')}`} autoComplete="off"
                          value={m.name ?? ''} onChange={e => setMember(i, 'name', e.target.value)} />
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div className="sm:col-span-2">
                          <SubQ en="Relationship to you" fil="Kaugnayan sa inyo" required htmlFor={fieldId(f('relationship'))} />
                          <SearchableSelect
                            id={fieldId(f('relationship'))}
                            triggerClassName={selectTriggerCls}
                            searchable={false}
                            error={errorField === f('relationship')}
                            value={m.relationship ?? ''}
                            onChange={v => setMember(i, 'relationship', v)}
                            placeholder={L('Select…', 'Pumili…')}
                            options={RELATIONSHIPS.map(r => ({ value: r.value, label: L(r.en, r.fil) }))} />
                        </div>
                        <div>
                          <SubQ en="Age" fil="Edad" required htmlFor={fieldId(f('age'))} />
                          <input id={fieldId(f('age'))} type="number" min="0" max="120" step="1" inputMode="numeric"
                            className={`${inputCls} ${errCls('age')}`}
                            value={m.age ?? ''} onChange={e => setMember(i, 'age', e.target.value)} />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <SubQ en="Occupation" fil="Trabaho" htmlFor={fieldId(f('occupation'))} />
                          <input id={fieldId(f('occupation'))} className={inputCls}
                            value={m.occupation ?? ''} onChange={e => setMember(i, 'occupation', e.target.value)}
                            placeholder={L('e.g. Driver, Student, None', 'hal. Drayber, Estudyante, Wala')} />
                        </div>
                        <div>
                          <SubQ en="Monthly contribution" fil="Buwanang ambag" htmlFor={fieldId(f('monthlyContribution'))} />
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base">₱</span>
                            <input id={fieldId(f('monthlyContribution'))} type="number" min="0" inputMode="numeric"
                              className={`${inputCls} pl-8 ${errCls('monthlyContribution')}`}
                              value={m.monthlyContribution ?? ''} onChange={e => setMember(i, 'monthlyContribution', e.target.value)} placeholder="0" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                )
              })}
            </>
          )}

          {/* ── Income ── */}
          {cur.key === 'income' && (
            <>
              <div>
                <Q en="About how much does your household earn each month?" fil="Halos magkano ang kinikita ng inyong sambahayan kada buwan?" required htmlFor={fieldId('monthlyIncome')} />
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base">₱</span>
                  <input id={fieldId('monthlyIncome')} type="number" min="0" inputMode="numeric"
                    className={`${inputCls} pl-8 ${errorField === 'monthlyIncome' ? inputErrCls : ''}`}
                    value={sheet.monthlyIncome} onChange={set('monthlyIncome')} placeholder="0" />
                </div>
                <p className="text-sm text-gray-500 mt-1.5">{L('Include what everyone in the household contributes.', 'Isama ang ambag ng lahat sa sambahayan.')}</p>
              </div>
              <div>
                <Q en="Work situation" fil="Kalagayan sa trabaho" required htmlFor={fieldId('employmentType')} />
                <SearchableSelect
                  id={fieldId('employmentType')}
                  triggerClassName={selectTriggerCls}
                  error={errorField === 'employmentType'}
                  value={sheet.employmentType}
                  onChange={setEmployment}
                  options={EMPLOYMENT.map(o => ({ value: o.value, label: L(o.en, o.fil) }))} />
              </div>
              {sheet.employmentType === 'other' && (
                <div>
                  <Q en="Please describe your work situation" fil="Ilarawan ang inyong trabaho" required htmlFor={fieldId('employmentTypeOther')} />
                  <input id={fieldId('employmentTypeOther')}
                    className={`${inputCls} ${errorField === 'employmentTypeOther' ? inputErrCls : ''}`}
                    value={sheet.employmentTypeOther ?? ''} onChange={set('employmentTypeOther')}
                    placeholder={L('e.g. Seasonal farm work, odd jobs', 'hal. Pana-panahong pagsasaka, extra-extra')} />
                </div>
              )}
              <div>
                <Q en="Employer (optional)" fil="Pinapasukan (opsyonal)" htmlFor={fieldId('employer')} />
                <input id={fieldId('employer')} className={inputCls} value={sheet.employer ?? ''} onChange={set('employer')} />
              </div>
              <div>
                <Q en="How long at this work? (optional)" fil="Gaano na katagal sa trabahong ito? (opsyonal)" htmlFor={fieldId('lengthOfEmployment')} />
                <input id={fieldId('lengthOfEmployment')} className={inputCls} value={sheet.lengthOfEmployment ?? ''} onChange={set('lengthOfEmployment')}
                  placeholder={L('e.g. 3 years', 'hal. 3 taon')} />
              </div>
              <div>
                <Q en="Where does the money come from? (optional)" fil="Saan nanggagaling ang pera? (opsyonal)" htmlFor="iw-income-source" />
                <input id="iw-income-source" className={inputCls} value={sheet.incomeSource} onChange={set('incomeSource')} placeholder={L('e.g. Salary, business, pension, remittance', 'hal. Sweldo, negosyo, pension, padala')} />
              </div>
            </>
          )}

          {/* ── Expenses ── */}
          {cur.key === 'expenses' && (
            <>
              <p className="text-sm text-gray-500">{L('About how much do you spend each month? Enter 0 if you don\'t pay for something.', 'Halos magkano ang gastos kada buwan? Ilagay ang 0 kung wala kayong binabayaran dito.')}</p>
              {EXPENSE_FIELDS.map(row => {
                const f = `expenses.${row.key}`
                return (
                  <div key={row.key}>
                    <label htmlFor={fieldId(f)} className="block text-base font-medium text-gray-800">
                      {L(row.en, row.fil)} <span className="text-red-400">*</span>
                    </label>
                    <div className="relative mt-1">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base">₱</span>
                      <input id={fieldId(f)} type="number" min="0" inputMode="numeric"
                        className={`${inputCls} pl-8 ${errorField === f ? inputErrCls : ''}`}
                        value={sheet.expenses?.[row.key] ?? ''} onChange={setExp(row.key)} placeholder="0" />
                    </div>
                  </div>
                )
              })}
              <div className="flex items-baseline justify-between border-t border-gray-100 pt-3">
                <span className="text-base font-medium text-gray-700">{L('Total monthly expenses', 'Kabuuang buwanang gastos')}</span>
                <span className="text-lg font-semibold text-gray-900 tabular-nums">
                  ₱{expenseTotal(sheet).toLocaleString()}
                </span>
              </div>

              {/* Likely typo — confirm, don't block. */}
              {expensesLookMistyped(sheet) && (
                <div className={`rounded-xl border px-4 py-3 ${errorField === 'amountsConfirmed' ? 'border-red-300 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                  <p className="text-base font-medium text-amber-900">
                    {L(`Please double-check: your expenses are more than ${EXPENSE_DOUBLE_CHECK_RATIO} times your household income (₱${Number(sheet.monthlyIncome).toLocaleString()}).`,
                       `Pakisuring muli: ang gastos ay higit sa ${EXPENSE_DOUBLE_CHECK_RATIO} beses ng kita ng sambahayan (₱${Number(sheet.monthlyIncome).toLocaleString()}).`)}
                  </p>
                  <label className="mt-2 flex min-h-[44px] cursor-pointer items-center gap-3 text-base text-gray-800">
                    <input id={fieldId('amountsConfirmed')} type="checkbox" className="h-5 w-5 flex-shrink-0 accent-brand-600"
                      checked={!!sheet._amountsConfirmed}
                      onChange={e => { clearError('amountsConfirmed'); setSheet(p => ({ ...p, _amountsConfirmed: e.target.checked })) }} />
                    {L('The amounts are correct', 'Tama ang mga halaga')}
                  </label>
                </div>
              )}

              {/* Spending more than you earn: ask how, don't block. */}
              {monthlyShortfall(sheet) > 0 && (
                <div className={`rounded-xl border px-4 py-4 space-y-3 ${['shortfallCoverage', 'shortfallCoverageOther'].includes(errorField) ? 'border-red-300 bg-red-50/60' : 'border-gray-200 bg-gray-50'}`}>
                  <div>
                    <p className="text-lg font-semibold text-gray-900 leading-snug">
                      {L('How do you cover the difference?', 'Paano ninyo natutugunan ang kulang?')}{' '}<span className="text-red-500" aria-hidden="true">*</span>
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      {L(`Your expenses are ₱${monthlyShortfall(sheet).toLocaleString()} more than your income each month. Choose all that apply.`,
                         `Mas malaki ng ₱${monthlyShortfall(sheet).toLocaleString()} ang gastos kaysa kita bawat buwan. Piliin lahat ng angkop.`)}
                    </p>
                  </div>
                  <div id={fieldId('shortfallCoverage')} tabIndex={-1} role="group"
                    aria-label={L('How you cover the difference', 'Paano natutugunan ang kulang')} className="space-y-1 outline-none">
                    {SHORTFALL_SOURCES.map(src => (
                      <label key={src.value} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-2 text-base text-gray-800 hover:bg-white">
                        <input type="checkbox" className="h-5 w-5 flex-shrink-0 accent-brand-600"
                          checked={(sheet.shortfallCoverage ?? []).includes(src.value)}
                          onChange={() => toggleCoverage(src.value)} />
                        {L(src.en, src.fil)}
                      </label>
                    ))}
                  </div>
                  {(sheet.shortfallCoverage ?? []).includes('other') && (
                    <div>
                      <SubQ en="How else?" fil="Paano pa?" required htmlFor={fieldId('shortfallCoverageOther')} />
                      <input id={fieldId('shortfallCoverageOther')}
                        className={`${inputCls} ${errorField === 'shortfallCoverageOther' ? inputErrCls : ''}`}
                        value={sheet.shortfallCoverageOther ?? ''} onChange={set('shortfallCoverageOther')} />
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Medical ── */}
          {cur.key === 'medical' && (
            <>
              <div>
                <Q en="What illness or condition needs help?" fil="Anong sakit o kondisyon ang kailangang tulungan?" required htmlFor={fieldId('diagnosis')} />
                <input id={fieldId('diagnosis')}
                  className={`${inputCls} ${errorField === 'diagnosis' ? inputErrCls : ''}`}
                  value={sheet.diagnosis} onChange={set('diagnosis')} placeholder={L('e.g. Pneumonia, kidney disease', 'hal. Pulmonya, sakit sa bato')} />
              </div>
              <div>
                <Q en="Doctor's name (optional)" fil="Pangalan ng doktor (opsyonal)" htmlFor={fieldId('attendingPhysician')} />
                <input id={fieldId('attendingPhysician')} className={inputCls}
                  value={sheet.attendingPhysician ?? ''} onChange={set('attendingPhysician')} />
              </div>
              <div>
                <Q en="When were you admitted? (optional)" fil="Kailan kayo na-admit? (opsyonal)" htmlFor={fieldId('dateOfAdmission')} />
                <input id={fieldId('dateOfAdmission')} type="date" max={todayIso()}
                  className={`${inputCls} ${errorField === 'dateOfAdmission' ? inputErrCls : ''}`}
                  value={sheet.dateOfAdmission} onChange={set('dateOfAdmission')} />
              </div>
              <div>
                <Q en="Estimated total cost, if known (optional)" fil="Tinatayang kabuuang gastos, kung alam (opsyonal)" htmlFor={fieldId('estimatedTotalCost')} />
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base">₱</span>
                  <input id={fieldId('estimatedTotalCost')} type="number" min="0" inputMode="numeric"
                    className={`${inputCls} pl-8 ${errorField === 'estimatedTotalCost' ? inputErrCls : ''}`}
                    value={sheet.estimatedTotalCost} onChange={set('estimatedTotalCost')} placeholder="0" />
                </div>
              </div>
            </>
          )}

          {/* ── Review ── */}
          {cur.key === 'review' && (() => {
            const peso = (v) => v !== '' && v != null ? `₱${Number(v).toLocaleString()}` : '—'
            const emp  = EMPLOYMENT.find(o => o.value === sheet.employmentType)
            const relLabel = (v) => { const r = RELATIONSHIPS.find(x => x.value === v); return r ? L(r.en, r.fil) : (v || '—') }
            const totalExp = EXPENSE_FIELDS.reduce((sum, row) => sum + (Number(sheet.expenses?.[row.key]) || 0), 0)
            const sections = [
              { stepIdx: 0, title: L('Your household', 'Ang inyong sambahayan'), rows: [
                [L('People in household (including you)', 'Tao sa sambahayan (kasama kayo)'), sheet.householdSize || '—'],
                ...members.map((m, i) => [
                  m.name?.trim() || L(`Member ${i + 1}`, `Kasapi ${i + 1}`),
                  [relLabel(m.relationship), m.age !== '' && m.age != null ? L(`${m.age} yrs`, `${m.age} taon`) : null,
                    m.occupation?.trim() || null, m.monthlyContribution !== '' && m.monthlyContribution != null ? peso(m.monthlyContribution) : null,
                  ].filter(Boolean).join(' · '),
                ]),
              ]},
              { stepIdx: 1, title: L('Income & work', 'Kita at trabaho'), rows: [
                [L('Monthly income', 'Buwanang kita'), peso(sheet.monthlyIncome)],
                [L('Work situation', 'Trabaho'), emp?.value
                  ? (emp.value === 'other' && sheet.employmentTypeOther?.trim() ? `${L(emp.en, emp.fil)}: ${sheet.employmentTypeOther.trim()}` : L(emp.en, emp.fil))
                  : '—'],
                [L('Employer', 'Pinapasukan'), sheet.employer || '—'],
                [L('Length of work', 'Tagal sa trabaho'), sheet.lengthOfEmployment || '—'],
                [L('Income source', 'Pinagkukunan'), sheet.incomeSource || '—'],
              ]},
              { stepIdx: 2, title: L('Monthly expenses', 'Buwanang gastusin'), rows: [
                ...EXPENSE_FIELDS.map(row => [L(row.en, row.fil), peso(sheet.expenses?.[row.key])]),
                [L('Total', 'Kabuuan'), `₱${totalExp.toLocaleString()}`],
                ...(monthlyShortfall(sheet) > 0 ? [[
                  L('Difference covered by', 'Kulang ay natutugunan sa'),
                  [...(sheet.shortfallCoverage ?? []).filter(v => v !== 'other').map(v => { const s = SHORTFALL_SOURCES.find(x => x.value === v); return s ? L(s.en, s.fil) : v }),
                    ...((sheet.shortfallCoverage ?? []).includes('other') && sheet.shortfallCoverageOther?.trim() ? [sheet.shortfallCoverageOther.trim()] : []),
                  ].join(', ') || '—',
                ]] : []),
              ]},
              { stepIdx: 3, title: L('Medical', 'Medikal'), rows: [
                [L('Illness', 'Sakit'),                   sheet.diagnosis || '—'],
                [L('Doctor', 'Doktor'),                   sheet.attendingPhysician || '—'],
                [L('Date admitted', 'Petsa ng pag-admit'), sheet.dateOfAdmission || '—'],
                [L('Estimated cost', 'Tinatayang gastos'), peso(sheet.estimatedTotalCost)],
              ]},
            ]
            return (
              <div className="space-y-4 text-sm">
                <p className="text-gray-500">{L('Please check your answers, then tap Submit.', 'Pakitingnan ang inyong mga sagot, pagkatapos ay i-Submit.')}</p>
                {sections.map(section => (
                  <div key={section.title}>
                    <div className="flex items-baseline justify-between mb-1">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{section.title}</p>
                      <button onClick={() => setStep(section.stepIdx)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700">
                        {L('Edit', 'I-edit')}
                      </button>
                    </div>
                    {section.rows.map(([label, val], j) => (
                      <div key={j} className="flex justify-between gap-3 border-b border-gray-50 py-1.5">
                        <span className="text-gray-500">{label}</span>
                        <span className="font-medium text-gray-800 text-right">{val}</span>
                      </div>
                    ))}
                  </div>
                ))}
                <p className="text-xs text-gray-500 pt-2">{L(`${ORG.gatewayName} will review this with you and complete the assessment.`, `Susuriin ito ng ${ORG.gatewayName} kasama kayo.`)}</p>
              </div>
            )
          })()}
        </fieldset>

        {/* Nav buttons — large tap targets */}
        <div className="flex items-center gap-3 mt-5">
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-700 font-medium text-base flex items-center justify-center gap-1.5">
              <MdArrowBack size={18} /> {L('Back', 'Bumalik')}
            </button>
          )}
          {!isLast ? (
            <button onClick={goNext} className="flex-1 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-base flex items-center justify-center gap-1.5">
              {L('Next', 'Susunod')} <MdArrowForward size={18} />
            </button>
          ) : locked ? (
            <button onClick={() => navigate('/patient/request')} className="flex-1 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-base flex items-center justify-center gap-1.5">
              <MdArrowBack size={18} /> {L('Back to my request', 'Bumalik sa kahilingan')}
            </button>
          ) : (
            <button onClick={finish} disabled={saving} className="flex-1 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-base flex items-center justify-center gap-1.5 disabled:opacity-60">
              <MdCheckCircle size={18} /> {saving ? L('Saving…', 'Sine-save…') : L('Submit', 'Isumite')}
            </button>
          )}
        </div>
        {/* Save-and-exit is critical for slow connections / older devices --
            this audience often gets pulled away mid-form. Promoted to a
            visible secondary button instead of the previous low-contrast
            text link. Nothing to save on a locked sheet. */}
        {!locked && (
          <button onClick={saveAndExit} disabled={saving}
            className="w-full min-h-[44px] inline-flex items-center justify-center mt-3 text-sm font-medium text-brand-600 border border-brand-200 bg-brand-50 hover:bg-brand-100 rounded-xl px-4 disabled:opacity-60">
            {L('Save and finish later', 'I-save at tapusin mamaya')}
          </button>
        )}
      </div>
    </Layout>
  )
}
