import { useRef, useState } from 'react'
import { doc, getDoc, serverTimestamp, writeBatch, Timestamp } from 'firebase/firestore'
import { MdClose, MdPrint, MdCheckCircle } from 'react-icons/md'
import toast from 'react-hot-toast'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { logAudit } from '../../utils/auditLog'
import { withTenant } from '../../utils/hospitals'
import { fmtDate } from '../../utils/dates'
import { accessCodePrefixFor } from '../../config/org'
import { codeProof, fullNameOf, isBirthdate, ID_TYPES } from '../../utils/codeIssue'

// Patient-bound access codes (2026-11-15): the social-services desk issues a
// code to ONE named patient, recording who they are. The patient can only
// register / file with it using the same last name + birthdate, and the
// account takes the name typed here (firestore.rules codeClaimProofOk /
// codeNameOk). The details go to the staff-only privateInfo/issued doc; the
// code doc itself (readable during sign-up) carries no personal data.

const today = () => new Date().toISOString().slice(0, 10)
// Phase 3A: a code may cover a course of treatment (several requests in turn)
// up to ~3 months ahead — the rules allow at most 93 days.
export const COURSE_MAX_DAYS = 90
const plusDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
// End of that day, Manila time.
export const courseEndMs = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d + 1) - 8 * 3600000 - 1 }
const EMPTY = {
  lastName: '', firstName: '', middleName: '', suffix: '', birthdate: '', contact: '',
  visitDate: today(), caseNumber: '', idType: '', idLast4: '',
  course: false, courseUntil: '',
}
const NAME_OK = /^[A-Za-zÀ-ÿÑñ .'-]+$/

export function validateIssue(f) {
  const e = {}
  if (!f.lastName.trim() || !NAME_OK.test(f.lastName)) e.lastName = 'Enter the last name (letters only).'
  if (!f.firstName.trim() || !NAME_OK.test(f.firstName)) e.firstName = 'Enter the first name (letters only).'
  if (f.middleName && !NAME_OK.test(f.middleName)) e.middleName = 'Letters only.'
  if (!isBirthdate(f.birthdate) || f.birthdate > today()) e.birthdate = 'Enter the birthdate.'
  if (f.contact && !/^09\d{9}$/.test(f.contact)) e.contact = 'Use 11 digits starting with 09.'
  if (!isBirthdate(f.visitDate) || f.visitDate > today()) e.visitDate = 'Enter the date of the visit or admission.'
  if (!f.idType) e.idType = 'Select the ID you saw.'
  if (f.idLast4 && !/^[A-Za-z0-9]{4}$/.test(f.idLast4)) e.idLast4 = 'Last 4 characters of the ID number.'
  if (f.course && (!isBirthdate(f.courseUntil) || f.courseUntil <= today() || f.courseUntil > plusDays(today(), COURSE_MAX_DAYS)))
    e.courseUntil = `Choose an end date within the next ${COURSE_MAX_DAYS} days.`
  return e
}

// The first code id from `start` up that doesn't exist anywhere (codes are one
// network-wide namespace; another hospital may have used a number).
async function freeCodeId(prefix, start) {
  for (let num = start; num < start + 500; num++) {
    const id = `${prefix}${String(num).padStart(5, '0')}`
    if (!(await getDoc(doc(db, 'hospitalIds', id))).exists()) return id
  }
  throw new Error('NO_FREE_IDS')
}

function Field({ id, label, required, error, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700 mb-1">{label}{required && <span className="text-red-400"> *</span>}</label>
      {children}
      {error ? <p className="text-xs text-red-500 mt-1">{error}</p> : hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}

export default function IssueCodeModal({ nextNum, onClose, onPrint }) {
  const { user } = useAuth()
  const [f, setF] = useState(EMPTY)
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [issued, setIssued] = useState(null) // { id, name }
  const panelRef = useRef(null)
  useEscapeKey(onClose, !saving)
  useFocusTrap(panelRef, true)
  const errors = validateIssue(f)
  const err = (k) => (showErrors ? errors[k] : undefined)
  const set = (k) => (e) => setF(p => ({ ...p, [k]: e.target.value }))

  const issue = async () => {
    setShowErrors(true)
    if (Object.keys(errors).length) return
    setSaving(true)
    try {
      const nameParts = {
        firstName: f.firstName.trim(), middleName: f.middleName.trim(), lastName: f.lastName.trim(), suffix: f.suffix.trim(),
      }
      const name = fullNameOf(nameParts)
      const id = await freeCodeId(accessCodePrefixFor(new Date().getFullYear()), nextNum)
      const batch = writeBatch(db)
      batch.set(doc(db, 'hospitalIds', id), withTenant({
        status: 'available', patId: null, bound: true,
        date: fmtDate(new Date()), time: '', createdAt: serverTimestamp(),
        ...(f.course ? { courseUntil: Timestamp.fromMillis(courseEndMs(f.courseUntil)) } : {}),
      }))
      batch.set(doc(db, 'hospitalIds', id, 'privateInfo', 'issued'), {
        name, nameParts, birthdate: f.birthdate, proof: codeProof(nameParts.lastName, f.birthdate),
        contact: f.contact || null, visitDate: f.visitDate, caseNumber: f.caseNumber.trim() || null,
        idType: f.idType, idLast4: f.idLast4 ? f.idLast4.toUpperCase() : null,
        issuedBy: user.name ?? '', issuedByUid: user.uid, issuedAt: serverTimestamp(),
      })
      await batch.commit()
      logAudit(user, {
        action: 'hospitalid_issued', targetType: 'hospitalId', targetId: id, targetName: id,
        details: `Issued to ${name} (visit ${f.visitDate}; ID seen: ${f.idType}${f.idLast4 ? ` …${f.idLast4.toUpperCase()}` : ''})${f.course ? `; course of treatment until ${f.courseUntil}` : ''}`,
      })
      setIssued({ id, name, courseUntil: f.course ? f.courseUntil : null })
      toast.success(`${id} issued to ${name}.`)
    } catch (e) {
      console.error(e)
      toast.error('Could not issue the code. Please try again.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && !saving && onClose()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="issue-title" tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto outline-none">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 id="issue-title" className="text-base font-semibold text-gray-900">Issue an access code</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-600"><MdClose size={20} /></button>
        </div>

        {issued ? (
          <div className="px-5 py-6 text-center space-y-3">
            <MdCheckCircle size={36} className="mx-auto text-green-600" />
            <p className="font-mono text-xl font-bold text-gray-900">{issued.id}</p>
            <p className="text-sm text-gray-600">Issued to <strong>{issued.name}</strong>. It works only with this patient’s last name and birthdate.</p>
            {issued.courseUntil && <p className="text-sm text-gray-600">It covers the patient’s requests until <strong>{issued.courseUntil}</strong>.</p>}
            <div className="flex justify-center gap-2 pt-2">
              <button className="btn-secondary text-sm" onClick={() => { setIssued(null); setF({ ...EMPTY, visitDate: today(), course: false, courseUntil: '' }); setShowErrors(false) }}>Issue another</button>
              <button className="btn-primary text-sm flex items-center gap-1.5" onClick={() => onPrint([{ id: issued.id, issuedName: issued.name }])}>
                <MdPrint size={16} /> Print slip
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 py-4 space-y-4">
              <p className="text-xs text-gray-600 bg-blue-50 border border-blue-100 rounded-lg p-2.5">
                Type the patient’s details from the ID you are looking at. The patient will need the same last name and birthdate to use the code, and their account will use this name.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field id="ic-last" label="Last name" required error={err('lastName')}>
                  <input id="ic-last" className="input" value={f.lastName} onChange={set('lastName')} />
                </Field>
                <Field id="ic-first" label="First name" required error={err('firstName')}>
                  <input id="ic-first" className="input" value={f.firstName} onChange={set('firstName')} />
                </Field>
                <Field id="ic-middle" label="Middle name" error={err('middleName')}>
                  <input id="ic-middle" className="input" value={f.middleName} onChange={set('middleName')} />
                </Field>
                <Field id="ic-suffix" label="Suffix" hint="e.g. Jr., III">
                  <input id="ic-suffix" className="input" value={f.suffix} onChange={set('suffix')} />
                </Field>
                <Field id="ic-birth" label="Birthdate" required error={err('birthdate')}>
                  <input id="ic-birth" type="date" className="input" max={today()} value={f.birthdate} onChange={set('birthdate')} />
                </Field>
                <Field id="ic-contact" label="Mobile number" error={err('contact')} hint="09XXXXXXXXX">
                  <input id="ic-contact" className="input" inputMode="numeric" maxLength={11} value={f.contact}
                    onChange={e => setF(p => ({ ...p, contact: e.target.value.replace(/\D/g, '').slice(0, 11) }))} />
                </Field>
                <Field id="ic-visit" label="Date of visit / admission" required error={err('visitDate')}>
                  <input id="ic-visit" type="date" className="input" max={today()} value={f.visitDate} onChange={set('visitDate')} />
                </Field>
                <Field id="ic-case" label="Hospital case number" hint="If the patient has one">
                  <input id="ic-case" className="input" value={f.caseNumber} onChange={set('caseNumber')} />
                </Field>
                <Field id="ic-idtype" label="ID you saw" required error={err('idType')}>
                  <select id="ic-idtype" className="input" value={f.idType} onChange={set('idType')}>
                    <option value="">Select…</option>
                    {ID_TYPES.map(x => <option key={x} value={x}>{x}</option>)}
                  </select>
                </Field>
                <Field id="ic-last4" label="Last 4 of the ID number" error={err('idLast4')}>
                  <input id="ic-last4" className="input font-mono" maxLength={4} value={f.idLast4}
                    onChange={e => setF(p => ({ ...p, idLast4: e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 4) }))} />
                </Field>
              </div>
              {/* Phase 3A: one code for a course of treatment (e.g. a month of
                  dialysis): it backs the patient's requests one after another. */}
              <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" className="mt-0.5 w-4 h-4 accent-brand-500" checked={f.course}
                    onChange={e => setF(p => ({ ...p, course: e.target.checked, courseUntil: e.target.checked ? (p.courseUntil || plusDays(today(), 30)) : '' }))} />
                  <span>Covers a course of treatment<span className="block text-xs text-gray-500">For recurring care (dialysis, chemotherapy): the code backs the patient’s requests one after another until the end date, instead of one request.</span></span>
                </label>
                {f.course && (
                  <Field id="ic-course" label="Course ends on" required error={err('courseUntil')} hint={`Up to ${COURSE_MAX_DAYS} days from today.`}>
                    <input id="ic-course" type="date" className="input" min={plusDays(today(), 1)} max={plusDays(today(), COURSE_MAX_DAYS)}
                      value={f.courseUntil} onChange={set('courseUntil')} />
                  </Field>
                )}
              </div>
            </div>
            <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50 pt-3">
              <button className="btn-secondary text-sm" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="btn-primary text-sm" onClick={issue} disabled={saving}>{saving ? 'Issuing…' : 'Issue code'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
