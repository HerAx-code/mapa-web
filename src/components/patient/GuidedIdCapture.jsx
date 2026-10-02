import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MdClose, MdCameraAlt, MdWarning, MdCheckCircle, MdUploadFile, MdRefresh } from 'react-icons/md'
import { assessFrame } from '../../utils/imageQuality'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useFocusTrap } from '../../hooks/useFocusTrap'

/**
 * GuidedIdCapture — live, guided photo of an ID card
 * (docs/mockups/id-verification/project/GuidedCapture.dc.html).
 *
 * Rear camera + a card frame; a live loop reads sharp / bright / glare off the
 * preview (utils/imageQuality.assessFrame) and shows three chips. It
 * auto-captures when all three hold for ~1s — but a manual Capture and an
 * "Upload a photo instead" fallback are always available, so a low-end camera
 * (or a denied camera permission) never blocks the patient. Captures the ID
 * FRONT (fed into the existing OCR/face-match pipeline) and an OPTIONAL BACK.
 *
 * Advisory only, on-device: nothing is auto-rejected; the quality chips just
 * help the patient take a readable photo. onCapture(frontFile, backFile|null).
 */
const GOOD_TICKS_TO_CAPTURE = 5  // ~1.1s of consecutive good frames at 220ms/tick

export default function GuidedIdCapture({ wantBack = true, onCapture, onClose }) {
  const { t } = useTranslation()
  const videoRef  = useRef(null)
  const streamRef = useRef(null)
  const sampleRef = useRef(null)
  const goodRef   = useRef(0)
  const panelRef  = useRef(null)
  const [error, setError] = useState(false)
  const [step,  setStep]  = useState('front')               // 'front' | 'back'
  const [live,  setLive]  = useState({ sharp: false, bright: false, glare: false })
  const [shots, setShots] = useState({ front: null, back: null })  // { blob, url }

  useEscapeKey(onClose)
  useFocusTrap(panelRef, true)

  const current = shots[step]

  const startCamera = () => {
    const get = (c) => navigator.mediaDevices.getUserMedia(c)
    // Prefer the rear camera for a card; fall back to any camera.
    get({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .catch(() => get({ video: true, audio: false }))
      .then(stream => {
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}) }
      })
      .catch(() => setError(true))
  }

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) { setError(true); return }
    startCamera()
    return () => streamRef.current?.getTracks().forEach(tk => tk.stop())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live quality loop — runs only while previewing the current step (no shot yet).
  useEffect(() => {
    if (error || current) return
    const id = setInterval(() => {
      const v = videoRef.current
      if (!v || !v.videoWidth) return
      const S = 160
      const scale = Math.min(1, S / Math.max(v.videoWidth, v.videoHeight))
      const w = Math.max(1, Math.round(v.videoWidth * scale))
      const h = Math.max(1, Math.round(v.videoHeight * scale))
      let cv = sampleRef.current
      if (!cv) { cv = document.createElement('canvas'); sampleRef.current = cv }
      cv.width = w; cv.height = h
      const cx = cv.getContext('2d', { willReadFrequently: true })
      cx.drawImage(v, 0, 0, w, h)
      const f = assessFrame(cx.getImageData(0, 0, w, h).data, w)
      setLive({ sharp: f.sharp, bright: f.bright, glare: f.glare })
      const allGood = f.sharp && f.bright && !f.glare
      goodRef.current = allGood ? goodRef.current + 1 : 0
      if (goodRef.current >= GOOD_TICKS_TO_CAPTURE) { goodRef.current = 0; capture() }
    }, 220)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, current, step])

  const capture = () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth; canvas.height = v.videoHeight
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(b => {
      if (b) setShots(s => ({ ...s, [step]: { blob: b, url: URL.createObjectURL(b) } }))
    }, 'image/jpeg', 0.85)
  }

  const retake = () => {
    const c = shots[step]
    if (c?.url) URL.revokeObjectURL(c.url)
    setShots(s => ({ ...s, [step]: null }))
    goodRef.current = 0
  }

  const onUpload = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setShots(s => ({ ...s, [step]: { blob: file, url: URL.createObjectURL(file) } }))
  }

  const finish = () => {
    const toFile = (sh, name) => sh?.blob ? new File([sh.blob], name, { type: sh.blob.type || 'image/jpeg' }) : null
    onCapture(toFile(shots.front, `id-front-${Date.now()}.jpg`), wantBack ? toFile(shots.back, `id-back-${Date.now()}.jpg`) : null)
    onClose()
  }

  const Chip = ({ ok, warn, label }) => (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
      warn ? 'bg-amber-100 text-amber-800' : ok ? 'bg-brand-50 text-brand-700' : 'bg-white/80 text-gray-500'
    }`}>
      {warn ? <MdWarning size={13} /> : ok ? <MdCheckCircle size={13} /> : null}{label}
    </span>
  )

  return (
    <div className="fixed inset-0 bg-black/60 z-[200] flex items-end sm:items-center justify-center sm:p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="guidedid-title" tabIndex={-1}
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[94vh] flex flex-col overflow-hidden outline-none">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 id="guidedid-title" className="text-base font-semibold text-gray-900">
            {step === 'front' ? t('patient.request.guidedId.titleFront') : t('patient.request.guidedId.titleBack')}
          </h2>
          <button onClick={onClose} aria-label={t('common.close', 'Close')} className="text-gray-500 hover:text-gray-600"><MdClose size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          {error ? (
            // Camera unavailable / denied → upload-only fallback (never blocks).
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                <MdWarning size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">{t('patient.request.guidedId.noCamera')}</p>
              </div>
              {current
                ? <img src={current.url} alt="" className="w-full rounded-xl border border-gray-200" />
                : (
                  <label className="w-full min-h-[48px] rounded-xl border border-brand-200 text-brand-600 text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer">
                    <MdUploadFile size={16} /> {t('patient.request.guidedId.upload')}
                    <input type="file" accept="image/*" className="hidden" onChange={onUpload} />
                  </label>
                )}
            </>
          ) : current ? (
            // Captured preview for this step.
            <>
              <img src={current.url} alt="" className="w-full rounded-xl border border-gray-200" />
              <button type="button" onClick={retake}
                className="w-full min-h-[44px] rounded-xl border border-gray-300 text-gray-700 text-sm font-semibold inline-flex items-center justify-center gap-1.5">
                <MdRefresh size={16} /> {t('patient.request.guidedId.retake')}
              </button>
            </>
          ) : (
            // Live camera + card frame + quality chips.
            <>
              <p className="text-sm text-gray-600">{t('patient.request.guidedId.fit')}</p>
              <div className="relative rounded-xl overflow-hidden bg-gray-900" style={{ aspectRatio: '1.586' }}>
                <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
                <div className="absolute inset-3 rounded-lg border-2 border-white/80 pointer-events-none" />
                <div className="absolute left-2 right-2 bottom-2 flex flex-wrap gap-1.5">
                  <Chip ok={live.sharp}  label={t('patient.request.guidedId.sharp')} />
                  <Chip ok={live.bright} label={t('patient.request.guidedId.bright')} />
                  {live.glare && <Chip warn label={t('patient.request.guidedId.glare')} />}
                </div>
              </div>
              <p className="text-xs text-gray-500">{t('patient.request.guidedId.autoHint')}</p>
              <button type="button" onClick={capture}
                className="w-full min-h-[48px] rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5">
                <MdCameraAlt size={18} /> {t('patient.request.guidedId.capture')}
              </button>
              <label className="w-full min-h-[44px] rounded-xl border border-gray-300 text-gray-700 text-sm font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer">
                <MdUploadFile size={16} /> {t('patient.request.guidedId.upload')}
                <input type="file" accept="image/*" className="hidden" onChange={onUpload} />
              </label>
            </>
          )}
        </div>

        {/* Footer actions — Front ● / Back ○ progression. Front is required; Back optional. */}
        <div className="px-5 py-3 border-t border-gray-100 flex-shrink-0 flex items-center gap-2">
          <span className="text-xs text-gray-500 mr-auto">
            {wantBack ? (step === 'front' ? t('patient.request.guidedId.frontOfTwo') : t('patient.request.guidedId.backOfTwo')) : ''}
          </span>
          {step === 'front' && shots.front && wantBack && (
            <>
              <button type="button" onClick={finish} className="min-h-[44px] px-3 text-sm font-medium text-gray-600">{t('patient.request.guidedId.frontOnly')}</button>
              <button type="button" onClick={() => setStep('back')} className="min-h-[44px] px-4 rounded-xl bg-brand-500 text-white text-sm font-semibold">{t('patient.request.guidedId.addBack')} →</button>
            </>
          )}
          {step === 'front' && shots.front && !wantBack && (
            <button type="button" onClick={finish} className="min-h-[44px] px-4 rounded-xl bg-brand-500 text-white text-sm font-semibold">{t('patient.request.guidedId.usePhoto')}</button>
          )}
          {step === 'back' && (
            <>
              <button type="button" onClick={finish} className="min-h-[44px] px-3 text-sm font-medium text-gray-600">{t('patient.request.guidedId.skipBack')}</button>
              {shots.back && <button type="button" onClick={finish} className="min-h-[44px] px-4 rounded-xl bg-brand-500 text-white text-sm font-semibold">{t('patient.request.guidedId.usePhotos')}</button>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
