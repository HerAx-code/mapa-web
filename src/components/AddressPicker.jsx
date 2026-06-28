import { useState, useId } from 'react'
import { BARMM_PROVINCES, BARMM_MUNICIPALITIES } from '../utils/barmm'
import { BARANGAYS } from '../utils/barmm-barangays'

/**
 * AddressPicker — cascading BARMM Province → City → Barangay dropdown.
 *
 * Encapsulates the "Other (not listed)" fallback pattern: picking Other
 * at any level reveals a free-text input so origins outside the BARMM
 * list (Region XII patients, agencies in NCR, an office in Quezon City,
 * etc.) stay enterable without forcing the user to abandon the form.
 *
 * Extracted from the inline logic that was duplicated across pages/
 * auth/Register.jsx and pages/admin/AddAgency.jsx so all address inputs
 * in the app share one implementation and one UX.
 *
 * Controlled component:
 *   value     { province, city, barangay }     strings, empty = unset
 *   onChange  ({ province, city, barangay })   called with the next value
 *
 * Optional props:
 *   showBarangay    hide the third row for office-address contexts
 *   errors          { province?, city?, barangay? } error strings
 *   labels          per-field i18n overrides (defaults below)
 *   disabled        disables the whole picker
 *   className       extra classes on the outer stack
 *   hideLabels      render fields without internal <label>s (when the
 *                   parent provides its own labels)
 *
 * Storage helper:
 *   joinAddress({ barangay, city, province }) -> single joined string
 *   "Bgy. X, Cotabato City, Cotabato City" -- use this when the schema
 *   stores both structured fields AND a flat string (the patient
 *   registration model).
 */

export const defaultAddressLabels = {
  province:          'Province',
  city:              'City / Municipality',
  barangay:          'Barangay',
  selectProvince:    'Select province',
  selectCity:        'Select city / municipality',
  selectBarangay:    'Select barangay',
  pickProvinceFirst: 'Pick a province first',
  otherNotListed:    'Other (not listed)',
  otherProvince:     'Enter province',
  otherCity:         'Enter city / municipality',
  otherBarangay:     'Enter barangay',
}

export const joinAddress = ({ barangay = '', city = '', province = '' } = {}) =>
  [barangay, city, province].map(s => (s ?? '').trim()).filter(Boolean).join(', ')

