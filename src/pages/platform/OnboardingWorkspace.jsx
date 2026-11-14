import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  doc, onSnapshot, updateDoc, serverTimestamp, arrayUnion, collection, query, where, getDocs, writeBatch,
} from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import {
  MdArrowBack, MdCheckCircle, MdRadioButtonUnchecked, MdUploadFile, MdOpenInNew, MdPhoneInTalk,
  MdWarningAmber, MdArrowForward, MdLockOpen, MdBlock,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import Layout from '../../components/Layout'
import { db, storage } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { logAudit } from '../../utils/auditLog'
import { tsToDate } from '../../utils/dates'
import { syncHospitalPublic } from '../../utils/hospitalsPublic'
import {
  STAGES, DECLINED, stageOf, stageIndex, stageLabel, stageChecklist, stageComplete, goLiveGate, canGoLive,
  DOCUMENTS, OWNERSHIP_TYPES, ownershipOf, PLAN_TIERS, complianceReminders,
} from '../../utils/onboarding'

// One hospital's onboarding, worked by the Super Admin (platform_admin):
// Interest → Verification → Agreement → Setup & training → Live
// (reports/Hospital onboarding requirements.md, revalidated 2026-11-15).
// Documents are filed here from what the hospital sends (email / by hand) —
// no public uploads. A stage can be completed only when its checklist is
// done; going live opens patient registration at the hospital.

const NHFR_URL = 'https://nhfr.doh.gov.ph/'
// Keep the pre-stages `status` field meaningful for older surfaces.
const LEGACY_STATUS = { interest: 'new', verification: 'contacted', agreement: 'contacted', setup: 'onboarded', live: 'onboarded', declined: 'declined' }
const fmt = (d) => (d ? d.toLocaleDateString('en-PH', { dateStyle: 'medium' }) : '—')

function Check({ item }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {item.done
        ? <MdCheckCircle size={18} className="mt-0.5 flex-shrink-0 text-green-600" aria-label="Done" />
        : <MdRadioButtonUnchecked size={18} className="mt-0.5 flex-shrink-0 text-gray-300" aria-label="Not done" />}
      <span className={item.done ? 'text-gray-500' : 'text-gray-800'}>{item.label}</span>
    </li>
  )
}

function Input({ label, hint, ...props }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      <input className="input text-sm" {...props} />
      {hint && <span className="block text-[11px] text-gray-500 mt-0.5">{hint}</span>}
    </label>
  )
}

