import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MdClose, MdQrCodeScanner, MdBadge, MdCheckCircle, MdWarningAmber, MdLock } from 'react-icons/md'
import { decodeQrFromImageData, parsePhilId, maskPcn, pcnFingerprint, normalizePcn } from '../../utils/philIdQr'
// NOTE: pcnFingerprint is async (WebCrypto HMAC) — both the QR-result and the
// typed-PCN continue handlers await it, so the stored fingerprint is never the
// raw PCN, only a keyed one-way hash. See docs/id-verification-plan.md §5.3.
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useFocusTrap } from '../../hooks/useFocusTrap'

/**
 * IdentityStep — the optional "Scan your National ID" accelerator
 * (docs/mockups/.../IdChoice, QrScan, QrResult, PcnManual). Behind
 * VITE_PHILID_QR_ENABLED; launched from the ID card as a MODAL (not a wizard
 * rewire). PhilSys is PREFERRED, never required — "Use another valid ID" is an
 * equal path (RA 11055). The 12-digit PSN is NEVER collected; the 16-digit PCN
 * is a masked, "unverified" fallback. Everything on-device + advisory; the social
 * worker makes the final call.
 *
 * onScanned(idFile, meta)  — an ID photo (QR frame) + identity metadata to persist
 * onPcn(meta)              — typed-PCN fallback: meta only; patient then takes an ID photo
 * onUseOther()             — fall back to the normal "other valid ID" guided capture
 * onClose()
 */
export default function IdentityStep({ accountName = '', onScanned, onPcn, onUseOther, onClose }) {
  const { t } = useTranslation()
  const [view, setView] = useState('choice')   // choice | scan | result | pcn
  const [parsed, setParsed] = useState(null)
  const [pcnInput, setPcnInput] = useState('')
  const panelRef = useRef(null)
  useEscapeKey(onClose)
  useFocusTrap(panelRef, true)

  return (
    <div className="fixed inset-0 bg-black/60 z-[200] flex items-end sm:items-center justify-center sm:p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="identity-title" tabIndex={-1}
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[94vh] flex flex-col overflow-hidden outline-none">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 id="identity-title" className="text-base font-semibold text-gray-900">{t('patient.request.identity.title')}</h2>
          <button onClick={onClose} aria-label={t('common.close', 'Close')} className="text-gray-500 hover:text-gray-600"><MdClose size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          {view === 'choice' && (
            <IdChoice t={t} onScan={() => setView('scan')} onUseOther={onUseOther} />
          )}
          {view === 'scan' && (
            <QrScan t={t}
              onDecoded={(p) => { setParsed(p); setView('result') }}
              onPcn={() => setView('pcn')}
              onUseOther={onUseOther} />
          )}
          {view === 'result' && parsed && (
            <QrResult t={t} parsed={parsed} accountName={accountName}
              onContinue={async (idFile) => onScanned(idFile, {
                idVerifyMethod: 'philid_qr',
                philIdName: parsed.name ?? null,
                philIdDob: parsed.dob ?? null,
                pcnLast4: parsed.pcn ? maskPcn(parsed.pcn) : null,
                pcnFingerprint: parsed.pcn ? await pcnFingerprint(parsed.pcn) : null,
                signatureValid: parsed.signatureValid ?? null,
              })}
              onRescan={() => { setParsed(null); setView('scan') }} />
          )}
          {view === 'pcn' && (
            <PcnManual t={t} value={pcnInput} onChange={setPcnInput}
              onContinue={async () => {
                const fp = await pcnFingerprint(pcnInput)
                onPcn({ idVerifyMethod: 'pcn_manual', pcnLast4: maskPcn(pcnInput), pcnFingerprint: fp, signatureValid: null })
              }} />
          )}
        </div>
      </div>
    </div>
  )
}

function IdChoice({ t, onScan, onUseOther }) {
  return (
    <>
      <p className="text-sm text-gray-600">{t('patient.request.identity.subtitle')}</p>
      <button type="button" onClick={onScan}
        className="w-full text-left rounded-2xl border-2 border-brand-200 bg-brand-50 p-4 flex items-start gap-3">
        <MdQrCodeScanner size={28} className="text-brand-600 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="eyebrow text-brand-600">{t('patient.request.identity.fastest')}</p>
          <p className="text-[15px] font-semibold text-gray-900">{t('patient.request.identity.scanTitle')}</p>
          <p className="text-xs text-gray-600 mt-0.5">{t('patient.request.identity.scanDesc')}</p>
        </div>
      </button>
      <button type="button" onClick={onUseOther}
        className="w-full text-left rounded-2xl border border-gray-200 p-4 flex items-start gap-3">
        <MdBadge size={28} className="text-gray-500 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-gray-900">{t('patient.request.identity.otherTitle')}</p>
          <p className="text-xs text-gray-600 mt-0.5">{t('patient.request.identity.otherDesc')}</p>
        </div>
      </button>
      <p className="text-xs text-gray-500 inline-flex items-start gap-1.5">
        <MdLock size={14} className="flex-shrink-0 mt-0.5" /> {t('patient.request.identity.psnNever')}
      </p>
    </>
  )
}