export default function AddressPicker({
  value = { province: '', city: '', barangay: '' },
  onChange,
  showBarangay = true,
  errors = {},
  labels: labelsProp,
  disabled = false,
  className = '',
  hideLabels = false,
}) {
  const labels = { ...defaultAddressLabels, ...(labelsProp ?? {}) }
  // A11y: useId() gives us a stable, render-collision-free prefix so
  // <label htmlFor> binds to its <select> even when the picker mounts
  // multiple times on the same page (Register has it; another form
  // might too). Before this, the labels weren't bound at all -- screen
  // readers couldn't announce "Province" for the province dropdown.
  const idPrefix    = useId()
  const provinceId  = `${idPrefix}-province`
  const cityId      = `${idPrefix}-city`
  const barangayId  = `${idPrefix}-barangay`

  // Resolve "Other" mode from incoming value: any string that isn't in
  // the BARMM list at its level is implicitly an Other-mode entry. This
  // lets parents hydrate the picker from arbitrary stored values without
  // managing the mode flags themselves.
  const startProvinceOther = !!value.province && !BARMM_PROVINCES.includes(value.province)
  const startCityOther     = !!value.city && !(BARMM_MUNICIPALITIES[value.province] ?? []).includes(value.city)
  const startBarangayOther = (() => {
    const list = BARANGAYS[value.province]?.[value.city]
    return !!value.barangay && !!list && !list.includes(value.barangay)
  })()

  const [provinceOther, setProvinceOther] = useState(startProvinceOther)
  const [cityOther,     setCityOther]     = useState(startCityOther)
  const [barangayOther, setBarangayOther] = useState(startBarangayOther)

  // Centralized emitter so partial updates always include the full
  // current value -- onChange never sees an undefined field.
  const emit = (next) => onChange?.({
    province: value.province ?? '',
    city:     value.city ?? '',
    barangay: value.barangay ?? '',
    ...next,
  })

  const onProvinceSelect = (e) => {
    const v = e.target.value
    setBarangayOther(false)
    if (v === '__other__') {
      // "Other" at province level cascades: a province outside BARMM
      // also means the city won't be in any BARMM_MUNICIPALITIES list.
      setProvinceOther(true)
      setCityOther(true)
      emit({ province: '', city: '', barangay: '' })
    } else {
      setProvinceOther(false)
      setCityOther(false)
      emit({ province: v, city: '', barangay: '' })
    }
  }

  const onCitySelect = (e) => {
    const v = e.target.value
    setBarangayOther(false)
    if (v === '__other__') {
      setCityOther(true)
      emit({ city: '', barangay: '' })
    } else {
      setCityOther(false)
      emit({ city: v, barangay: '' })
    }
  }

  const onBarangaySelect = (e) => {
    const v = e.target.value
    if (v === '__other__') {
      setBarangayOther(true)
      emit({ barangay: '' })
    } else {
      setBarangayOther(false)
      emit({ barangay: v })
    }
  }

  const setProvinceText = (e) => emit({ province: e.target.value })
  const setCityText     = (e) => emit({ city:     e.target.value })
  const setBarangayText = (e) => emit({ barangay: e.target.value })

  const inputCls = (field) =>
    `input ${errors[field] ? 'border-red-400 bg-red-50' : ''}`

  // Barangay dropdown is only shown when the current province/city pair
  // has a covered barangay list (Cotabato City + Maguindanao); elsewhere
  // it falls back to free text (BARMM has ~2,600 barangays in total).
  const bgyList = (!provinceOther && !cityOther)
    ? BARANGAYS[value.province]?.[value.city]
    : null

  return (
    <div className={`space-y-2 ${className}`}>

      {/* Province */}
      <div>
        {!hideLabels && (
          <label htmlFor={provinceId} className="block text-xs font-medium text-gray-700 mb-1">{labels.province}</label>
        )}
        <select
          id={provinceId}
          data-field="province"
          aria-label={hideLabels ? labels.province : undefined}
          className={`${inputCls('province')} ${(!provinceOther && !value.province) ? 'text-gray-400' : ''}`}
          value={provinceOther ? '__other__' : value.province}
          onChange={onProvinceSelect}
          disabled={disabled}>
          <option value="">{labels.selectProvince}</option>
          {BARMM_PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
          <option value="__other__">{labels.otherNotListed}</option>
        </select>
        {provinceOther && (
          <input
            className={`${inputCls('province')} mt-2`}
            placeholder={labels.otherProvince}
            aria-label={labels.otherProvince}
            value={value.province ?? ''}
            onChange={setProvinceText}
            disabled={disabled}
            autoCapitalize="words"
            maxLength={60} />
        )}
        {errors.province && <p className="text-xs text-red-500 mt-1">{errors.province}</p>}
      </div>

      {/* City / Municipality */}
      <div>
        {!hideLabels && (
          <label htmlFor={cityId} className="block text-xs font-medium text-gray-700 mb-1">{labels.city}</label>
        )}
        {provinceOther ? (
          <input
            id={cityId}
            data-field="city"
            aria-label={hideLabels ? labels.city : undefined}
            className={inputCls('city')}
            placeholder={labels.otherCity}
            value={value.city ?? ''}
            onChange={setCityText}
            disabled={disabled}
            autoCapitalize="words"
            maxLength={60} />
        ) : (
          <>
            <select
              id={cityId}
              data-field="city"
              aria-label={hideLabels ? labels.city : undefined}
              className={`${inputCls('city')} ${(!cityOther && !value.city) ? 'text-gray-400' : ''}`}
              value={cityOther ? '__other__' : value.city}
              onChange={onCitySelect}
              disabled={disabled || (!value.province && !cityOther)}>
              <option value="">{value.province ? labels.selectCity : labels.pickProvinceFirst}</option>
              {(BARMM_MUNICIPALITIES[value.province] ?? []).map(c => <option key={c} value={c}>{c}</option>)}
              <option value="__other__">{labels.otherNotListed}</option>
            </select>
            {cityOther && (
              <input
                className={`${inputCls('city')} mt-2`}
                placeholder={labels.otherCity}
                aria-label={labels.otherCity}
                value={value.city ?? ''}
                onChange={setCityText}
                disabled={disabled}
                autoCapitalize="words"
                maxLength={60} />
            )}
          </>
        )}
        {errors.city && <p className="text-xs text-red-500 mt-1">{errors.city}</p>}
      </div>

      {/* Barangay */}
      {showBarangay && (
        <div>
          {!hideLabels && (
            <label htmlFor={barangayId} className="block text-xs font-medium text-gray-700 mb-1">{labels.barangay}</label>
          )}
          {!bgyList ? (
            <input
              id={barangayId}
              data-field="barangay"
              aria-label={hideLabels ? labels.barangay : undefined}
              className={inputCls('barangay')}
              placeholder={labels.selectBarangay}
              value={value.barangay ?? ''}
              onChange={setBarangayText}
              disabled={disabled}
              autoComplete="address-line1"
              autoCapitalize="words"
              maxLength={80} />
          ) : (
            <>
              <select
                id={barangayId}
                data-field="barangay"
                aria-label={hideLabels ? labels.barangay : undefined}
                className={`${inputCls('barangay')} ${(!barangayOther && !value.barangay) ? 'text-gray-400' : ''}`}
                value={barangayOther ? '__other__' : value.barangay}
                onChange={onBarangaySelect}
                disabled={disabled}>
                <option value="">{labels.selectBarangay}</option>
                {bgyList.map(b => <option key={b} value={b}>{b}</option>)}
                <option value="__other__">{labels.otherNotListed}</option>
              </select>
              {barangayOther && (
                <input
                  className={`${inputCls('barangay')} mt-2`}
                  placeholder={labels.otherBarangay}
                  aria-label={labels.otherBarangay}
                  value={value.barangay ?? ''}
                  onChange={setBarangayText}
                  disabled={disabled}
                  autoCapitalize="words"
                  maxLength={80} />
              )}
            </>
          )}
          {errors.barangay && <p className="text-xs text-red-500 mt-1">{errors.barangay}</p>}
        </div>
      )}
    </div>
  )
}
