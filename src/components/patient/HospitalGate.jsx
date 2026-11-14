import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MdLocalHospital, MdCheckCircle, MdPlace, MdEventSeat, MdCompareArrows } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import { checkAccessCode, claimAccessCode, normalizeCode, PENDING_CODE_KEY } from '../../utils/accessCodes'
import { hospitalForCode } from '../../hooks/useMarketplace'

const YEAR = new Date().getFullYear()
const sanitize = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20)
const codeStart = (h) => (h?.accessCodePrefix ? `${h.accessCodePrefix}-${YEAR}-` : '')

/**
 * Step zero of filing a request in the marketplace: choose the hospital and
 * enter the access code its social-services office issued. Claiming the code
 * makes that hospital the patient's current one (claimAccessCode), so the
 * uploads and the request that follow are filed there.
 *
 *   hospitals   useMarketplace().hospitals
 *   initialId   hospital to preselect (?hospital=, a scanned slip, or current)
 *   onClaimed   (fields) => void — the user-profile fields that changed
 *   onCancel    optional — back to filing at the current hospital
 */
export default function HospitalGate({ user, hospitals, initialId, onClaimed, onCancel }) {
  const { t } = useTranslation()
  const pending = (() => { try { return sessionStorage.getItem(PENDING_CODE_KEY) } catch { return null } })()
  const [selected, setSelected] = useState(initialId || hospitalForCode(hospitals, pending)?.id || '')
  const [code, setCode]   = useState('')
  const [error, setError] = useState(null)   // { reason, tenantId? }
  const [busy, setBusy]   = useState(false)

  // Preselect once the list arrives (it streams in after mount).
  useEffect(() => {
    if (selected || hospitals.length === 0) return
    const id = initialId || hospitalForCode(hospitals, pending)?.id || (hospitals.length === 1 ? hospitals[0].id : '')
    if (id) setSelected(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitals, initialId])

  const hospital = hospitals.find((h) => h.id === selected) ?? null

  // Prefill the code: the scanned slip when it's this hospital's, else the
  // hospital's prefix + year so only the 5 digits remain to type.
  useEffect(() => {
    if (!hospital) return
    setError(null)
    setCode(pending && hospitalForCode([hospital], pending) ? pending : codeStart(hospital))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, hospital?.accessCodePrefix])

  const submit = async (e) => {
    e?.preventDefault()
    if (busy || !hospital) return
    setBusy(true); setError(null)
    try {
      const res = await checkAccessCode(code, { hospitalId: hospital.id, uid: user.uid })
      if (!res.ok) { setError(res); return }
      const fields = await claimAccessCode({ user, code: normalizeCode(code), tenantId: hospital.id })
      await onClaimed(fields, hospital)
    } catch (err) {
      const m = String(err?.message ?? '')
      setError({ reason: m === 'CODE_USED' ? 'used' : m === 'CODE_NOT_FOUND' ? 'notFound' : m === 'CODE_OTHER_HOSPITAL' ? 'otherHospital' : 'error' })
      if (!['CODE_USED', 'CODE_NOT_FOUND', 'CODE_OTHER_HOSPITAL'].includes(m)) console.error('[HospitalGate] claim failed:', err)
    } finally {
      setBusy(false)
    }
  }

  const other = error?.reason === 'otherHospital' ? hospitals.find((h) => h.id === error.tenantId) : null

  return (
    <form onSubmit={submit} className="card p-5 space-y-5">
      <div>
        <p className="text-sm font-semibold text-gray-800">{t('patient.gate.title')}</p>
        <p className="text-xs text-gray-500 mt-0.5">{t('patient.gate.subtitle')}</p>
      </div>

      {/* Hospital choice */}
      <fieldset>
        <legend className="mb-2 flex w-full items-center justify-between text-xs font-medium text-gray-700">
          <span>{t('patient.gate.hospitalLabel')}</span>
          <Link to="/patient/hospitals" className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:text-brand-700">
            <MdCompareArrows size={14} aria-hidden="true" /> {t('patient.gate.compare')}
          </Link>
        </legend>
        {hospitals.length === 0
          ? <p className="text-sm text-gray-500">{t('patient.gate.loadingHospitals')}</p>
          : (
            <div className="space-y-2">
              {hospitals.map((h) => {
                const on = h.id === selected
                return (
                  <label key={h.id} className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${on ? 'border-brand-400 bg-brand-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <input type="radio" name="hospital" className="mt-1 h-4 w-4 accent-brand-500" checked={on} onChange={() => setSelected(h.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                        <MdLocalHospital size={16} className="flex-shrink-0 text-brand-500" aria-hidden="true" /> {h.facilityName}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                        {(h.address || h.region) && <span className="inline-flex items-center gap-1"><MdPlace size={12} aria-hidden="true" />{[h.address, h.region].filter(Boolean).join(' · ')}</span>}
                        {h.slots.total > 0 && <span className="inline-flex items-center gap-1"><MdEventSeat size={12} aria-hidden="true" />{t('patient.hospitals.slotsOpen', { remaining: h.slots.remaining, total: h.slots.total })}</span>}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          )}
      </fieldset>

      {/* Access code */}
      {hospital && (
        <div>
          <label htmlFor="gate-code" className="block text-xs font-medium text-gray-700 mb-1">
            {t('patient.gate.codeLabel', { hospital: hospital.shortName || hospital.facilityName })} <span className="text-red-400">*</span>
          </label>
          <input id="gate-code" className={`input font-mono min-h-[44px] ${error ? 'border-red-400 bg-red-50' : ''}`}
            value={code} onChange={(e) => { setCode(sanitize(e.target.value)); setError(null) }}
            placeholder={`${codeStart(hospital)}00001`} autoCapitalize="characters" autoComplete="off" />
          {error
            ? (
              <div className="mt-1 text-xs text-red-600" role="alert">
                {t(`patient.gate.err.${error.reason}`, { year: YEAR, hospital: other?.facilityName ?? '' })}
                {other && (
                  <button type="button" className="ml-1 font-semibold underline" onClick={() => setSelected(other.id)}>
                    {t('patient.gate.switchTo', { hospital: other.shortName || other.facilityName })}
                  </button>
                )}
              </div>
            )
            : <p className="mt-1 text-xs text-gray-500">{t('patient.gate.codeHint', { office: hospital.gatewayName || t('patient.gate.officeFallback') })}</p>}
        </div>
      )}

      <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-relaxed text-blue-800">
        {t('patient.gate.noCode', { office: hospital?.gatewayName || t('patient.gate.officeFallback'), hospital: hospital?.facilityName || t('patient.gate.yourHospital') })}
        {hospital?.contactEmail && <> <a href={`mailto:${hospital.contactEmail}`} className="font-semibold underline break-all">{hospital.contactEmail}</a></>}
      </div>

      <div className="flex gap-3">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}
            className="flex-1 min-h-[44px] rounded-xl border border-gray-200 text-sm font-medium text-gray-700">
            {t('patient.gate.keepCurrent')}
          </button>
        )}
        <button type="submit" disabled={busy || !hospital}
          className="flex-1 min-h-[44px] rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm disabled:opacity-60 inline-flex items-center justify-center gap-1.5">
          {busy ? t('patient.gate.checking') : <><MdCheckCircle size={16} aria-hidden="true" /> {t('patient.gate.useCode')}</>}
        </button>
      </div>
    </form>
  )
}
