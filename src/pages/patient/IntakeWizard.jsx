/* eslint-disable i18next/no-literal-string -- IntakeWizard uses the
   inline-bilingual pattern documented in CLAUDE.md ("Use inline
   bilingual labels where possible"). Every English string here is
   followed by " · <Filipino>", which the linter can't recognize as
   already-translated. Per-string exemption would be noisier than
   file-level. */
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import Layout from '../../components/Layout'
import { blankSheet } from '../../utils/intakeSheet'
import {
  MdArrowBack, MdArrowForward, MdCheckCircle, MdAdd, MdDelete, MdGroups,
  MdWork, MdReceipt, MdMedicalServices,
} from 'react-icons/md'
import toast from 'react-hot-toast'

// Patient-facing Household Information wizard. A deliberately simple,
// large-text, one-step-at-a-time, inline-bilingual flow for elderly /
// low-literacy users. Writes only the FACTUAL portion of intakeSheet to the
// patient's request; the CRMC social worker adds the assessment separately.

// Inline-bilingual question label (English + Filipino, always both).
// When `htmlFor` is given, Q renders as a real <label> tied to that input id
// so the bilingual question text becomes the field's accessible name (a11y:
// WCAG 1.3.1 / 4.1.2). Section-heading uses (no associated control) omit
// htmlFor and stay a <div>. Inner text uses block <span> so the <label> holds
// only phrasing content (valid markup).
function Q({ en, fil, required, htmlFor }) {
  const content = (
    <>
      <span className="block text-lg font-semibold text-gray-900 leading-snug">{en} {required && <span className="text-red-400">*</span>}</span>
      <span className="block text-sm text-gray-500 leading-snug">{fil}</span>
    </>
  )
  return htmlFor
    ? <label htmlFor={htmlFor} className="mb-2 block">{content}</label>
    : <div className="mb-2">{content}</div>
}

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

