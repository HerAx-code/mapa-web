import { useEffect, useState } from 'react'
import { doc, getDoc, setDoc, updateDoc, deleteField, serverTimestamp } from 'firebase/firestore'
import { useHospitalSettings } from '../../hooks/useVerification'
import { policyOf } from '../../utils/verificationPolicy'
import toast from 'react-hot-toast'
import Layout from '../../components/Layout'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { applyHospital } from '../../config/org'
import { currentTenantId, clearBrandingCache } from '../../utils/hospitals'
import { logAudit } from '../../utils/auditLog'
import { syncHospitalPublic } from '../../utils/hospitalsPublic'
import { validateHospital, normalizePrefix } from '../../utils/hospitalConfig'
import { CASE_TIMERS, caseTimerDays } from '../../shared/caseTimers'

// Hospital Settings — multi-hospital Phase 8 (docs/multi-hospital-network-plan.md).
// A hospital's super admin edits its own BRANDING: the names and contact that
// appear on patient copy, the Guarantee Letter, the intake sheet and emails.
// The access-code prefix and whether sign-ups are open are network decisions
// (platform admin) — shown here read-only; the rules enforce the same split.
const FIELDS = ['facilityName', 'shortName', 'gatewayName', 'gatewayInitials', 'contactEmail', 'address']