export default function OnboardingWorkspace() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [r, setR] = useState(null)
  const [missing, setMissing] = useState(false)
  const [hospital, setHospital] = useState(null)
  const [ctx, setCtx] = useState({ adminCount: 0, partnerCount: 0 })
  const [view, setView] = useState(null)        // stage being viewed
  const [draft, setDraft] = useState(null)      // { verification, agreement, training, notes }
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(null)

  useEffect(() => onSnapshot(doc(db, 'onboardingRequests', id), (snap) => {
    if (!snap.exists()) { setMissing(true); return }
    const data = { id: snap.id, ...snap.data() }
    setR(data)
    setDraft(d => d ?? {
      verification: { nhfrCode: data.nhfrCode ?? '', ownershipType: data.hospitalType ?? '', callbackPhone: data.officialPhone ?? '', ...(data.verification ?? {}) },
      agreement: { planTier: 'pilot', noProcureClause: false, ...(data.agreement ?? {}) },
      training: { ...(data.training ?? {}) },
      notes: data.notes ?? '',
    })
    setView(v => v ?? (stageOf(data) === DECLINED ? 'interest' : stageOf(data)))
  }, (err) => { console.error('[OnboardingWorkspace]', err); setMissing(true) }), [id])

  // The hospital created at Setup, its admins and partner funders.
  useEffect(() => {
    if (!r?.hospitalId) { setHospital(null); return undefined }
    const unsub = onSnapshot(doc(db, 'hospitals', r.hospitalId), (s) => setHospital(s.exists() ? { id: s.id, ...s.data() } : null))
    Promise.all([
      getDocs(query(collection(db, 'users'), where('tenantId', '==', r.hospitalId), where('role', '==', 'super_admin'))),
      getDocs(query(collection(db, 'agencies'), where('partnerHospitalIds', 'array-contains', r.hospitalId))),
    ]).then(([admins, partners]) => setCtx({
      adminCount: admins.docs.filter(d => d.data().active !== false).length,
      partnerCount: partners.docs.filter(d => d.data().enabled !== false).length,
    })).catch((err) => console.warn('[OnboardingWorkspace] setup counts:', err))
    return unsub
  }, [r?.hospitalId])

  if (missing) return (
    <Layout breadcrumb="Onboarding">
      <div className="p-6 max-w-3xl mx-auto"><div className="card p-8 text-center text-sm text-gray-600">This onboarding record was not found. <Link className="text-brand-600 font-semibold" to="/platform/onboarding">Back to onboarding</Link></div></div>
    </Layout>
  )
  if (!r || !draft) return (
    <Layout breadcrumb="Onboarding"><div className="p-8 flex justify-center"><div className="w-8 h-8 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" /></div></Layout>
  )

  const current = stageOf(r)
  const declined = current === DECLINED
  // Checklists read the saved record merged with unsaved edits, so ticks
  // follow what's on screen; completing a stage saves first.
  const merged = { ...r, verification: draft.verification, agreement: draft.agreement, training: draft.training }
  const owner = ownershipOf(draft.verification.ownershipType || r.hospitalType)
  const history = Array.isArray(r.stageHistory) ? r.stageHistory : []
  const enteredAt = history.length ? new Date(history[history.length - 1].at) : tsToDate(r.createdAt)
  const days = enteredAt ? Math.max(0, Math.floor((Date.now() - enteredAt.getTime()) / 86400000)) : null

  const setSection = (section, key) => (e) => {
    const value = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e
    setDraft(d => ({ ...d, [section]: { ...d[section], [key]: value } }))
  }

  const save = async (extra = {}, audit = null) => {
    setBusy(true)
    try {
      await updateDoc(doc(db, 'onboardingRequests', id), {
        verification: draft.verification, agreement: draft.agreement, training: draft.training, notes: draft.notes,
        ...extra, updatedAt: serverTimestamp(),
      })
      if (audit) logAudit(user, { action: 'hospital_onboarding', targetType: 'onboardingRequest', targetId: id, targetName: r.hospitalName, details: audit })
      return true
    } catch (err) {
      console.error('[OnboardingWorkspace] save failed:', err)
      toast.error('Could not save. Please try again.')
      return false
    } finally { setBusy(false) }
  }

  const moveTo = async (next, extra = {}) => {
    const ok = await save({
      stage: next, status: LEGACY_STATUS[next], statusUpdatedAt: serverTimestamp(),
      stageHistory: arrayUnion({ stage: next, at: new Date().toISOString(), by: user?.name ?? 'Super Admin' }),
      ...extra,
    }, `Stage: ${stageLabel(current)} → ${stageLabel(next)}`)
    if (ok) { toast.success(`Moved to ${stageLabel(next)}.`); setView(next === DECLINED ? 'interest' : next) }
  }

  const completeStage = () => {
    const i = stageIndex(current)
    if (!stageComplete(current, merged, ctx)) { toast.error('Finish this stage’s checklist first.'); return }
    const extra = current === 'verification'
      ? { verification: { ...draft.verification, verifiedBy: user?.name ?? '', verifiedAt: new Date().toISOString() } }
      : {}
    moveTo(STAGES[i + 1].key, extra)
  }

  const upload = async (slot, file) => {
    if (!file) return
    if (file.size > 15 * 1024 * 1024) { toast.error('Files must be under 15 MB.'); return }
    if (!/^(application\/pdf|image\/(jpeg|png|webp))$/.test(file.type)) { toast.error('Upload a PDF or an image.'); return }
    setUploading(slot)
    try {
      const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
      const path = `onboarding/${id}/${slot}-${Date.now()}.${ext}`
      await uploadBytes(storageRef(storage, path), file, { contentType: file.type })
      await updateDoc(doc(db, 'onboardingRequests', id), {
        [`documents.${slot}`]: { name: file.name, path, uploadedAt: new Date().toISOString(), by: user?.name ?? '' },
        updatedAt: serverTimestamp(),
      })
      logAudit(user, { action: 'hospital_onboarding_document', targetType: 'onboardingRequest', targetId: id, targetName: r.hospitalName, details: `Filed: ${DOCUMENTS.find(d => d.key === slot)?.label ?? slot}` })
      toast.success('Document filed.')
    } catch (err) {
      console.error('[OnboardingWorkspace] upload failed:', err)
      toast.error('Upload failed.')
    } finally { setUploading(null) }
  }

  const openDoc = async (path) => {
    try { window.open(await getDownloadURL(storageRef(storage, path)), '_blank', 'noopener') }
    catch { toast.error('Could not open the document.') }
  }

  const createHospital = () => navigate('/platform/hospitals', {
    state: { prefill: { facilityName: r.hospitalName, region: r.region || '', contactEmail: r.email || '' }, fromRequest: id },
  })

  const goLive = async () => {
    if (!canGoLive(merged, ctx) || !hospital) { toast.error('The go-live checklist isn’t complete.'); return }
    setBusy(true)
    try {
      const a = draft.agreement
      const onboarding = {
        ...(hospital.onboarding ?? {}), stage: 'live', requestId: id,
        planTier: a.planTier ?? 'pilot', sponsor: a.sponsor ?? '', pilotUntil: a.pilotUntil ?? null,
      }
      const b = writeBatch(db)
      b.update(doc(db, 'hospitals', hospital.id), { enabled: true, liveAt: serverTimestamp(), onboarding, updatedAt: serverTimestamp() })
      b.update(doc(db, 'onboardingRequests', id), {
        verification: draft.verification, agreement: draft.agreement, training: draft.training, notes: draft.notes,
        stage: 'live', status: 'onboarded', statusUpdatedAt: serverTimestamp(), liveAt: serverTimestamp(),
        stageHistory: arrayUnion({ stage: 'live', at: new Date().toISOString(), by: user?.name ?? 'Super Admin' }),
        updatedAt: serverTimestamp(),
      })
      await b.commit()
      await syncHospitalPublic(hospital.id, { ...hospital, enabled: true })
      logAudit(user, { action: 'hospital_live', targetType: 'hospital', targetId: hospital.id, targetName: hospital.facilityName ?? r.hospitalName, details: `Go-live approved; patient registration open. Plan: ${onboarding.planTier}` })
      toast.success(`${hospital.facilityName ?? r.hospitalName} is live. Patients can now register.`)
      setView('live')
    } catch (err) {
      console.error('[OnboardingWorkspace] go-live failed:', err)
      toast.error('Could not complete go-live.')
    } finally { setBusy(false) }
  }

  const DocSlot = ({ slot }) => {
    const meta = DOCUMENTS.find(d => d.key === slot)
    const filed = r.documents?.[slot]
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 px-3 py-2">
        {filed ? <MdCheckCircle size={16} className="text-green-600" aria-hidden="true" /> : <MdRadioButtonUnchecked size={16} className="text-gray-300" aria-hidden="true" />}
        <span className="flex-1 min-w-[12rem] text-sm text-gray-800">
          {meta.label}{!meta.required && <span className="text-gray-400"> (optional)</span>}
          {filed && <span className="block text-[11px] text-gray-500">{filed.name} · {fmt(new Date(filed.uploadedAt))} · {filed.by}</span>}
        </span>
        {filed && (
          <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1" onClick={() => openDoc(filed.path)}>
            <MdOpenInNew size={13} /> View
          </button>
        )}
        <label className={`btn-secondary text-xs inline-flex items-center gap-1 cursor-pointer ${uploading === slot ? 'opacity-60 pointer-events-none' : ''}`}>
          <MdUploadFile size={13} /> {uploading === slot ? 'Uploading…' : filed ? 'Replace' : 'Upload'}
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only"
            onChange={(e) => { upload(slot, e.target.files?.[0]); e.target.value = '' }} />
        </label>
      </div>
    )
  }

  const v = draft.verification, a = draft.agreement, t = draft.training
  const checklist = stageChecklist(view, merged, ctx)
  const isCurrent = view === current
  const reminders = complianceReminders({ ...merged, liveAt: r.liveAt })

  return (
    <Layout breadcrumb={`Onboarding · ${r.hospitalName}`}>
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">
        <Link to="/platform/onboarding" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600 font-medium mb-3">
          <MdArrowBack size={16} /> Onboarding
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <p className="eyebrow">{owner.label}{r.region ? ` · ${r.region}` : ''}</p>
            <h1 className="font-display text-[26px] font-bold tracking-tight text-brand-900 mt-1">{r.hospitalName}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {declined ? 'Declined' : `${stageLabel(current)}${days !== null ? ` · day ${days + 1} in this stage` : ''}`}
              {hospital && <> · <span className="font-mono text-xs">{hospital.id}</span></>}
            </p>
          </div>
          {!declined && current !== 'live' && (
            <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1 text-red-600" disabled={busy}
              onClick={() => moveTo(DECLINED)}>
              <MdBlock size={14} /> Decline
            </button>
          )}
          {declined && (
            <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => moveTo('interest')}>Reopen</button>
          )}
        </div>

        <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)_300px] items-start">
          {/* Stages */}
          <nav aria-label="Onboarding stages" className="card p-3">
            <ol className="space-y-1">
              {STAGES.map((s, i) => {
                const done = !declined && i < stageIndex(current)
                const here = s.key === current
                return (
                  <li key={s.key}>
                    <button type="button" onClick={() => setView(s.key)}
                      className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-left min-h-[40px] ${view === s.key ? 'bg-brand-50 text-brand-800 font-semibold' : 'text-gray-700 hover:bg-gray-50'}`}>
                      {done ? <MdCheckCircle size={16} className="text-green-600" /> : <span className={`h-4 w-4 rounded-full border-2 ${here ? 'border-brand-500 bg-brand-500' : 'border-gray-300'}`} />}
                      {s.label}
                    </button>
                  </li>
                )
              })}
            </ol>
          </nav>

          {/* Current stage */}
          <section className="card p-5 space-y-5 min-w-0">
            <div>
              <h2 className="text-base font-semibold text-gray-900">{stageLabel(view)}</h2>
              {!isCurrent && !declined && <p className="text-xs text-gray-500 mt-0.5">{stageIndex(view) < stageIndex(current) ? 'Completed stage — you can still correct details.' : 'Not reached yet.'}</p>}
            </div>

            {view === 'interest' && (<>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-sm">
                {[['Ownership', owner.label], ['Region', r.region], ['NHFR code (as sent)', r.nhfrCode], ['Official phone (as sent)', r.officialPhone],
                  ['Sent', fmt(tsToDate(r.createdAt))], ['Signatory (as sent)', [r.signatoryName, r.signatoryPosition].filter(Boolean).join(', ')]].map(([k, val]) => (
                  <div key={k}><dt className="text-xs text-gray-500">{k}</dt><dd className="text-gray-800">{val || '—'}</dd></div>
                ))}
              </dl>
              {r.message && <p className="text-sm text-gray-700 whitespace-pre-line rounded-lg bg-gray-50 p-3">{r.message}</p>}
              <DocSlot slot="loi" />
            </>)}

            {view === 'verification' && (<>
              <p className="text-xs text-gray-500">Verify against official sources, not the details in the request. Look the facility up in the <a href={NHFR_URL} target="_blank" rel="noopener noreferrer" className="text-brand-600 font-medium underline">DOH National Health Facility Registry</a>.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="NHFR facility code" value={v.nhfrCode ?? ''} onChange={setSection('verification', 'nhfrCode')} />
                <label className="flex items-center gap-2 text-sm mt-5"><input type="checkbox" className="w-4 h-4 accent-brand-500" checked={!!v.nhfrChecked} onChange={setSection('verification', 'nhfrChecked')} /> Matches the DOH registry (name + address)</label>
                <Input label="License to Operate number" value={v.ltoNumber ?? ''} onChange={setSection('verification', 'ltoNumber')} />
                <Input label="License to Operate expiry" type="date" value={v.ltoExpiry ?? ''} onChange={setSection('verification', 'ltoExpiry')} />
                <Input label="PhilHealth accreditation no." value={v.philhealthNo ?? ''} onChange={setSection('verification', 'philhealthNo')} />
                <Input label="PhilHealth accreditation expiry" type="date" value={v.philhealthExpiry ?? ''} onChange={setSection('verification', 'philhealthExpiry')} />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="w-4 h-4 accent-brand-500" checked={!!v.philhealthNone} onChange={setSection('verification', 'philhealthNone')} /> Not PhilHealth-accredited</label>
                <label className="block">
                  <span className="block text-xs font-medium text-gray-600 mb-1">Ownership (confirmed from the license)</span>
                  <select className="input text-sm" value={v.ownershipType ?? ''} onChange={setSection('verification', 'ownershipType')}>
                    <option value="">Select…</option>
                    {OWNERSHIP_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="rounded-lg border border-gray-100 p-3 space-y-2">
                <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5"><MdPhoneInTalk size={16} className="text-brand-500" /> Call-back</p>
                <p className="text-xs text-gray-500">Call the hospital on its official number from the registry or license, confirm the request and the contact person.</p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[12rem]"><Input label="Official number called" value={v.callbackPhone ?? ''} onChange={setSection('verification', 'callbackPhone')} /></div>
                  <button type="button" className="btn-secondary text-xs min-h-[38px]" disabled={!v.callbackPhone?.trim()}
                    onClick={() => setDraft(d => ({ ...d, verification: { ...d.verification, callbackAt: new Date().toISOString(), callbackBy: user?.name ?? '' } }))}>
                    Record call-back now
                  </button>
                </div>
                {v.callbackAt && <p className="text-xs text-green-700">Confirmed {fmt(new Date(v.callbackAt))} by {v.callbackBy}</p>}
              </div>
              {v.verifiedAt && <p className="text-xs text-green-700">Verified {fmt(new Date(v.verifiedAt))} by {v.verifiedBy}</p>}
            </>)}

            {view === 'agreement' && (<>
              <p className="text-xs text-gray-500">Signatory for a {owner.label.toLowerCase()}: <strong className="text-gray-700">{owner.signer}</strong> — authority: {owner.authority}.</p>
              <div className="space-y-2">
                {['authority', 'moa', 'dpa', 'dpo', 'pia', 'dsa'].map(s => <DocSlot key={s} slot={s} />)}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="MOA signed on" type="date" value={a.moaSignedAt ?? ''} onChange={setSection('agreement', 'moaSignedAt')} />
                <Input label="MOA term ends" type="date" value={a.moaTermEnd ?? ''} onChange={setSection('agreement', 'moaTermEnd')} />
                <Input label="Data Protection Officer" value={a.dpoName ?? ''} onChange={setSection('agreement', 'dpoName')} />
                <Input label="DPO email" type="email" value={a.dpoEmail ?? ''} onChange={setSection('agreement', 'dpoEmail')} />
              </div>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 w-4 h-4 accent-brand-500" checked={!!a.noProcureClause} onChange={setSection('agreement', 'noProcureClause')} /> The MOA states the pilot is free and creates no obligation to purchase.</label>
              <div className="grid gap-3 sm:grid-cols-3 rounded-lg bg-gray-50 p-3">
                <label className="block">
                  <span className="block text-xs font-medium text-gray-600 mb-1">Plan (₱0 during the pilot)</span>
                  <select className="input text-sm" value={a.planTier ?? 'pilot'} onChange={setSection('agreement', 'planTier')}>
                    {PLAN_TIERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </label>
                <Input label="Sponsor (who covers costs)" value={a.sponsor ?? ''} onChange={setSection('agreement', 'sponsor')} placeholder="e.g. MAPA pilot" />
                <Input label="Pilot until" type="date" value={a.pilotUntil ?? ''} onChange={setSection('agreement', 'pilotUntil')} />
              </div>
            </>)}

            {view === 'setup' && (<>
              {r.hospitalId ? (
                <p className="text-sm text-gray-700">Hospital <span className="font-mono text-xs">{r.hospitalId}</span> is set up{hospital?.enabled === false ? ' with patient registration closed until go-live' : ''}.
                  {' '}<Link className="text-brand-600 font-medium" to="/platform/hospitals">Manage admins and partner funders</Link></p>
              ) : (
                <button type="button" className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={!isCurrent} onClick={createHospital}>
                  Create the hospital in MAPA <MdArrowForward size={16} />
                </button>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Staff trained in the Training Hospital" type="number" min="0" value={t.trainedCount ?? ''} onChange={setSection('training', 'trainedCount')} />
                <Input label="Acceptance test cases passed on" type="date" value={t.uatPassedAt ?? ''} onChange={setSection('training', 'uatPassedAt')} />
              </div>
              <DocSlot slot="golive" />
            </>)}

            {view === 'live' && (<>
              {current === 'live' ? (
                <>
                  <p className="text-sm text-green-800 bg-green-50 rounded-lg px-3 py-2">Live since {fmt(tsToDate(r.liveAt))}. Patients can register with this hospital’s access codes.</p>
                  <Input label="NPC registration of the system done on" type="date" value={a.npcRegisteredAt ?? ''} onChange={setSection('agreement', 'npcRegisteredAt')} hint="NPC Circular 2022-04: within 20 days of go-live." />
                  <ul className="space-y-1.5">
                    {reminders.map(x => (
                      <li key={x.key} className={`flex items-center gap-2 text-sm ${x.done ? 'text-gray-500' : x.state === 'overdue' ? 'text-red-700' : x.state === 'soon' ? 'text-amber-800' : 'text-gray-700'}`}>
                        {x.done ? <MdCheckCircle size={16} className="text-green-600" /> : x.state === 'ok' ? <MdRadioButtonUnchecked size={16} className="text-gray-300" /> : <MdWarningAmber size={16} />}
                        {x.label}: {fmt(x.due)}{x.state === 'overdue' && !x.done ? ' — overdue' : ''}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-600">Go-live opens patient registration. Everything below must be done.</p>
                  <ul className="space-y-1.5">{goLiveGate(merged, ctx).map(i => <Check key={`${i.stage}-${i.key}`} item={i} />)}</ul>
                  <button type="button" className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={busy || current !== 'setup' || !canGoLive(merged, ctx) || !hospital} onClick={goLive}>
                    <MdLockOpen size={16} /> Approve go-live and open registration
                  </button>
                </>
              )}
            </>)}

            {view !== 'live' && checklist.length > 0 && (
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">To complete this stage</p>
                <ul className="space-y-1.5">{checklist.map(i => <Check key={i.key} item={i} />)}</ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
              <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={async () => { if (await save(null, `Details updated (${stageLabel(view)})`)) toast.success('Saved.') }}>Save</button>
              {isCurrent && !declined && view !== 'setup' && view !== 'live' && (
                <button type="button" className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={busy || !stageComplete(view, merged, ctx)} onClick={completeStage}>
                  Complete {stageLabel(view)} <MdArrowForward size={16} />
                </button>
              )}
              {isCurrent && view === 'setup' && (
                <button type="button" className="btn-primary text-sm inline-flex items-center gap-1.5" onClick={() => setView('live')}>
                  Review go-live <MdArrowForward size={16} />
                </button>
              )}
            </div>
          </section>

          {/* Contacts, history, notes */}
          <aside className="space-y-4">
            <div className="card p-4 text-sm space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Contacts</p>
              <p className="text-gray-800">{r.contactName}{r.contactPosition ? `, ${r.contactPosition}` : ''}</p>
              <a className="text-brand-600 font-medium break-all" href={`mailto:${r.email}?subject=${encodeURIComponent('MAPA onboarding — ' + r.hospitalName)}`}>{r.email}</a>
              {r.officialPhone && <p className="text-gray-600">{r.officialPhone} <span className="text-gray-400">(as sent — confirm via the registry)</span></p>}
              <p className="text-xs text-gray-500 pt-1">Signs the MOA: {owner.signer}</p>
              {a.dpoName && <p className="text-xs text-gray-500">DPO: {a.dpoName}</p>}
            </div>
            <div className="card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">History</p>
              <ul className="space-y-1.5 text-xs text-gray-600">
                <li>Expression of interest · {fmt(tsToDate(r.createdAt))}</li>
                {history.map((h, i) => <li key={i}>{stageLabel(h.stage)} · {fmt(new Date(h.at))} · {h.by}</li>)}
              </ul>
            </div>
            <div className="card p-4">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</span>
                <textarea className="input text-sm mt-2 min-h-[110px]" maxLength={4000} value={draft.notes}
                  onChange={(e) => setDraft(d => ({ ...d, notes: e.target.value }))} placeholder="Meetings, calls, what the hospital still owes…" />
              </label>
            </div>
          </aside>
        </div>
      </div>
    </Layout>
  )
}
