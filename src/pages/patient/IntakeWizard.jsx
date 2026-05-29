import { useState, useEffect } from 'react'
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
function Q({ en, fil, required }) {
  return (
    <div className="mb-2">
      <p className="text-lg font-semibold text-gray-900 leading-snug">{en} {required && <span className="text-red-400">*</span>}</p>
      <p className="text-sm text-gray-500 leading-snug">{fil}</p>
    </div>
  )
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

export default function IntakeWizard() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [request, setRequest] = useState(null)
  const [sheet, setSheet]     = useState(() => blankSheet())
  const [step, setStep]       = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const hydrated = useState(() => ({ done: false }))[0]

  useEffect(() => {
    if (!id) return
    const unsub = onSnapshot(doc(db, 'requests', id), snap => {
      if (!snap.exists()) { toast.error('Request not found.'); navigate('/patient/request'); return }
      const data = { id: snap.id, ...snap.data() }
      setRequest(data)
      if (!hydrated.done) {
        setSheet({ ...blankSheet(), ...(data.intakeSheet ?? {}) })
        hydrated.done = true
      }
      setLoading(false)
    }, () => { setLoading(false); toast.error('Failed to load your request.') })
    return unsub
  }, [id, navigate, hydrated])

  const set    = (f) => (e) => setSheet(p => ({ ...p, [f]: e.target.value }))
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

  const saveAndExit = async () => {
    setSaving(true)
    try { await persist(); toast.success('Saved. You can finish later.'); navigate('/patient/request') }
    catch { toast.error('Could not save — please try again.') }
    finally { setSaving(false) }
  }

  const finish = async () => {
    if (!sheet.householdSize || Number(sheet.householdSize) <= 0) { toast.error('Please enter your household size.'); setStep(0); return }
    if (sheet.monthlyIncome === '' || sheet.monthlyIncome == null) { toast.error('Please enter your monthly income.'); setStep(1); return }
    if (!sheet.diagnosis?.trim()) { toast.error('Please enter the illness or condition.'); setStep(3); return }
    setSaving(true)
    try { await persist(); toast.success('Your household information was submitted.'); navigate('/patient/request') }
    catch { toast.error('Could not save — please try again.') }
    finally { setSaving(false) }
  }

  const cur = STEPS[step]
  const isLast = step === STEPS.length - 1

  if (loading) {
    return <Layout breadcrumb="Household Information"><div className="p-6 max-w-xl"><div className="card p-6 h-48 animate-pulse" /></div></Layout>
  }

  return (
    <Layout breadcrumb="Household Information">
      <div className="px-4 py-5 sm:p-6 max-w-xl">

        {/* Header + progress */}
        <button onClick={() => navigate('/patient/request')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600 font-medium mb-3">
          <MdArrowBack size={16} /> Back to my request · Bumalik
        </button>
        <h1 className="text-xl font-bold text-gray-900">{cur.en}</h1>
        <p className="text-sm text-gray-500 mb-3">{cur.fil}</p>
        <div className="flex items-center gap-1.5 mb-1">
          {STEPS.map((s, i) => (
            <div key={s.key} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-brand-500' : 'bg-gray-200'}`} />
          ))}
        </div>
        <p className="text-xs text-gray-400 mb-5">Step {step + 1} of {STEPS.length} · Hakbang {step + 1} sa {STEPS.length}</p>

        <div className="card p-5 space-y-5">
          {/* ── Family ── */}
          {cur.key === 'family' && (
            <>
              <div>
                <Q en="How many people live in your home, including you?" fil="Ilang tao ang nakatira sa inyong tahanan, kasama kayo?" required />
                <input type="number" min="1" inputMode="numeric" className={inputCls} value={sheet.householdSize} onChange={set('householdSize')} placeholder="0" />
              </div>
              <div>
                <Q en="Who lives with you? (optional)" fil="Sino ang kasama ninyo? (opsyonal)" />
                <div className="space-y-2">
                  {members.map((m, i) => (
                    <div key={i} className="flex gap-2">
                      <input className={inputCls} placeholder="Name · Pangalan" value={m.name} onChange={e => setMember(i, 'name', e.target.value)} />
                      <input className={inputCls} placeholder="Relationship · Kaugnayan" value={m.relationship} onChange={e => setMember(i, 'relationship', e.target.value)} />
                      <button onClick={() => removeMember(i)} className="text-gray-300 hover:text-red-500 flex-shrink-0 px-2"><MdDelete size={20} /></button>
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
                <Q en="About how much does your household earn each month?" fil="Halos magkano ang kinikita ng inyong sambahayan kada buwan?" required />
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-base">₱</span>
                  <input type="number" min="0" inputMode="numeric" className={`${inputCls} pl-8`} value={sheet.monthlyIncome} onChange={set('monthlyIncome')} placeholder="0" />
                </div>
              </div>
              <div>
                <Q en="Work situation (optional)" fil="Kalagayan sa trabaho (opsyonal)" />
                <select className={inputCls} value={sheet.employmentType} onChange={set('employmentType')}>
                  {EMPLOYMENT.map(o => <option key={o.value} value={o.value}>{o.en}{o.value ? ` · ${o.fil}` : ''}</option>)}
                </select>
              </div>
              <div>
                <Q en="Where does the money come from? (optional)" fil="Saan nanggagaling ang pera? (opsyonal)" />
                <input className={inputCls} value={sheet.incomeSource} onChange={set('incomeSource')} placeholder="e.g. Sweldo, negosyo, pension, padala" />
              </div>
            </>
          )}

          {/* ── Expenses ── */}
          {cur.key === 'expenses' && (
            <>
              <p className="text-sm text-gray-500">Roughly how much do you spend each month? Leave blank if unsure.<br /><span className="text-gray-400">Halos magkano ang gastos kada buwan? Iwanang blanko kung hindi sigurado.</span></p>
              {[
                { k: 'food',      en: 'Food',          fil: 'Pagkain' },
                { k: 'utilities', en: 'Water & power', fil: 'Tubig at kuryente' },
                { k: 'rent',      en: 'Rent',          fil: 'Upa sa bahay' },
                { k: 'medicine',  en: 'Medicine',      fil: 'Gamot' },
              ].map(row => (
                <div key={row.k}>
                  <p className="text-base font-medium text-gray-800">{row.en} <span className="text-gray-400 font-normal">· {row.fil}</span></p>
                  <div className="relative mt-1">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-base">₱</span>
                    <input type="number" min="0" inputMode="numeric" className={`${inputCls} pl-8`} value={sheet.expenses?.[row.k] ?? ''} onChange={setExp(row.k)} placeholder="0" />
                  </div>
                </div>
              ))}
            </>
          )}

          {/* ── Medical ── */}
          {cur.key === 'medical' && (
            <>
              <div>
                <Q en="What illness or condition needs help?" fil="Anong sakit o kondisyon ang kailangang tulungan?" required />
                <input className={inputCls} value={sheet.diagnosis} onChange={set('diagnosis')} placeholder="e.g. Pneumonia, kidney disease" />
              </div>
              <div>
                <Q en="When were you admitted? (optional)" fil="Kailan kayo na-admit? (opsyonal)" />
                <input type="date" className={inputCls} value={sheet.dateOfAdmission} onChange={set('dateOfAdmission')} />
              </div>
              <div>
                <Q en="Estimated total cost, if known (optional)" fil="Tinatayang kabuuang gastos, kung alam (opsyonal)" />
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-base">₱</span>
                  <input type="number" min="0" inputMode="numeric" className={`${inputCls} pl-8`} value={sheet.estimatedTotalCost} onChange={set('estimatedTotalCost')} placeholder="0" />
                </div>
              </div>
            </>
          )}

          {/* ── Review ── */}
          {cur.key === 'review' && (
            <div className="space-y-3 text-sm">
              <p className="text-gray-500">Please check your answers, then tap Submit.<br /><span className="text-gray-400">Pakitingnan ang inyong mga sagot, pagkatapos ay i-Submit.</span></p>
              {[
                ['Household size · Laki ng sambahayan', sheet.householdSize || '—'],
                ['Monthly income · Buwanang kita', sheet.monthlyIncome !== '' && sheet.monthlyIncome != null ? `₱${Number(sheet.monthlyIncome).toLocaleString()}` : '—'],
                ['Illness · Sakit', sheet.diagnosis || '—'],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between gap-3 border-b border-gray-50 pb-2">
                  <span className="text-gray-400">{label}</span>
                  <span className="font-medium text-gray-800 text-right">{val}</span>
                </div>
              ))}
              <p className="text-xs text-gray-400">CRMC will review this with you and complete the assessment. · Susuriin ito ng CRMC kasama kayo.</p>
            </div>
          )}
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
        <button onClick={saveAndExit} disabled={saving} className="w-full mt-3 text-sm text-gray-400 hover:text-gray-600">
          Save and finish later · I-save at tapusin mamaya
        </button>
      </div>
    </Layout>
  )
}
