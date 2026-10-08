import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MdClose, MdCameraAlt, MdRefresh, MdCheckCircle, MdWarning, MdRadioButtonUnchecked } from 'react-icons/md'
import { checkLiveness } from '../utils/faceCheck'
import { assessFrame, isBlackFrame } from '../utils/imageQuality'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useFocusTrap } from '../hooks/useFocusTrap'

// Camera-only live selfie capture. Uses getUserMedia (front camera) so the
// photo is a fresh capture, not a gallery pick — basic anti-spoofing. If no
// camera is available / permission is denied, we show the in-person CRMC
// fallback instead of letting the patient upload an arbitrary photo. The
// captured image never leaves the device until the request is submitted.
//
// Phase 4 reskin (docs/mockups/id-verification/project/Selfie.dc.html): an
// immersive dark camera with a prominent framing oval, a cheap LIVE "good
// light" hint (exposure only — assessFrame, no face-api model download), and a
// post-capture checklist + progress that mirror the on-device liveness check.
//
// The liveness check runs on the captured still — a quiet nudge toward a usable
// photo. It NEVER blocks: even an unclear result keeps "Use anyway" available
// (the CRMC social worker makes the final call, and an elderly/ill patient's
// poor camera must not lock them out). The liveness result is handed up via
// onCapture and stamped on the selfie doc as an advisory flag. See
// docs/id-verification-plan.md.
export default function SelfieCaptureModal({ onCapture, onClose, liveness: livenessEnabled = true }) {
  const { t }      = useTranslation()
  const videoRef   = useRef(null)
  const streamRef  = useRef(null)
  const panelRef   = useRef(null)
  const lightCvRef = useRef(null)
  useEscapeKey(onClose)
  useFocusTrap(panelRef, true)
  const [error,    setError]    = useState(false)
  const [preview,  setPreview]  = useState(null)   // dataURL of captured frame
  const [consent,  setConsent]  = useState(false)
  const [blob,     setBlob]     = useState(null)
  const [live,     setLive]     = useState(null)   // { status:'checking'|'done', liveness, livenessScore }
  const [light,    setLight]    = useState(null)   // live exposure hint { bright, glare }

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

  // Cheap live exposure hint (good light / too dark / glare) off the video — the
  // same canvas-sample pattern as GuidedIdCapture. Deliberately exposure-only:
  // a per-frame face detector would pull the ~1.3 MB face-api model on slow
  // phones. The real face + liveness check runs once, on the captured still.
  useEffect(() => {
    if (error || preview) return
    const id = setInterval(() => {
      const v = videoRef.current
      if (!v || !v.videoWidth) return
      try {
        let cv = lightCvRef.current
        if (!cv) { cv = document.createElement('canvas'); lightCvRef.current = cv }
        const w = 160, h = Math.round((v.videoHeight / v.videoWidth) * 160) || 120
        cv.width = w; cv.height = h
        const cx = cv.getContext('2d', { willReadFrequently: true })
        cx.drawImage(v, 0, 0, w, h)
        const { bright, glare } = assessFrame(cx.getImageData(0, 0, w, h).data, w)
        setLight({ bright, glare })
      } catch { /* keep going */ }
    }, 500)
    return () => clearInterval(id)
  }, [error, preview])

  const stopStream = () => streamRef.current?.getTracks().forEach(tk => tk.stop())

  // On mobile, drawImage(video) can return an all-black frame before the video
  // has painted a decodable frame (videoWidth is set before readyState reaches
  // HAVE_CURRENT_DATA; iOS composites the first frames late). Require a ready
  // frame and retry on an all-black capture before accepting it, and only stop
  // the camera stream AFTER a good frame — otherwise a retry would have no video.
  const capture = (attempt = 0) => {
    const video = videoRef.current
    if (!video || !video.videoWidth || video.readyState < 2) {
      if (attempt < 12) setTimeout(() => capture(attempt + 1), 120)
      return
    }
    const MAX = 1920
    const scale = Math.min(1, MAX / Math.max(video.videoWidth, video.videoHeight))
    const cw = Math.max(1, Math.round(video.videoWidth * scale))
    const ch = Math.max(1, Math.round(video.videoHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = cw; canvas.height = ch
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(video, 0, 0, cw, ch)
    let black = false
    try {
      const d = ctx.getImageData(Math.round(cw * 0.25), Math.round(ch * 0.25),
        Math.max(1, Math.round(cw * 0.5)), Math.max(1, Math.round(ch * 0.5))).data
      black = isBlackFrame(d)
    } catch { /* can't read → don't block */ }
    if (black && attempt < 12) {
      setTimeout(() => capture(attempt + 1), 120)
      return
    }
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
  const done     = live?.status === 'done'
  const faceOk   = done && live.liveness != null          // a face was detected on the still
  const unclear  = done && live.liveness !== 'pass'
  const useLabel = unclear ? t('patient.request.selfieUseAnyway') : t('patient.request.selfieUse')

  // Live exposure verdict for the pre-capture chip.
  const lightState = light == null ? null : light.glare ? 'glare' : !light.bright ? 'dark' : 'good'

  return (
    <div className="fixed inset-0 bg-black/70 z-[200] flex items-stretch sm:items-center justify-center sm:p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="selfie-modal-title"
        tabIndex={-1}
        className="relative w-full sm:max-w-sm sm:max-h-[94vh] flex flex-col overflow-hidden bg-[#0B1512] text-white sm:rounded-2xl outline-none">
        {/* Header */}
        <div className="flex items-center justify-between pl-4 pr-2 h-14 flex-shrink-0">
          <span id="selfie-modal-title" className="text-[15px] font-semibold">{t('patient.request.selfieTitle')}</span>
          <button onClick={onClose} aria-label={t('common.close', 'Close')}
            className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white">
            <MdClose size={20} />
          </button>
        </div>

        {error ? (
          <div className="flex-1 flex items-center justify-center px-6 pb-8">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 text-left">
              <MdWarning size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">{t('patient.request.selfieNoCamera')}</p>
            </div>
          </div>
        ) : (
          <>
            {/* Bilingual display headline */}
            <div className="px-6 text-center flex-shrink-0">
              <div className="font-display text-[22px] font-bold leading-tight">{t('patient.request.selfieHeadline')}</div>
              <div className="text-[15px] text-[#C9D6D1] mt-1">{t('patient.request.selfieHeadlineSub')}</div>
            </div>

            {/* Framing oval — the live camera or the captured preview clipped into it */}
            <div className="flex-grow flex items-center justify-center min-h-0 py-4">
              <div className="relative w-[230px] max-w-[62vw] aspect-[230/300] rounded-[50%] border-4 border-[#4BC399] overflow-hidden bg-[#1B2A25] flex items-center justify-center">
                {preview
                  ? <img src={preview} alt="selfie preview" className="w-full h-full object-cover" />
                  : <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />}
              </div>
            </div>

            {/* Status area: live light hint before capture; checklist + progress after */}
            <div className="px-6 pb-4 flex flex-col gap-2 flex-shrink-0 min-h-[64px]">
              {!preview ? (
                lightState && (
                  <div className="flex items-center gap-2.5 text-sm">
                    {lightState === 'good'
                      ? <span className="w-[22px] h-[22px] rounded-full bg-[#0F6E56] flex items-center justify-center flex-shrink-0"><MdCheckCircle size={14} /></span>
                      : <span className="w-[22px] h-[22px] rounded-full bg-amber-500/90 flex items-center justify-center flex-shrink-0"><MdWarning size={13} /></span>}
                    {lightState === 'good'
                      ? t('patient.request.selfieLightGood')
                      : lightState === 'glare' ? t('patient.request.exposureGlare') : t('patient.request.exposureDark')}
                  </div>
                )
              ) : livenessEnabled ? (
                <>
                  <ChecklistRow
                    state={checking ? 'pending' : faceOk ? 'ok' : 'warn'}
                    label={t('patient.request.selfieFaceLight')} />
                  <ChecklistRow
                    state={checking ? 'checking' : unclear ? 'warn' : 'ok'}
                    label={checking
                      ? t('patient.request.selfieCheckLive')
                      : unclear ? t('patient.request.selfieLiveUnclear') : t('patient.request.selfieLiveOk')} />
                  <div className="h-1.5 rounded-full bg-white/15 overflow-hidden mt-0.5">
                    <div className={`h-full rounded-full bg-[#4BC399] transition-all duration-500 ${checking ? 'w-3/5 animate-pulse' : 'w-full'}`} />
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2.5 text-sm">
                  <MdCheckCircle size={18} className="text-[#4BC399]" /> {t('patient.request.selfieReady')}
                </div>
              )}
            </div>

            {/* White reassurance sheet — tips, the on-device promise, consent + actions */}
            <div className="bg-white text-gray-900 rounded-t-2xl sm:rounded-b-2xl px-4 pt-4 pb-6 flex flex-col gap-3 flex-shrink-0">
              {!preview && (
                <div className="flex gap-2 flex-wrap">
                  <span className="text-[13px] px-2.5 py-1.5 rounded-lg bg-gray-100">{t('patient.request.selfieTipCap')}</span>
                  <span className="text-[13px] px-2.5 py-1.5 rounded-lg bg-gray-100">{t('patient.request.selfieTipLight')}</span>
                </div>
              )}
              <p className="text-[13px] text-gray-700 leading-relaxed">{t('patient.request.selfieReassure')}</p>

              {preview && (
                <>
                  {/* Review gate — the photo is never used until the patient
                      confirms it (consent + Use); Retake is always available. */}
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
                    <MdWarning size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-[13px] text-amber-800">{t('patient.request.selfieReviewHint')}</p>
                  </div>
                  <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer select-none">
                    <input type="checkbox" className="mt-0.5 w-4 h-4 accent-brand-500 flex-shrink-0"
                      checked={consent} onChange={e => setConsent(e.target.checked)} />
                    <span>{t('patient.request.selfieConsent')}</span>
                  </label>
                </>
              )}

              <div className="flex gap-2 justify-end">
                {preview ? (
                  <>
                    <button className="btn-secondary text-sm flex items-center gap-1.5 min-h-[44px]" onClick={retake}>
                      <MdRefresh size={15} /> {t('patient.request.selfieRetake')}
                    </button>
                    <button className="btn-primary text-sm flex items-center gap-1.5 min-h-[44px]" onClick={use} disabled={!consent}>
                      <MdCheckCircle size={15} /> {useLabel}
                    </button>
                  </>
                ) : (
                  <button className="btn-primary text-sm flex items-center gap-1.5 min-h-[44px] w-full justify-center" onClick={capture}>
                    <MdCameraAlt size={15} /> {t('patient.request.selfieCapture')}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// One row of the post-capture checklist (on the dark panel). 'checking' spins,
// 'ok' is a green check, 'warn' an amber caution, 'pending' a quiet ring.
function ChecklistRow({ state, label }) {
  const icon = state === 'checking'
    ? <MdRefresh size={16} className="text-white animate-spin" />
    : state === 'ok'
      ? <span className="w-[22px] h-[22px] rounded-full bg-[#0F6E56] flex items-center justify-center"><MdCheckCircle size={14} /></span>
      : state === 'warn'
        ? <span className="w-[22px] h-[22px] rounded-full bg-amber-500/90 flex items-center justify-center"><MdWarning size={13} /></span>
        : <MdRadioButtonUnchecked size={22} className="text-[#4BC399]" />
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <span className="flex-shrink-0 w-[22px] h-[22px] flex items-center justify-center">{icon}</span>
      <span className="leading-snug">{label}</span>
    </div>
  )
}