function QrScan({ t, onDecoded, onPcn, onUseOther }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const canvasRef = useRef(null)
  const busyRef = useRef(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) { setError(true); return }
    const get = (c) => navigator.mediaDevices.getUserMedia(c)
    get({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .catch(() => get({ video: true, audio: false }))
      .then(stream => { streamRef.current = stream; if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}) } })
      .catch(() => setError(true))
    return () => streamRef.current?.getTracks().forEach(tk => tk.stop())
  }, [])

  useEffect(() => {
    if (error) return
    const id = setInterval(async () => {
      if (busyRef.current) return
      const v = videoRef.current
      if (!v || !v.videoWidth) return
      busyRef.current = true
      try {
        const w = v.videoWidth, h = v.videoHeight
        let cv = canvasRef.current
        if (!cv) { cv = document.createElement('canvas'); canvasRef.current = cv }
        cv.width = w; cv.height = h
        const cx = cv.getContext('2d', { willReadFrequently: true })
        cx.drawImage(v, 0, 0, w, h)
        const str = await decodeQrFromImageData(cx.getImageData(0, 0, w, h))
        if (str) {
          const parsed = await parsePhilId(str)
          if (parsed) {
            // Capture the current frame as the "ID photo" that backs this scan.
            cv.toBlob(b => {
              parsed._file = b ? new File([b], `philid-${Date.now()}.jpg`, { type: 'image/jpeg' }) : null
              streamRef.current?.getTracks().forEach(tk => tk.stop())
              onDecoded(parsed)
            }, 'image/jpeg', 0.85)
          }
        }
      } catch { /* keep scanning */ }
      busyRef.current = false
    }, 350)
    return () => clearInterval(id)
  }, [error, onDecoded])

  if (error) {
    return (
      <>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <MdWarningAmber size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">{t('patient.request.identity.noCamera')}</p>
        </div>
        <button type="button" onClick={onPcn} className="w-full min-h-[44px] rounded-xl border border-brand-200 text-brand-600 text-sm font-semibold">{t('patient.request.identity.typePcn')}</button>
        <button type="button" onClick={onUseOther} className="w-full min-h-[44px] text-gray-600 text-sm font-medium">{t('patient.request.identity.useOtherInstead')}</button>
      </>
    )
  }

  return (
    <>
      <p className="text-sm text-gray-600">{t('patient.request.identity.pointCamera')}</p>
      <div className="relative rounded-xl overflow-hidden bg-gray-900" style={{ aspectRatio: '1' }}>
        <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-8 rounded-xl border-2 border-white/80 pointer-events-none" />
      </div>
      <p className="text-xs text-gray-500">{t('patient.request.identity.holdSteady')}</p>
      <button type="button" onClick={onPcn} className="w-full min-h-[44px] rounded-xl border border-gray-300 text-gray-700 text-sm font-medium">{t('patient.request.identity.typePcn')}</button>
      <button type="button" onClick={onUseOther} className="w-full min-h-[44px] text-gray-600 text-sm font-medium">{t('patient.request.identity.useOtherInstead')}</button>
    </>
  )
}

function QrResult({ t, parsed, accountName, onContinue, onRescan }) {
  const verified = parsed.signatureValid === true
  const nameMatches = !!parsed.name && !!accountName &&
    parsed.name.toLowerCase().replace(/[^a-z]/g, '').includes(accountName.toLowerCase().split(' ')[0].replace(/[^a-z]/g, ''))
  return (
    <>
      <div className="flex items-center gap-2">
        <MdCheckCircle size={22} className={verified ? 'text-brand-600' : 'text-gray-400'} />
        <p className="text-base font-semibold text-gray-900">{t('patient.request.identity.resultTitle')}</p>
      </div>
      <p className={`text-xs ${verified ? 'text-brand-600' : 'text-amber-700'}`}>
        {verified ? t('patient.request.identity.sigValid') : t('patient.request.identity.sigUnverified')}
      </p>
      <div className="rounded-xl border border-gray-200 p-3 space-y-2">
        <Field t={t} label={t('patient.request.identity.name')} value={parsed.name} match={nameMatches} />
        <Field t={t} label={t('patient.request.identity.dob')} value={parsed.dob} />
        {parsed.pcn && <Field t={t} label={t('patient.request.identity.pcn')} value={maskPcn(parsed.pcn)} />}
      </div>
      <p className="text-xs text-gray-500">{t('patient.request.identity.nextSelfie')}</p>
      <button type="button" onClick={() => onContinue(parsed._file ?? null)}
        className="w-full min-h-[48px] rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold">{t('patient.request.identity.continue')}</button>
      <button type="button" onClick={onRescan} className="w-full min-h-[44px] text-gray-600 text-sm font-medium">{t('patient.request.identity.rescan')}</button>
    </>
  )
}

function Field({ t, label, value, match }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-sm font-medium text-gray-900 break-words">
        {value || '—'}
        {match && <span className="ml-1.5 text-xs text-brand-600 font-medium">{t('patient.request.identity.matchesAccount')}</span>}
      </p>
    </div>
  )
}

function PcnManual({ t, value, onChange, onContinue }) {
  const ok = !!normalizePcn(value)
  const grouped = (value.replace(/\D/g, '').match(/.{1,4}/g) ?? []).join('-')
  return (
    <>
      <p className="text-sm text-gray-600">{t('patient.request.identity.typePcnTitle')}</p>
      <input
        inputMode="numeric"
        value={grouped}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 16))}
        placeholder="0000-0000-0000-0000"
        className="input w-full tracking-widest text-center"
        aria-label={t('patient.request.identity.pcn')} />
      <p className="text-xs text-gray-500">{normalizePcn(value) ? '16 / 16' : `${value.replace(/\D/g, '').length} / 16`}</p>
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
        <MdWarningAmber size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800">{t('patient.request.identity.notYourPsn')}</p>
      </div>
      <p className="text-xs text-gray-500">{t('patient.request.identity.pcnUnverified')}</p>
      <button type="button" disabled={!ok} onClick={onContinue}
        className="w-full min-h-[48px] rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-semibold">{t('patient.request.identity.continue')}</button>
    </>
  )
}
