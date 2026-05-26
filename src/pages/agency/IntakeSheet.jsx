import Layout from '../../components/Layout'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import {
  MdArrowBack, MdSave, MdPrint, MdCheckCircle, MdRadioButtonUnchecked,
  MdInfo, MdAdd, MdDelete, MdLock, MdAutorenew,
  MdGroups, MdWork, MdReceipt, MdMedicalServices, MdAssignment,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import {
  MEANS_CATEGORIES, EMPLOYMENT_TYPES, EMPTY_FAMILY_MEMBER,
  blankSheet, isIntakeComplete, requiredFieldsStatus,
} from '../../utils/intakeSheet'
import { buildIntakeSheetHTML } from '../../utils/intakeSheetHTML'

const AUTOSAVE_MS = 1500

const SECTIONS = [
  { id: 'family',   label: 'Family Composition',  Icon: MdGroups            },
  { id: 'income',   label: 'Income & Employment', Icon: MdWork              },
  { id: 'expenses', label: 'Monthly Expenses',    Icon: MdReceipt           },
  { id: 'medical',  label: 'Medical Information', Icon: MdMedicalServices   },
  { id: 'assess',   label: 'Assessment',          Icon: MdAssignment        },
]

const fmtRelative = (date) => {
  if (!date) return ''
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 5)   return 'just now'
  if (diff < 60)  return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function IntakeSheet() {
  const { id }      = useParams()
  const navigate    = useNavigate()
  const { user }    = useAuth()

  const [app, setApp]           = useState(null)
  const [loading, setLoading]   = useState(true)
  const [sheet, setSheet]       = useState(() => blankSheet())
  const [hydrated, setHydrated] = useState(false)
  const [saveState, setSaveState] = useState({ status: 'idle', lastSavedAt: null })
  const [activeSection, setActiveSection] = useState('family')

  const dirtyRef       = useRef(false)
  const saveTimerRef   = useRef(null)
  const sectionRefs    = useRef({})

  // Subscribe to application — use a ref for the "have we hydrated" flag
  // so the snapshot subscription doesn't tear down + recreate the moment
  // hydration completes (which was the prior behavior with `hydrated`
  // in the deps array).
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (!id) return
    hydratedRef.current = false
    const unsub = onSnapshot(doc(db, 'applications', id), snap => {
      if (!snap.exists()) {
        toast.error('Application not found.')
        navigate('/agency/inbox')
        return
      }
      const data = { id: snap.id, ...snap.data() }
      setApp(data)

      // Hydrate the local sheet once from the remote intake. Later remote
      // changes don't overwrite local edits in progress.
      if (!hydratedRef.current) {
        setSheet({ ...blankSheet(), ...(data.intakeSheet ?? {}) })
        setHydrated(true)
        hydratedRef.current = true
      }
      setLoading(false)
    }, () => { setLoading(false); toast.error('Failed to load application.') })
    return unsub
  }, [id, navigate])

  // Permission: only the owning agency can edit
  const canEdit = app && (user?.agencyId === app.agencyId) && !['rejected'].includes(app.status)

  // Autosave (debounced)
  const performSave = async () => {
    if (!app || !dirtyRef.current) return
    setSaveState(prev => ({ ...prev, status: 'saving' }))
    try {
      const cleanedMembers = (sheet.familyMembers ?? [])
        .filter(m => m.name?.trim() || m.relationship?.trim())
      const payload = {
        ...sheet,
        familyMembers: cleanedMembers,
        householdSize:      sheet.householdSize === '' ? null : Number(sheet.householdSize),
        monthlyIncome:      sheet.monthlyIncome === '' ? null : Number(sheet.monthlyIncome),
        estimatedTotalCost: sheet.estimatedTotalCost === '' ? null : Number(sheet.estimatedTotalCost),
        expenses: Object.fromEntries(
          Object.entries(sheet.expenses ?? {}).map(([k, v]) => [k, v === '' ? null : Number(v)])
        ),
        completedBy:   app.intakeSheet?.completedBy ?? user.name,
        completedAt:   app.intakeSheet?.completedAt ?? serverTimestamp(),
        lastEditedBy:  user.name,
        lastEditedAt:  serverTimestamp(),
      }
      await updateDoc(doc(db, 'applications', app.id), {
        intakeSheet: payload,
        updatedAt:   serverTimestamp(),
      })
      dirtyRef.current = false
      setSaveState({ status: 'saved', lastSavedAt: new Date() })
    } catch (err) {
      console.error(err)
      setSaveState(prev => ({ ...prev, status: 'error' }))
      toast.error('Failed to save Intake Sheet.')
    }
  }

  const scheduleAutosave = () => {
    if (!canEdit) return
    dirtyRef.current = true
    setSaveState(prev => ({ ...prev, status: 'saving' }))
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(performSave, AUTOSAVE_MS)
  }

  // Cancel any pending autosave when the application id changes or the
  // page unmounts. Critical: do NOT flush the timer on id-change —
  // the queued performSave closes over the previous `app` ref via closure,
  // so flushing would write the prior intake's draft data into the new
  // intake document (silent cross-application data corruption when a
  // coordinator clicks between two patients faster than the 1.5s debounce).
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      dirtyRef.current = false
    }
  }, [id])

  // Also rehydrate when navigating to a different application id so the
  // local sheet draft doesn't bleed across documents.
  useEffect(() => {
    setHydrated(false)
    setSheet(blankSheet())
    setSaveState({ status: 'idle', lastSavedAt: null })
  }, [id])

  // Warn user about unsaved changes on tab close
  useEffect(() => {
    const handler = (e) => {
      if (dirtyRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // Scroll-spy: highlight which section the user is reading
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) setActiveSection(e.target.id)
      })
    }, { rootMargin: '-30% 0px -60% 0px' })
    Object.values(sectionRefs.current).forEach(el => el && observer.observe(el))
    return () => observer.disconnect()
  }, [hydrated])

  // ── Setters ──────────────────────────────────────────────────────────

  const set = (field) => (e) => {
    setSheet(p => ({ ...p, [field]: e.target.value }))
    scheduleAutosave()
  }
  const setExp = (field) => (e) => {
    setSheet(p => ({ ...p, expenses: { ...p.expenses, [field]: e.target.value } }))
    scheduleAutosave()
  }
  const setMember = (idx, field, val) => {
    setSheet(p => {
      const next = [...p.familyMembers]
      next[idx] = { ...next[idx], [field]: val }
      return { ...p, familyMembers: next }
    })
    scheduleAutosave()
  }
  const addMember = () => {
    setSheet(p => ({ ...p, familyMembers: [...p.familyMembers, { ...EMPTY_FAMILY_MEMBER }] }))
    scheduleAutosave()
  }
  const removeMember = (idx) => {
    setSheet(p => ({ ...p, familyMembers: p.familyMembers.filter((_, i) => i !== idx) }))
    scheduleAutosave()
  }

  const handleManualSave = async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    dirtyRef.current = true
    await performSave()
    toast.success('Intake Sheet saved.')
  }

  const handleScrollTo = (sectionId) => {
    const el = sectionRefs.current[sectionId]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handlePrintFormalSheet = async () => {
    // Flush any pending edits first so the printout reflects the latest data
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (dirtyRef.current) await performSave()

    try {
      const html = buildIntakeSheetHTML({
        app,
        sheet,
        agency: null,
        currentUser: user,
      })
      const blob = new Blob([html], { type: 'text/html' })
      const url  = URL.createObjectURL(blob)
      const win  = window.open(url, '_blank', 'width=900,height=1100')
      if (!win) {
        URL.revokeObjectURL(url)
        toast.error('Please allow pop-ups to print the Intake Sheet.')
        return
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      console.error(err)
      toast.error('Failed to generate Intake Sheet for printing.')
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────

  const required = useMemo(
    () => requiredFieldsStatus({ ...sheet, completedBy: app?.intakeSheet?.completedBy ?? user?.name }, user?.name),
    [sheet, app?.intakeSheet?.completedBy, user?.name]
  )
  const completedCount = required.filter(r => r.done).length
  const completion     = Math.round((completedCount / required.length) * 100)
  const complete       = completedCount === required.length

  const totalExpenses = Object.values(sheet.expenses ?? {})
    .reduce((sum, v) => sum + (Number(v) || 0), 0)

  // Section completion (rough — used for nav indicators)
  const sectionDone = {
    family:   !!sheet.householdSize && Number(sheet.householdSize) > 0,
    income:   sheet.monthlyIncome !== '' && Number(sheet.monthlyIncome) >= 0,
    expenses: totalExpenses > 0,
    medical:  !!sheet.diagnosis?.trim(),
    assess:   !!sheet.recommendation?.trim() && !!sheet.meansTestCategory,
  }

  if (loading || !app) return (
    <Layout breadcrumb="Intake Sheet">
      <div className="p-4 sm:p-6 max-w-5xl space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="card p-5 animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-48 mb-3" />
            <div className="h-3 bg-gray-100 rounded w-64" />
          </div>
        ))}
      </div>
    </Layout>
  )

  return (
    <Layout breadcrumb={`Intake Sheet · ${app.patientName}`}>
      <div className="p-4 sm:p-6 max-w-5xl">

        {/* Sticky header */}
        <div className="sticky top-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-gray-50/95 backdrop-blur border-b border-gray-100 z-20 mb-5 print:hidden">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Link to={`/agency/applications/${app.id}`}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-brand-600 font-medium">
                <MdArrowBack size={14} /> Back to application
              </Link>
              <span className="text-gray-300">/</span>
              <p className="text-sm font-semibold text-gray-800 truncate">Intake Sheet</p>
              <span className="text-xs text-gray-400 truncate">— {app.patientName}</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Save state indicator */}
              <span className="text-xs text-gray-500 flex items-center gap-1.5">
                {saveState.status === 'saving' && (
                  <><MdAutorenew size={13} className="text-brand-500 animate-spin" /> Saving…</>
                )}
                {saveState.status === 'saved' && (
                  <><MdCheckCircle size={13} className="text-green-500" /> Saved {fmtRelative(saveState.lastSavedAt)}</>
                )}
                {saveState.status === 'error' && (
                  <span className="text-red-500">Save failed</span>
                )}
                {saveState.status === 'idle' && hydrated && app.intakeSheet && (
                  <><MdCheckCircle size={13} className="text-gray-300" /> All changes saved</>
                )}
              </span>
              <button className="btn-secondary text-sm flex items-center gap-1.5"
                onClick={handlePrintFormalSheet}
                title="Open a printable Unified Intake Sheet in a new window">
                <MdPrint size={14} /> Print Form
              </button>
              <button className="btn-primary text-sm flex items-center gap-1.5"
                onClick={handleManualSave} disabled={!canEdit}>
                <MdSave size={14} /> Save now
              </button>
            </div>
          </div>
        </div>

        {/* Read-only banner */}
        {!canEdit && (
          <div className="mb-5 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex items-start gap-2 print:hidden">
            <MdLock size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 leading-relaxed">
              {app.status === 'rejected'
                ? 'This application was rejected — the Intake Sheet is now read-only.'
                : `You are viewing this Intake Sheet in read-only mode. Only coordinators of ${app.agencyName} can edit it.`}
            </p>
          </div>
        )}

        {/* ── Two-column layout ── */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5 print:grid-cols-1 print:gap-2">

          {/* Section nav (1/4, sticky) */}
          <aside className="lg:col-span-1 print:hidden">
            <div className="lg:sticky lg:top-24 space-y-3">

              {/* Required tracker */}
              <div className="card p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Required Fields</p>
                <div className="flex items-baseline gap-2 mb-2">
                  <p className="text-2xl font-bold text-gray-800">{completedCount}</p>
                  <p className="text-xs text-gray-400">of {required.length} done</p>
                  {complete && (
                    <span className="ml-auto badge badge-green text-xs">Complete</span>
                  )}
                </div>
                <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-3">
                  <div className={`h-full rounded-full ${complete ? 'bg-green-500' : 'bg-amber-400'}`}
                    style={{ width: `${completion}%` }} />
                </div>
                <ul className="space-y-1">
                  {required.map(r => (
                    <li key={r.key} className="flex items-center gap-2 text-xs">
                      {r.done
                        ? <MdCheckCircle size={13} className="text-green-500 flex-shrink-0" />
                        : <MdRadioButtonUnchecked size={13} className="text-gray-300 flex-shrink-0" />}
                      <span className={r.done ? 'text-gray-600' : 'text-gray-500'}>{r.label}</span>
                    </li>
                  ))}
                </ul>
                {complete && (
                  <p className="text-xs text-green-600 mt-2 leading-relaxed">
                    ✓ Ready for approval. Return to the application to issue a Guarantee Letter.
                  </p>
                )}
              </div>

              {/* Section nav */}
              <div className="card p-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 px-1">Jump to section</p>
                <nav className="space-y-0.5">
                  {SECTIONS.map(s => {
                    const active = activeSection === s.id
                    const done = sectionDone[s.id]
                    const Icon = s.Icon
                    return (
                      <button key={s.id} onClick={() => handleScrollTo(s.id)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                          active
                            ? 'bg-brand-50 text-brand-700 font-medium'
                            : 'text-gray-600 hover:bg-gray-50'
                        }`}>
                        <Icon size={16} className={`flex-shrink-0 ${active ? 'text-brand-500' : 'text-gray-400'}`} />
                        <span className="flex-1 truncate">{s.label}</span>
                        {done && <MdCheckCircle size={13} className="text-green-400 flex-shrink-0" />}
                      </button>
                    )
                  })}
                </nav>
              </div>

              {/* Editor info */}
              {app.intakeSheet?.completedBy && (
                <div className="card p-3">
                  <p className="text-xs text-gray-400 leading-relaxed">
                    Originally completed by <strong className="text-gray-700">{app.intakeSheet.completedBy}</strong>.
                    {app.intakeSheet?.lastEditedBy && app.intakeSheet.lastEditedBy !== app.intakeSheet.completedBy && (
                      <> Last edited by <strong className="text-gray-700">{app.intakeSheet.lastEditedBy}</strong>.</>
                    )}
                  </p>
                </div>
              )}
            </div>
          </aside>

          {/* Main content (3/4) */}
          <div className="lg:col-span-3 space-y-5 print:col-span-1">

            {/* Print-only header */}
            <div className="hidden print:block mb-4">
              <h1 className="text-xl font-bold text-gray-900">Unified Intake Sheet</h1>
              <p className="text-sm text-gray-700 mt-1">{app.patientName} · {app.appId}</p>
              <p className="text-xs text-gray-500">Agency: {app.agencyName}</p>
              <hr className="my-3 border-gray-300" />
            </div>

            {/* Section: Family */}
            <section ref={el => sectionRefs.current.family = el} id="family" className="card p-5 scroll-mt-24">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">👪</span>
                <h2 className="text-sm font-semibold text-gray-800">Family Composition</h2>
              </div>

              <div className="space-y-2 mb-3">
                {/* Column headers — visible on sm+ where the row is
                    horizontal. Match the grid spans of each input row
                    exactly so the labels sit above their fields. The
                    headers are screen-reader hidden (their inputs get
                    explicit aria-label) so AT users hear the field
                    purpose without the header echoing it. */}
                {/* Headers match the grid spans below. Age was previously
                    col-span-1 (~50 px on a typical 600 px form area) which
                    squashed the number input's spinner arrows over the
                    digits. col-span-2 = ~95 px, enough room for the
                    spinner + 2 digits with room to spare. */}
                <div className="hidden sm:grid grid-cols-12 gap-2 px-1 text-xs font-medium text-gray-500 uppercase tracking-wide mb-1" aria-hidden="true">
                  <span className="col-span-3">Name</span>
                  <span className="col-span-2">Relationship</span>
                  <span className="col-span-2">Age</span>
                  <span className="col-span-2">Occupation</span>
                  <span className="col-span-2">Monthly ₱</span>
                  <span className="col-span-1" />
                </div>

                {sheet.familyMembers.map((m, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-start">
                    <input className="input col-span-12 sm:col-span-3 text-sm"
                      placeholder="Juan Dela Cruz" aria-label={`Family member ${i + 1} name`}
                      value={m.name} onChange={e => setMember(i, 'name', e.target.value)} disabled={!canEdit} />
                    <input className="input col-span-6 sm:col-span-2 text-sm"
                      placeholder="e.g. Spouse" aria-label={`Family member ${i + 1} relationship`}
                      value={m.relationship} onChange={e => setMember(i, 'relationship', e.target.value)} disabled={!canEdit} />
                    <input className="input col-span-3 sm:col-span-2 text-sm" type="number"
                      placeholder="—" aria-label={`Family member ${i + 1} age`}
                      value={m.age} onChange={e => setMember(i, 'age', e.target.value)} disabled={!canEdit} />
                    <input className="input col-span-3 sm:col-span-2 text-sm"
                      placeholder="e.g. Driver" aria-label={`Family member ${i + 1} occupation`}
                      value={m.occupation} onChange={e => setMember(i, 'occupation', e.target.value)} disabled={!canEdit} />
                    <input className="input col-span-10 sm:col-span-2 text-sm" type="number"
                      placeholder="0" aria-label={`Family member ${i + 1} monthly contribution`}
                      value={m.monthlyContribution} onChange={e => setMember(i, 'monthlyContribution', e.target.value)} disabled={!canEdit} />
                    <button
                      className="col-span-2 sm:col-span-1 p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30 flex items-center justify-center"
                      onClick={() => removeMember(i)}
                      aria-label={`Remove family member ${i + 1}`}
                      disabled={!canEdit || sheet.familyMembers.length === 1}>
                      <MdDelete size={16} />
                    </button>
                  </div>
                ))}
                {canEdit && (
                  <button className="btn-secondary text-xs flex items-center gap-1.5 mt-3"
                    onClick={addMember}>
                    <MdAdd size={14} /> Add family member
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-gray-50">
                <Field label="Household Size" required>
                  <input type="number" className="input" min={1}
                    value={sheet.householdSize} onChange={set('householdSize')} disabled={!canEdit} />
                  <p className="text-xs text-gray-400 mt-1 leading-snug">
                    {sheet.familyMembers.length} family member{sheet.familyMembers.length !== 1 ? 's' : ''} listed above.
                    Total household size includes the patient and any dependents not listed individually.
                  </p>
                </Field>
              </div>
            </section>

            {/* Section: Income */}
            <section ref={el => sectionRefs.current.income = el} id="income" className="card p-5 scroll-mt-24">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">💼</span>
                <h2 className="text-sm font-semibold text-gray-800">Income & Employment</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Monthly Household Income (₱)" required>
                  <input type="number" className="input" min={0}
                    value={sheet.monthlyIncome} onChange={set('monthlyIncome')} disabled={!canEdit} />
                </Field>
                <Field label="Employment Type">
                  <select className="input" value={sheet.employmentType} onChange={set('employmentType')} disabled={!canEdit}>
                    {EMPLOYMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Field>
                <Field label="Employer">
                  <input className="input" value={sheet.employer} onChange={set('employer')} disabled={!canEdit} />
                </Field>
                <Field label="Length of Employment">
                  <input className="input" value={sheet.lengthOfEmployment}
                    onChange={set('lengthOfEmployment')} placeholder="e.g. 3 years" disabled={!canEdit} />
                </Field>
                <Field label="Other Income Source" colSpan={2}>
                  <input className="input" value={sheet.incomeSource}
                    onChange={set('incomeSource')} placeholder="Pension, remittance, etc." disabled={!canEdit} />
                </Field>
              </div>
            </section>

            {/* Section: Expenses */}
            <section ref={el => sectionRefs.current.expenses = el} id="expenses" className="card p-5 scroll-mt-24">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🧾</span>
                  <h2 className="text-sm font-semibold text-gray-800">Monthly Expenses</h2>
                </div>
                <span className="text-xs text-gray-500">Total: <strong>₱{totalExpenses.toLocaleString()}</strong></span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {['food','utilities','rent','education','medicine','other'].map(k => (
                  <Field key={k} label={k.charAt(0).toUpperCase() + k.slice(1)}>
                    <input type="number" className="input" min={0}
                      value={sheet.expenses?.[k] ?? ''} onChange={setExp(k)} disabled={!canEdit} />
                  </Field>
                ))}
              </div>
            </section>

            {/* Section: Medical */}
            <section ref={el => sectionRefs.current.medical = el} id="medical" className="card p-5 scroll-mt-24">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">🩺</span>
                <h2 className="text-sm font-semibold text-gray-800">Medical Information</h2>
              </div>
              <div className="space-y-3">
                <Field label="Primary Diagnosis" required>
                  <input className="input" value={sheet.diagnosis} onChange={set('diagnosis')} disabled={!canEdit} />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Attending Physician">
                    <input className="input" value={sheet.attendingPhysician}
                      onChange={set('attendingPhysician')} disabled={!canEdit} />
                  </Field>
                  <Field label="Hospital Case # (IHOMIS)">
                    <input className="input" value={sheet.hospitalCaseNumber}
                      onChange={set('hospitalCaseNumber')} disabled={!canEdit} />
                  </Field>
                  <Field label="Date of Admission">
                    <input type="date" className="input" value={sheet.dateOfAdmission}
                      onChange={set('dateOfAdmission')} disabled={!canEdit} />
                  </Field>
                  <Field label="Estimated Total Cost (₱)">
                    <input type="number" className="input" min={0}
                      value={sheet.estimatedTotalCost} onChange={set('estimatedTotalCost')} disabled={!canEdit} />
                  </Field>
                </div>
              </div>
            </section>

            {/* Section: Assessment */}
            <section ref={el => sectionRefs.current.assess = el} id="assess" className="card p-5 scroll-mt-24">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">📝</span>
                <h2 className="text-sm font-semibold text-gray-800">Social Worker Assessment</h2>
              </div>
              <div className="space-y-3">
                <Field label="Means-Test Category" required
                  hint="Manually classified by the social worker based on income, household size, and observed conditions.">
                  <select className="input" value={sheet.meansTestCategory}
                    onChange={set('meansTestCategory')} disabled={!canEdit}>
                    {MEANS_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
                <Field label="Social Case Study Narrative"
                  hint="Family background, circumstances of illness, observations during home visit or interview.">
                  <textarea className="input resize-none" rows={4} maxLength={2000}
                    value={sheet.caseStudyNarrative}
                    onChange={set('caseStudyNarrative')} disabled={!canEdit} />
                  <p className="text-xs text-gray-400 mt-0.5 text-right">{(sheet.caseStudyNarrative ?? '').length} / 2000</p>
                </Field>
                <Field label="Recommendation" required
                  hint="Your professional recommendation for this case.">
                  <textarea className="input resize-none" rows={3} maxLength={1000}
                    value={sheet.recommendation}
                    onChange={set('recommendation')} disabled={!canEdit} />
                  <p className="text-xs text-gray-400 mt-0.5 text-right">{(sheet.recommendation ?? '').length} / 1000</p>
                </Field>
              </div>
            </section>

            {/* Footer hint */}
            <div className="card p-4 bg-blue-50/40 border-blue-100 print:hidden">
              <div className="flex items-start gap-2">
                <MdInfo size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700 leading-relaxed">
                  Changes save automatically as you type. {complete
                    ? 'All required fields are filled — you can return to the application and click Approve & Issue GL.'
                    : `Fill the ${required.length - completedCount} remaining required field${required.length - completedCount === 1 ? '' : 's'} to unlock approval.`}
                </p>
              </div>
            </div>

          </div>
        </div>
      </div>
    </Layout>
  )
}

// ── Small field wrapper ───────────────────────────────────────────────────

function Field({ label, required, children, hint, colSpan }) {
  return (
    <div className={colSpan === 2 ? 'sm:col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
  )
}