export default function IntakeWizard() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

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
  const errorRef = useRef(null)
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
      if (!snap.exists()) { toast.error('Request not found.'); navigate('/patient/request'); return }
      const data = { id: snap.id, ...snap.data() }
      setRequest(data)
      if (!hydrated.current) {
        setSheet({ ...blankSheet(), ...(data.intakeSheet ?? {}) })
        hydrated.current = true
      }
      setLoading(false)
    }, () => { setLoading(false); toast.error('Failed to load your request.') })
    return unsub
  }, [id, navigate])

  const set = (f) => (e) => {
    if (errorField === f) setErrorField(null)
    setSheet(p => ({ ...p, [f]: e.target.value }))
  }

  // Scroll the flagged field into view + focus the input the moment
  // validation jumps the patient back to a step. Without this, they're
  // dropped at the top of step N looking at a banner and have to scroll
  // to find what's wrong.
  useEffect(() => {
    if (!errorField || !errorRef.current) return
    errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    errorRef.current.focus?.()
  }, [errorField, step])
  const setExp = (k) => (e) => setSheet(p => ({ ...p, expenses: { ...(p.expenses ?? {}), [k]: e.target.value } }))
  const members = sheet.familyMembers ?? []
  const setMember = (i, f, v) => setSheet(p => {
    const next = [...(p.familyMembers ?? [])]; next[i] = { ...next[i], [f]: v }; return { ...p, familyMembers: next }
  })
  const addMember = () => setSheet(p => ({ ...p, familyMembers: [...(p.familyMembers ?? []), { name: '', relationship: '' }] }))
  const removeMember = (i) => setSheet(p => ({ ...p, familyMembers: (p.familyMembers ?? []).filter((_, j) => j !== i) }))

  // Persist the patient's facts onto the request, merging over any existing
  // intake so the CRMC assessment fields are never clobbered.
  const persist = async () => {
    const payload = {
      ...(request?.intakeSheet ?? {}),
      familyMembers: members.filter(m => m.name?.trim() || m.relationship?.trim()),
      householdSize:      sheet.householdSize === '' ? null : Number(sheet.householdSize),
      monthlyIncome:      sheet.monthlyIncome === '' ? null : Number(sheet.monthlyIncome),
      employmentType:     sheet.employmentType ?? '',
      incomeSource:       sheet.incomeSource ?? '',
      expenses: Object.fromEntries(Object.entries(sheet.expenses ?? {}).map(([k, v]) => [k, v === '' ? null : Number(v)])),
      diagnosis:          sheet.diagnosis ?? '',
      attendingPhysician: sheet.attendingPhysician ?? '',
      dateOfAdmission:    sheet.dateOfAdmission ?? '',
      estimatedTotalCost: sheet.estimatedTotalCost === '' ? null : Number(sheet.estimatedTotalCost),
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
    if (!hydrated.current || saving) return
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
    if (!hydrated.current || saving) return
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
    try { await persist(); toast.success('Saved. You can finish later.'); navigate('/patient/request') }
    catch { toast.error('Could not save — please try again.') }
    finally { setSaving(false) }
  }

  const flagField = (field, stepIdx, message) => {
    toast.error(message)
    setErrorField(field)
    setStep(stepIdx)
  }

  const finish = async () => {
    if (!sheet.householdSize || Number(sheet.householdSize) <= 0) { flagField('householdSize', 0, 'Please enter your household size.'); return }
    if (sheet.monthlyIncome === '' || sheet.monthlyIncome == null) { flagField('monthlyIncome', 1, 'Please enter your monthly income.'); return }
    if (!sheet.diagnosis?.trim())                                    { flagField('diagnosis', 3, 'Please enter the illness or condition.'); return }
    setSaving(true)
    try { await persist(); toast.success('Your household information was submitted.'); navigate('/patient/request') }
    catch { toast.error('Could not save — please try again.') }
    finally { setSaving(false) }
  }

  const cur = STEPS[step]
  const isLast = step === STEPS.length - 1

  if (loading) {
    return <Layout breadcrumb="Household Information"><div className="p-6 max-w-xl mx-auto"><div className="card p-6 h-48 animate-pulse" /></div></Layout>
  }

  return (
    <Layout breadcrumb="Household Information">
      <div className="px-4 py-5 sm:p-6 max-w-xl mx-auto">

        {/* Header + progress */}
        <button onClick={() => navigate('/patient/request')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600 font-medium mb-3">
          <MdArrowBack size={16} /> Back to my request · Bumalik
        </button>
        <div className="flex items-center gap-2 mb-1">
          <cur.Icon className="text-brand-500 flex-shrink-0" size={24} />
          <h1 className="font-display text-xl font-bold text-gray-900">{cur.en}</h1>
        </div>
        <p className="text-sm text-gray-500 mb-3">{cur.fil}</p>
        <div className="flex items-center gap-1.5 mb-1">
          {STEPS.map((s, i) => (
            <div key={s.key} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-brand-500' : 'bg-gray-200'}`} />
          ))}
        </div>
        <div className="flex items-center justify-between mb-5">
          <p className="text-xs text-gray-500">Step {step + 1} of {STEPS.length} · Hakbang {step + 1} sa {STEPS.length}</p>
          {/* Tiny auto-save indicator. Stays gentle so it doesn't compete
              with the form -- the patient only needs to know "my work is
              being saved". On error we surface a console log; no toast,
              since the next field change or step navigation retries. */}
          {autoSaving ? (
            <p className="text-xs text-gray-500 italic">Saving…</p>
          ) : lastSavedAt ? (
            <p className="text-xs text-gray-500">
              Saved · {lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          ) : null}
        </div>

        <div className="card p-5 space-y-5">
          {/* ── Family ── */}
          {cur.key === 'family' && (
            <>
              <div>
                <Q en="How many people live in your home, including you?" fil="Ilang tao ang nakatira sa inyong tahanan, kasama kayo?" required htmlFor="iw-household" />
                <input id="iw-household" type="number" min="1" inputMode="numeric"
                  ref={errorField === 'householdSize' ? errorRef : null}
                  className={`${inputCls} ${errorField === 'householdSize' ? inputErrCls : ''}`}
                  value={sheet.householdSize} onChange={set('householdSize')} placeholder="0" />
              </div>
              <div>
                <Q en="Who lives with you? (optional)" fil="Sino ang kasama ninyo? (opsyonal)" />
                <div className="space-y-2">
                  {members.map((m, i) => (
                    <div key={i} className="flex gap-2">
                      <input className={inputCls} aria-label="Family member name · Pangalan" placeholder="Name · Pangalan" value={m.name} onChange={e => setMember(i, 'name', e.target.value)} />
                      <input className={inputCls} aria-label="Relationship · Kaugnayan" placeholder="Relationship · Kaugnayan" value={m.relationship} onChange={e => setMember(i, 'relationship', e.target.value)} />
                      <button onClick={() => removeMember(i)}
                        aria-label="Remove family member"
                        className="text-gray-300 hover:text-red-500 flex-shrink-0 min-w-[44px] min-h-[44px] inline-flex items-center justify-center">
                        <MdDelete size={20} />
                      </button>
                    </div>
                  ))}
                  <button onClick={addMember} className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700">
                    <MdAdd size={18} /> Add a family member · Magdagdag
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── Income ── */}
          {cur.key === 'income' && (
            <>
              <div>
                <Q en="About how much does your household earn each month?" fil="Halos magkano ang kinikita ng inyong sambahayan kada buwan?" required htmlFor="iw-income" />
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base">₱</span>
                  <input id="iw-income" type="number" min="0" inputMode="numeric"
                    ref={errorField === 'monthlyIncome' ? errorRef : null}
                    className={`${inputCls} pl-8 ${errorField === 'monthlyIncome' ? inputErrCls : ''}`}
                    value={sheet.monthlyIncome} onChange={set('monthlyIncome')} placeholder="0" />
                </div>
              </div>
              <div>
                <Q en="Work situation (optional)" fil="Kalagayan sa trabaho (opsyonal)" htmlFor="iw-employment" />
                <select id="iw-employment" className={inputCls} value={sheet.employmentType} onChange={set('employmentType')}>
                  {EMPLOYMENT.map(o => <option key={o.value} value={o.value}>{o.en}{o.value ? ` · ${o.fil}` : ''}</option>)}
                </select>
              </div>
              <div>
                <Q en="Where does the money come from? (optional)" fil="Saan nanggagaling ang pera? (opsyonal)" htmlFor="iw-income-source" />
                <input id="iw-income-source" className={inputCls} value={sheet.incomeSource} onChange={set('incomeSource')} placeholder="e.g. Sweldo, negosyo, pension, padala" />
              </div>
            </>
          )}

          {/* ── Expenses ── */}
          {cur.key === 'expenses' && (
            <>
              <p className="text-sm text-gray-500">Roughly how much do you spend each month? Leave blank if unsure.<br /><span className="text-gray-500">Halos magkano ang gastos kada buwan? Iwanang blanko kung hindi sigurado.</span></p>
              {[
                { k: 'food',      en: 'Food',          fil: 'Pagkain' },
                { k: 'utilities', en: 'Water & power', fil: 'Tubig at kuryente' },
                { k: 'rent',      en: 'Rent',          fil: 'Upa sa bahay' },
                { k: 'medicine',  en: 'Medicine',      fil: 'Gamot' },
              ].map(row => (
                <div key={row.k}>
                  <label htmlFor={`iw-expense-${row.k}`} className="block text-base font-medium text-gray-800">{row.en} <span className="text-gray-500 font-normal">· {row.fil}</span></label>
                  <div className="relative mt-1">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base">₱</span>
                    <input id={`iw-expense-${row.k}`} type="number" min="0" inputMode="numeric" className={`${inputCls} pl-8`} value={sheet.expenses?.[row.k] ?? ''} onChange={setExp(row.k)} placeholder="0" />
                  </div>
                </div>
              ))}
            </>
          )}

          {/* ── Medical ── */}
          {cur.key === 'medical' && (
            <>
              <div>
                <Q en="What illness or condition needs help?" fil="Anong sakit o kondisyon ang kailangang tulungan?" required htmlFor="iw-diagnosis" />
                <input id="iw-diagnosis"
                  ref={errorField === 'diagnosis' ? errorRef : null}
                  className={`${inputCls} ${errorField === 'diagnosis' ? inputErrCls : ''}`}
                  value={sheet.diagnosis} onChange={set('diagnosis')} placeholder="e.g. Pneumonia, kidney disease" />
              </div>
              <div>
                <Q en="When were you admitted? (optional)" fil="Kailan kayo na-admit? (opsyonal)" htmlFor="iw-admission" />
                <input id="iw-admission" type="date" className={inputCls} value={sheet.dateOfAdmission} onChange={set('dateOfAdmission')} />
              </div>
              <div>
                <Q en="Estimated total cost, if known (optional)" fil="Tinatayang kabuuang gastos, kung alam (opsyonal)" htmlFor="iw-cost" />
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base">₱</span>
                  <input id="iw-cost" type="number" min="0" inputMode="numeric" className={`${inputCls} pl-8`} value={sheet.estimatedTotalCost} onChange={set('estimatedTotalCost')} placeholder="0" />
                </div>
              </div>
            </>
          )}

          {/* ── Review ── */}
          {cur.key === 'review' && (() => {
            const peso = (v) => v !== '' && v != null ? `₱${Number(v).toLocaleString()}` : '—'
            const emp  = EMPLOYMENT.find(o => o.value === sheet.employmentType)
            const familyCount = (sheet.familyMembers ?? []).filter(m => m.name?.trim() || m.relationship?.trim()).length
            const sections = [
              { stepIdx: 0, title: 'Your household · Sambahayan', rows: [
                ['Household size · Laki ng sambahayan', sheet.householdSize || '—'],
                ['Family members listed · Nakalistang kasambahay', familyCount > 0 ? `${familyCount}` : '—'],
              ]},
              { stepIdx: 1, title: 'Income & work · Kita at trabaho', rows: [
                ['Monthly income · Buwanang kita', peso(sheet.monthlyIncome)],
                ['Work situation · Trabaho', emp?.value ? `${emp.en} · ${emp.fil}` : '—'],
                ['Income source · Pinagkukunan', sheet.incomeSource || '—'],
              ]},
              { stepIdx: 2, title: 'Monthly expenses · Gastusin', rows: [
                ['Food · Pagkain',           peso(sheet.expenses?.food)],
                ['Water & power · Tubig at kuryente', peso(sheet.expenses?.utilities)],
                ['Rent · Upa',               peso(sheet.expenses?.rent)],
                ['Medicine · Gamot',         peso(sheet.expenses?.medicine)],
              ]},
              { stepIdx: 3, title: 'Medical · Medikal', rows: [
                ['Illness · Sakit',                                 sheet.diagnosis || '—'],
                ['Date admitted · Petsa ng pag-admit',              sheet.dateOfAdmission || '—'],
                ['Estimated cost · Tinatayang gastos',              peso(sheet.estimatedTotalCost)],
              ]},
            ]
            return (
              <div className="space-y-4 text-sm">
                <p className="text-gray-500">Please check your answers, then tap Submit.<br /><span className="text-gray-500">Pakitingnan ang inyong mga sagot, pagkatapos ay i-Submit.</span></p>
                {sections.map(section => (
                  <div key={section.title}>
                    <div className="flex items-baseline justify-between mb-1">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{section.title}</p>
                      <button onClick={() => setStep(section.stepIdx)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700">
                        Edit · I-edit
                      </button>
                    </div>
                    {section.rows.map(([label, val]) => (
                      <div key={label} className="flex justify-between gap-3 border-b border-gray-50 py-1.5">
                        <span className="text-gray-500">{label}</span>
                        <span className="font-medium text-gray-800 text-right">{val}</span>
                      </div>
                    ))}
                  </div>
                ))}
                <p className="text-xs text-gray-500 pt-2">CRMC will review this with you and complete the assessment. · Susuriin ito ng CRMC kasama kayo.</p>
              </div>
            )
          })()}
        </div>

        {/* Nav buttons — large tap targets */}
        <div className="flex items-center gap-3 mt-5">
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-700 font-medium text-base flex items-center justify-center gap-1.5">
              <MdArrowBack size={18} /> Back
            </button>
          )}
          {!isLast ? (
            <button onClick={() => setStep(s => s + 1)} className="flex-1 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-base flex items-center justify-center gap-1.5">
              Next · Susunod <MdArrowForward size={18} />
            </button>
          ) : (
            <button onClick={finish} disabled={saving} className="flex-1 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-base flex items-center justify-center gap-1.5 disabled:opacity-60">
              <MdCheckCircle size={18} /> {saving ? 'Saving…' : 'Submit · Isumite'}
            </button>
          )}
        </div>
        {/* Save-and-exit is critical for slow connections / older devices --
            this audience often gets pulled away mid-form. Promoted to a
            visible secondary button instead of the previous low-contrast
            text link. */}
        <button onClick={saveAndExit} disabled={saving}
          className="w-full min-h-[44px] inline-flex items-center justify-center mt-3 text-sm font-medium text-brand-600 border border-brand-200 bg-brand-50 hover:bg-brand-100 rounded-xl px-4 disabled:opacity-60">
          Save and finish later · I-save at tapusin mamaya
        </button>
      </div>
    </Layout>
  )
}
