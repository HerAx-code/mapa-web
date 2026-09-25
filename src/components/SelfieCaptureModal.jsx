import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MdClose, MdCameraAlt, MdRefresh, MdCheckCircle, MdWarning } from 'react-icons/md'
import { checkLiveness } from '../utils/faceCheck'

// Camera-only live selfie capture. Uses getUserMedia (front camera) so the
// photo is a fresh capture, not a gallery pick — basic anti-spoofing. If no
// camera is available / permission is denied, we show the in-person CRMC
// fallback instead of letting the patient upload an arbitrary photo. The
// captured image never leaves the device until the request is submitted.
//
// A face-oval overlay guides framing, and an on-device liveness check runs on
// the captured still — a quiet nudge toward a usable photo. It NEVER blocks:
// even an unclear result keeps "Use anyway" available (the CRMC social worker
// makes the final call, and an elderly/ill patient's poor camera must not lock
// them out). The liveness result is handed up via onCapture and stamped on the
// selfie doc as an advisory flag. See docs/id-verification-plan.md.
export default function SelfieCaptureModal({ onCapture, onClose, liveness: livenessEnabled = true }) {
  const { t }      = useTranslation()
  const videoRef   = useRef(null)
  const streamRef  = useRef(null)
  const [error,    setError]    = useState(false)
  const [preview,  setPreview]  = useState(null)   // dataURL of captured frame
  const [consent,  setConsent]  = useState(false)
  const [blob,     setBlob]     = useState(null)
  const [live,     setLive]     = useState(null)   // { status:'checking'|'done', liveness, livenessScore }

  const startCamera = () => {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(stream => {
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}) }
      })
      .catch(() => setError(true))
  }

  useEffect(() => {
    let cancelled = false
    if (!navigator.mediaDevices?.getUserMedia) { setError(true); return }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(tk => tk.stop()); return }
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}) }
      })
      .catch(() => setError(true))
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(tk => tk.stop())
    }
  }, [])

  const stopStream = () => streamRef.current?.getTracks().forEach(tk => tk.stop())

  const capture = () => {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width  = video.videoWidth  || 640
    canvas.height = video.videoHeight || 480
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
    setPreview(canvas.toDataURL('image/jpeg', 0.85))
    if (livenessEnabled) setLive({ status: 'checking' })
    canvas.toBlob(b => {
      setBlob(b)
      // Advisory on-device liveness on the captured still (never blocks).
      // Skipped when the ID-verify feature flag is off (no model download).
      if (livenessEnabled && b) {
        checkLiveness(new File([b], 'selfie.jpg', { type: 'image/jpeg' }))
          .then(r => setLive({ status: 'done', liveness: r.liveness, livenessScore: r.livenessScore }))
          .catch(() => setLive({ status: 'done', liveness: null, livenessScore: null }))
      } else if (livenessEnabled) {
        setLive({ status: 'done', liveness: null, livenessScore: null })
      }
    }, 'image/jpeg', 0.85)
    stopStream()
  }

  const retake = () => {
    setPreview(null); setBlob(null); setLive(null)
    startCamera()
  }

  const use = () => {
    if (!blob || !consent) return
    const file = new File([blob], `selfie-${Date.now()}.jpg`, { type: 'image/jpeg' })
    onCapture(file, { liveness: live?.liveness ?? null, livenessScore: live?.livenessScore ?? null })
    onClose()
  }

  const checking = live?.status === 'checking'
  const unclear  = live?.status === 'done' && live.liveness !== 'pass'
  const useLabel = unclear ? t('patient.request.selfieUseAnyway') : t('patient.request.selfieUse')

  return (
    <div className="fixed inset-0 bg-black/50 z-[200] flex items-end sm:items-center justify-center sm:p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{t('patient.request.selfieTitle')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          {error ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
              <MdWarning size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">{t('patient.request.selfieNoCamera')}</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-500">{t('patient.request.selfieHint')}</p>
              <div className="relative rounded-xl overflow-hidden bg-gray-900 aspect-[3/4] flex items-center justify-center">
                {preview
                  ? <img src={preview} alt="selfie preview" className="w-full h-full object-cover" />
                  : <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />}

                {/* Face-oval framing guide (live view only) */}
                {!preview && (
                  <div aria-hidden="true"
                    className="pointer-events-none absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2
                               w-[58%] aspect-[3/4] rounded-[50%] border-[3px] border-dashed border-white/80" />
                )}

                {/* Liveness result banner (after capture) */}
                {preview && checking && (
                  <div className="absolute inset-x-0 bottom-0 px-3 py-2 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent">
                    <MdRefresh size={16} className="text-white animate-spin flex-shrink-0" />
                    <span className="text-xs font-medium text-white">{t('patient.request.selfieChecking')}</span>
                  </div>
                )}
                {preview && live?.status === 'done' && (
                  <div className={`absolute inset-x-0 bottom-0 px-3 py-2 flex items-start gap-2 bg-gradient-to-t ${live.liveness === 'pass' ? 'from-green-900/80' : 'from-amber-900/80'} to-transparent`}>
                    {live.liveness === 'pass'
                      ? <MdCheckCircle size={16} className="text-green-300 flex-shrink-0 mt-0.5" />
                      : <MdWarning size={16} className="text-amber-200 flex-shrink-0 mt-0.5" />}
                    <span className="text-xs font-medium text-white">
                      {live.liveness === 'pass' ? t('patient.request.selfieLiveOk') : t('patient.request.selfieLiveUnclear')}
                    </span>
                  </div>
                )}
              </div>

              <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer select-none">
                <input type="checkbox" className="mt-0.5 w-4 h-4 accent-brand-500 flex-shrink-0"
                  checked={consent} onChange={e => setConsent(e.target.checked)} />
                <span>{t('patient.request.selfieConsent')}</span>
              </label>
            </>
          )}
        </div>

        {!error && (
          <div className="px-5 pb-4 pt-3 flex gap-2 justify-end border-t border-gray-100 flex-shrink-0">
            {preview ? (
              <>
                <button className="btn-secondary text-sm flex items-center gap-1.5" onClick={retake}>
                  <MdRefresh size={15} /> {t('patient.request.selfieRetake')}
                </button>
                <button className="btn-primary text-sm flex items-center gap-1.5" onClick={use} disabled={!consent}>
                  <MdCheckCircle size={15} /> {useLabel}
                </button>
              </>
            ) : (
              <button className="btn-primary text-sm flex items-center gap-1.5" onClick={capture}>
                <MdCameraAlt size={15} /> {t('patient.request.selfieCapture')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