function Field({ label, hint, error, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {error
        ? <p className="text-xs text-red-500 mt-1">{error}</p>
        : hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}

// Input verification Phase 2: when a request needs a recorded verification
// call before it can be endorsed. Kept in hospitalSettings/{tenant}, which only
// this hospital's staff can read — patients must not see the amount threshold.
function VerificationPolicyCard({ user, tenantId }) {
  const saved = useHospitalSettings()
  const policy = policyOf(saved)
  const [amount, setAmount] = useState(null)       // null = not edited yet
  const [onDuplicate, setOnDuplicate] = useState(null)
  const [saving, setSaving] = useState(false)
  const amountValue = amount ?? (policy.interviewAboveAmount ?? '')
  const dupValue = onDuplicate ?? policy.interviewOnDuplicate
  const amountNum = String(amountValue).trim() === '' ? null : Number(amountValue)
  const amountBad = amountNum != null && (!Number.isFinite(amountNum) || amountNum <= 0)
  // Phase 3: second-person approval above an amount (blank = off).
  const [second, setSecond] = useState(null)
  const secondValue = second ?? (policy.secondPersonAboveAmount ?? '')
  const secondNum = String(secondValue).trim() === '' ? null : Number(secondValue)
  const secondBad = secondNum != null && (!Number.isFinite(secondNum) || secondNum <= 0)

  const save = async () => {
    if (amountBad || secondBad) return
    setSaving(true)
    try {
      // merge: the means-test card saves its own fields in the same doc.
      await setDoc(doc(db, 'hospitalSettings', tenantId), {
        tenantId, interviewAboveAmount: amountNum, interviewOnDuplicate: !!dupValue,
        secondPersonAboveAmount: secondNum,
        updatedAt: serverTimestamp(), updatedBy: user.name ?? '',
      }, { merge: true })
      logAudit(user, {
        action: 'verification_policy_updated', targetType: 'hospital', targetId: tenantId, targetName: tenantId,
        details: `Verification call: ${amountNum ? `amount ₱${amountNum.toLocaleString()} or more` : 'no amount rule'}; ${dupValue ? 'on' : 'off'} for duplicate-account flags. `
          + `Second-person approval: ${secondNum ? `₱${secondNum.toLocaleString()} or more` : 'off'}`,
      })
      setAmount(null); setOnDuplicate(null); setSecond(null)
      toast.success('Verification settings saved.')
    } catch (e) {
      console.error(e)
      toast.error('Could not save. Please try again.')
    } finally { setSaving(false) }
  }

  return (
    <div className="card p-5 mt-4 space-y-4">
      <div>
        <p className="text-sm font-semibold text-gray-800">Verification call</p>
        <p className="text-xs text-gray-500 mt-1">
          When your staff must speak with the patient (phone, video or in person) and record it before endorsing.
          Patients don’t see these settings. A bill number used on another request always needs a call.
        </p>
      </div>
      <Field label="Amount needed at or above (₱)" error={amountBad ? 'Enter an amount above zero, or leave it blank.' : undefined}
        hint="Leave blank for no amount rule.">
        <input className="input sm:w-56" inputMode="numeric" value={amountValue}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
      </Field>
      <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={!!dupValue} onChange={(e) => setOnDuplicate(e.target.checked)} />
        <span>When another account looks like the same patient (same national ID card, or same name and phone)</span>
      </label>
      <div className="pt-3 border-t border-gray-100">
        <p className="text-sm font-semibold text-gray-800">Second-person approval</p>
        <p className="text-xs text-gray-500 mt-1">
          At or above this amount, the staff member who confirmed the bill, recorded the call or completed the assessment
          can’t also endorse — another staff member must. Leave blank if your office has only one social worker.
        </p>
      </div>
      <Field label="Amount needed at or above (₱)" error={secondBad ? 'Enter an amount above zero, or leave it blank.' : undefined}
        hint="Leave blank to turn this off.">
        <input className="input sm:w-56" inputMode="numeric" value={secondValue}
          onChange={(e) => setSecond(e.target.value.replace(/[^\d.]/g, ''))} />
      </Field>
      <div className="flex justify-end">
        <button className="btn-primary text-sm" onClick={save} disabled={saving || amountBad || secondBad}>
          {saving ? 'Saving…' : 'Save verification settings'}
        </button>
      </div>
    </div>
  )
}

// Phase 4 (P4-C / D8): how long the case timers wait before closing a slice
// the patient never accepted, or a case nothing is pending on. The hospital
// acts first; the timers only stop a case being forgotten.
const TIMER_COPY = {
  sliceProceedDays: {
    label: 'Close an endorsement the patient never accepts after (days)',
    hint: 'The patient is reminded at 24 and 48 hours. Default 3.',
  },
  nothingPendingDays: {
    label: 'Close a case nothing is pending on after (days)',
    hint: 'When every agency has decided and the case is not fully funded, it waits in "Endorse more or close". You are warned a day before. Default 7.',
  },
}
function CaseTimersCard({ user, tenantId }) {
  const saved = useHospitalSettings()
  const [edit, setEdit] = useState({})
  const [saving, setSaving] = useState(false)
  const valueOf = (k) => edit[k] ?? String(caseTimerDays(saved, k))
  const badOf = (k) => {
    const n = Number(valueOf(k))
    return !Number.isInteger(n) || n < CASE_TIMERS[k].min || n > CASE_TIMERS[k].max
  }
  const keys = Object.keys(CASE_TIMERS)
  const anyBad = keys.some(badOf)
  const save = async () => {
    if (anyBad) return
    setSaving(true)
    try {
      const values = Object.fromEntries(keys.map(k => [k, Number(valueOf(k))]))
      await setDoc(doc(db, 'hospitalSettings', tenantId), {
        tenantId, ...values, updatedAt: serverTimestamp(), updatedBy: user.name ?? '',
      }, { merge: true })
      logAudit(user, {
        action: 'case_timers_updated', targetType: 'hospital', targetId: tenantId, targetName: tenantId,
        details: `Not accepted: ${values.sliceProceedDays} days; nothing pending: ${values.nothingPendingDays} days`,
      })
      setEdit({})
      toast.success('Case time limits saved.')
    } catch (e) {
      console.error(e)
      toast.error('Could not save. Please try again.')
    } finally { setSaving(false) }
  }
  return (
    <div className="card p-5 mt-4 space-y-4">
      <div>
        <p className="text-sm font-semibold text-gray-800">Case time limits</p>
        <p className="text-xs text-gray-500 mt-1">
          So cases don't stay open with nothing happening. Letters already issued are never affected.
        </p>
      </div>
      {keys.map(k => (
        <Field key={k} label={TIMER_COPY[k].label}
          error={badOf(k) ? `Enter a whole number from ${CASE_TIMERS[k].min} to ${CASE_TIMERS[k].max}.` : undefined}
          hint={TIMER_COPY[k].hint}>
          <input className="input sm:w-32" inputMode="numeric" value={valueOf(k)}
            onChange={(e) => setEdit(p => ({ ...p, [k]: e.target.value.replace(/[^\d]/g, '') }))} />
        </Field>
      ))}
      <div className="flex justify-end">
        <button className="btn-primary text-sm" onClick={save} disabled={saving || anyBad}>
          {saving ? 'Saving…' : 'Save time limits'}
        </button>
      </div>
    </div>
  )
}

// DOH AO 2021-0044 (2026-11-16): the PSA poverty line of the hospital's region,
// per person per month, that the intake sheet's suggested class compares
// income per person to (140 / 180 / 220%). Typed from the PSA release — no
// figure is built in. Staff-only like the rest of hospitalSettings.
const firstPsaYear = 2015
const psaYears = () => Array.from({ length: new Date().getFullYear() - firstPsaYear + 1 }, (_, i) => new Date().getFullYear() - i)

function MeansTestCard({ user, tenantId, region }) {
  const saved = useHospitalSettings()
  const [line, setLine] = useState(null)   // null = not edited yet
  const [year, setYear] = useState(null)
  const [cite, setCite] = useState(null)
  const [citeShort, setCiteShort] = useState(null)
  const [status, setStatus] = useState(null)
  const [saving, setSaving] = useState(false)
  const lineValue = line ?? (saved?.povertyLinePerCapita ?? '')
  const yearValue = year ?? (saved?.povertyLineYear ?? '')
  const citeValue = cite ?? (saved?.povertyLineCitation ?? '')
  const citeShortValue = citeShort ?? (saved?.povertyLineCitationShort ?? '')
  const statusValue = status ?? (saved?.povertyLineStatus ?? 'current')
  const lineNum = String(lineValue).trim() === '' ? null : Number(lineValue)
  const lineBad = lineNum != null && (!Number.isFinite(lineNum) || lineNum <= 0 || lineNum >= 100000)
  const yearBad = lineNum != null && !yearValue
  const fmt = (n) => `₱${Math.round(n).toLocaleString('en-PH')}`

  const save = async () => {
    if (lineBad || yearBad) return
    setSaving(true)
    try {
      await setDoc(doc(db, 'hospitalSettings', tenantId), {
        tenantId,
        povertyLinePerCapita: lineNum,
        povertyLineYear: lineNum == null ? null : Number(yearValue),
        region: region ?? '',
        povertyLineCitation: String(citeValue).trim().slice(0, 1000),
        povertyLineCitationShort: String(citeShortValue).trim().slice(0, 200),
        povertyLineStatus: statusValue === 'interim' ? 'interim' : 'current',
        updatedAt: serverTimestamp(), updatedBy: user.name ?? '',
      }, { merge: true })
      logAudit(user, {
        action: 'means_test_line_updated', targetType: 'hospital', targetId: tenantId, targetName: tenantId,
        details: lineNum == null ? 'Poverty line cleared'
          : `Poverty line ₱${lineNum.toLocaleString()} per person per month (PSA ${yearValue}${region ? `, ${region}` : ''}; ${statusValue})`
            + (String(citeShortValue).trim() ? ` · source: ${String(citeShortValue).trim()}` : ''),
      })
      setLine(null); setYear(null); setCite(null); setCiteShort(null); setStatus(null)
      toast.success('Means-test setting saved.')
    } catch (e) {
      console.error(e)
      toast.error('Could not save. Please try again.')
    } finally { setSaving(false) }
  }

  return (
    <div className="card p-5 mt-4 space-y-4">
      <div>
        <p className="text-sm font-semibold text-gray-800">Means test (DOH AO 2021-0044)</p>
        <p className="text-xs text-gray-500 mt-1">
          The PSA poverty line of your region, per person per month. The intake sheet suggests a class by comparing the
          household&apos;s income per person to it. Patients don&apos;t see this setting.
        </p>
      </div>
      <p className="text-sm text-gray-700">Region: <strong>{region || 'not set'}</strong> <span className="text-xs text-gray-500">(set by the network)</span></p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="PSA poverty line, per person (₱ / month)" error={lineBad ? 'Enter an amount above zero, or leave it blank.' : undefined}
          hint="Annual per-capita threshold ÷ 12. Leave blank to turn suggestions off.">
          <input className="input" inputMode="decimal" value={lineValue}
            onChange={(e) => setLine(e.target.value.replace(/[^\d.]/g, ''))} />
        </Field>
        <Field label="PSA reference year" error={yearBad ? 'Choose the year of the PSA figure.' : undefined}>
          <select className="input" value={yearValue} onChange={(e) => setYear(e.target.value)}>
            <option value="">Select year…</option>
            {psaYears().map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Source (citation)" hint="The PSA release, table and figure this line comes from. Kept with every classification.">
        <textarea className="input resize-none" rows={3} maxLength={1000} value={citeValue}
          onChange={(e) => setCite(e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-start">
        <Field label="Short citation" hint="Printed on the Certificate of Eligibility, e.g. “PSA 2023 Full Year Official Poverty Statistics, BARMM”.">
          <input className="input" maxLength={200} value={citeShortValue} onChange={(e) => setCiteShort(e.target.value)} />
        </Field>
        <Field label="Status">
          <div role="radiogroup" aria-label="Status" className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
            {[['current', 'Current'], ['interim', 'Interim']].map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={statusValue === v} onClick={() => setStatus(v)}
                className={`px-4 py-2 text-xs font-semibold min-h-[40px] ${statusValue === v ? 'bg-brand-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>{l}</button>
            ))}
          </div>
        </Field>
      </div>
      {statusValue === 'interim' && (
        <p className="text-xs text-amber-700 rounded-lg bg-amber-50 border border-amber-100 p-2.5">
          Interim — a newer PSA release exists. Replace this figure once the newer regional threshold is confirmed.
        </p>
      )}
      {lineNum != null && !lineBad && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-700 rounded-lg bg-gray-50 p-3 tabular-nums">
          <div className="flex justify-between gap-2"><dt>Indigent (C3)</dt><dd>below {fmt(lineNum * 1.4)}</dd></div>
          <div className="flex justify-between gap-2"><dt>Financially incapacitated (C2)</dt><dd>{fmt(lineNum * 1.4)} – {fmt(lineNum * 1.8)}</dd></div>
          <div className="flex justify-between gap-2"><dt>Financially incapacitated (C1)</dt><dd>{fmt(lineNum * 1.8)} – {fmt(lineNum * 2.2)}</dd></div>
          <div className="flex justify-between gap-2"><dt>Financially capable</dt><dd>above {fmt(lineNum * 2.2)}</dd></div>
        </dl>
      )}
      <div className="flex justify-end">
        <button className="btn-primary text-sm" onClick={save} disabled={saving || lineBad || yearBad}>
          {saving ? 'Saving…' : 'Save means-test setting'}
        </button>
      </div>
    </div>
  )
}

// Certificate of Eligibility: the "Issued by" signatory (Malasakit Annex A:
// Head of the Medical Social Work Department), printed beside the MSW.
// Stored as coeNotedBy* (field names kept from the first version).
function CertificateCard({ user, tenantId }) {
  const saved = useHospitalSettings()
  const [name, setName] = useState(null)
  const [title, setTitle] = useState(null)
  const [saving, setSaving] = useState(false)
  const nameValue = name ?? (saved?.coeNotedByName ?? '')
  const titleValue = title ?? (saved?.coeNotedByTitle ?? '')

  const save = async () => {
    setSaving(true)
    try {
      await setDoc(doc(db, 'hospitalSettings', tenantId), {
        tenantId, coeNotedByName: nameValue.trim().slice(0, 100), coeNotedByTitle: titleValue.trim().slice(0, 100),
        updatedAt: serverTimestamp(), updatedBy: user.name ?? '',
      }, { merge: true })
      logAudit(user, {
        action: 'coe_settings_updated', targetType: 'hospital', targetId: tenantId, targetName: tenantId,
        details: `Certificate of Eligibility issued by: ${nameValue.trim() || '(blank line)'}${titleValue.trim() ? `, ${titleValue.trim()}` : ''}`,
      })
      setName(null); setTitle(null)
      toast.success('Certificate settings saved.')
    } catch (e) {
      console.error(e)
      toast.error('Could not save. Please try again.')
    } finally { setSaving(false) }
  }

  return (
    <div className="card p-5 mt-4 space-y-4">
      <div>
        <p className="text-sm font-semibold text-gray-800">Certificate of Eligibility</p>
        <p className="text-xs text-gray-500 mt-1">
          Who issues the certificate (Malasakit Annex A: the Head of the Medical Social Work Department), signing beside the
          social worker who assessed. Leave the name blank to print a line to write on.
          Numbers use your access-code prefix (e.g. {'CRMC-COE-2026-00001'}).
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Issued by (name)" hint="e.g. the department head's name, with RSW">
          <input className="input" maxLength={100} value={nameValue} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Title" hint="Default: Head, Medical Social Work Department">
          <input className="input" maxLength={100} value={titleValue} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end">
        <button className="btn-primary text-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save certificate settings'}</button>
      </div>
    </div>
  )
}

export default function HospitalSettings() {
  const { user } = useAuth()
  const tenantId = currentTenantId()
  const [hospital, setHospital] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  useEffect(() => {
    if (!tenantId) return
    getDoc(doc(db, 'hospitals', tenantId))
      .then((snap) => {
        const h = snap.exists() ? snap.data() : {}
        setHospital(h)
        setForm(Object.fromEntries(FIELDS.map((k) => [k, h[k] ?? ''])))
      })
      .catch((err) => { console.error(err); toast.error('Could not load hospital settings.') })
  }, [tenantId])

  const errors = form ? validateHospital({ ...form, accessCodePrefix: hospital?.accessCodePrefix ?? 'MAPA' }, [], tenantId) : {}
  const err = (k) => (showErrors ? errors[k] : undefined)
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  const handleSave = async () => {
    setShowErrors(true)
    if (Object.keys(errors).some((k) => FIELDS.includes(k))) return
    setSaving(true)
    try {
      const update = { updatedAt: serverTimestamp() }
      const next = { ...hospital }
      for (const k of FIELDS) {
        const v = String(form[k] ?? '').trim()
        if (v) { update[k] = v; next[k] = v }
        else if (k in hospital) { update[k] = deleteField(); delete next[k] }
      }
      await updateDoc(doc(db, 'hospitals', tenantId), update)
      setHospital(next)
      await syncHospitalPublic(tenantId, next)
      // Show the new branding at once (header, copy, documents).
      clearBrandingCache()
      applyHospital(next)
      logAudit(user, { action: 'hospital_updated', targetType: 'hospital', targetId: tenantId, targetName: next.facilityName || tenantId, details: 'Hospital branding updated' })
      toast.success('Hospital settings saved.')
    } catch (e) {
      console.error(e)
      toast.error('Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Layout breadcrumb="Hospital Settings">
      <div className="w-full p-4 sm:p-6 max-w-[760px] mx-auto">
        <div className="mb-5">
          <p className="eyebrow">Hospital</p>
          <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Hospital Settings</h1>
          <p className="text-sm text-gray-500 mt-1">
            How your hospital appears to patients and on the Guarantee Letter, intake sheet and emails.
          </p>
        </div>

        {!form ? (
          <div className="card p-8 flex justify-center">
            <div className="w-8 h-8 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="card p-5 space-y-4">
              <Field label="Hospital name" error={err('facilityName')} hint="Printed on documents and used in patient copy.">
                <input className="input" value={form.facilityName} onChange={set('facilityName')} />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Short name" hint="e.g. CPH">
                  <input className="input" value={form.shortName} onChange={set('shortName')} />
                </Field>
                <Field label="Contact email" error={err('contactEmail')} hint="Where patients ask about access codes.">
                  <input type="email" className="input" value={form.contactEmail} onChange={set('contactEmail')} />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem] gap-4">
                <Field label="Gateway office" error={err('gatewayName')}>
                  <input className="input" value={form.gatewayName} onChange={set('gatewayName')} />
                </Field>
                <Field label="Seal initials" error={err('gatewayInitials')}>
                  <input className="input" value={form.gatewayInitials} onChange={set('gatewayInitials')} />
                </Field>
              </div>
              <Field label="Address" hint="Printed under the hospital name on documents.">
                <input className="input" value={form.address} onChange={set('address')} />
              </Field>
              <div className="flex justify-end pt-1">
                <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>

            <VerificationPolicyCard user={user} tenantId={tenantId} />
            <CaseTimersCard user={user} tenantId={tenantId} />

            <MeansTestCard user={user} tenantId={tenantId} region={hospital?.region ?? ''} />

            <CertificateCard user={user} tenantId={tenantId} />

            <div className="card p-5 mt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Set by the network</p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-gray-500">Access codes</dt>
                  <dd className="font-mono text-gray-800">{hospital.accessCodePrefix ? `${normalizePrefix(hospital.accessCodePrefix)}-YYYY-NNNNN` : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">New patient requests</dt>
                  <dd className={hospital.enabled === false ? 'text-red-600 font-medium' : 'text-gray-800'}>
                    {hospital.enabled === false ? 'Paused' : 'Open'}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-gray-500 mt-3">Ask the super admin (network operator) to change these.</p>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
