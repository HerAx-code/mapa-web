import { MdCameraAlt, MdUploadFile, MdClose, MdCheckCircle, MdDescription, MdWarningAmber, MdAutorenew } from 'react-icons/md'
import { LOW_OCR_CONFIDENCE } from '../../utils/idOcr'

/**
 * DocChecklist — the patient's required-documents step, as a clean card list
 * (docs/mockups/id-verification/project/DocChecklist.dc.html). Each required
 * document is one card whose chip reflects its real state:
 *
 *   todo        → a 44px+ Attach / Take selfie action
 *   checking    → on-device OCR running on an ID (advisory)
 *   ready       → a file is attached for this request
 *   needs-retake→ OCR says "doesn't look like an ID" / unreadable, or the photo
 *                 is too dark / has glare — shown with the reason + a Retake action
 *   reused      → a reusable type already satisfied by a verified doc on file
 *   saving      → the submit upload is writing this doc (honest: reflects the
 *                 real base64 write, retried on failure — not byte-metered)
 *
 * Presentational only: all state + handlers come from RequestAssistance.jsx, so
 * the OCR / face-match / selfie / submit logic stays in one place. Patient-facing
 * → every string is a t() key (bilingual) and every control is ≥44px.
 */
export default function DocChecklist({
  docTypes = [],
  pendingFiles = {},
  docForType,
  verifiedTypeNames,
  ocrResults = {},
  ocrRunning = {},
  uploadState = {},
  isIdType,
  isSelfieType,
  qualityAck = {},
  onAckQuality,
  onAttach,
  onSelfie,
  onGuidedCapture,
  onScanId,
  onRemove,
  onRetryOcr,
  t,
}) {
  const readyCount = docTypes.filter(tp =>
    !!pendingFiles[tp.name] || (tp.reusable && verifiedTypeNames.has(tp.name.toLowerCase()))
  ).length

  return (
    <div>
      {/* Progress header — "N of M ready". The full wizard step bar is owned by
          the parent; this names progress within the checklist. */}
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('patient.request.documentsTitle')}</p>
        <p className="text-sm font-semibold text-brand-600">{t('patient.request.docCard.nOfMReady', { done: readyCount, total: docTypes.length })}</p>
      </div>
      <p className="text-xs text-gray-500 mb-3">{t('patient.request.documentsHint')}</p>

      {docTypes.length === 0 ? (
        <p className="text-xs text-gray-500 italic">{t('patient.request.documentsNone')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {docTypes.map(tp => (
            <DocCard
              key={tp.id}
              tp={tp}
              pending={pendingFiles[tp.name]}
              reusedDoc={tp.reusable && !pendingFiles[tp.name] && verifiedTypeNames.has(tp.name.toLowerCase()) ? docForType(tp.name) : null}
              ocr={ocrResults[tp.name]}
              ocrBusy={!!ocrRunning[tp.name]}
              upload={uploadState[tp.name]}
              isId={isIdType(tp.name)}
              isSelfie={isSelfieType(tp.name)}
              acked={!!qualityAck[tp.name]}
              onAckQuality={onAckQuality}
              onAttach={onAttach}
              onSelfie={onSelfie}
              onGuidedCapture={onGuidedCapture}
              onScanId={onScanId}
              onRemove={onRemove}
              onRetryOcr={onRetryOcr}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DocCard({ tp, pending, reusedDoc, ocr, ocrBusy, upload, isId, isSelfie, acked, onAckQuality, onAttach, onSelfie, onGuidedCapture, onScanId, onRemove, onRetryOcr, t }) {
  // "Doesn't look like an ID": no ID keyword, no name match, no face found.
  // hasFace must be explicitly false (null = couldn't run → no warn).
  const notAnId     = isId && ocr && !ocrBusy && ocr.hasFace === false && ocr.idType == null && ocr.match !== true
  const unreadable  = isId && ocr && !ocrBusy && ocr.match == null && !ocr.text
  // Combined capture quality: too small / dark / glary / blurry (imageQuality).
  const badQuality  = ocr && !ocrBusy && ocr.quality != null
  // OCR text too shaky to trust — unless the name matched, which means the read
  // was good enough regardless of the aggregate score.
  const lowConf     = isId && ocr && !ocrBusy && typeof ocr.confidence === 'number'
                      && ocr.confidence < LOW_OCR_CONFIDENCE && ocr.match !== true
  const poorPhoto   = !!pending && (notAnId || unreadable || badQuality || lowConf)
  // Explicit-override model: a poor photo flags for retake and BLOCKS submit
  // (parent mirrors this) until the patient retakes or taps "Use it anyway".
  const needsRetake = poorPhoto && !acked

  const retakeReason = notAnId
    ? t('patient.request.ocrNotAnId')
    : unreadable
      ? t('patient.request.ocrUnreadable')
      : ocr?.quality === 'small'
        ? t('patient.request.qualitySmall')
        : ocr?.quality === 'blurry'
          ? t('patient.request.qualityBlurry')
          : ocr?.quality === 'glare'
            ? t('patient.request.exposureGlare')
            : ocr?.quality === 'dark'
              ? t('patient.request.exposureDark')
              : t('patient.request.ocrLowConfidence')

  const cardCls = needsRetake
    ? 'border-2 border-amber-600'
    : 'border border-gray-200'
  const tileCls = needsRetake
    ? 'bg-amber-200 text-amber-800'
    : pending || reusedDoc
      ? 'bg-brand-50 text-brand-600'
      : 'bg-gray-100 text-gray-400'
  const TileIcon = isSelfie ? MdCameraAlt : MdDescription

  // Status line under the title.
  let statusLine = null
  if (upload === 'saving') {
    statusLine = <span className="text-brand-600 font-medium inline-flex items-center gap-1"><MdAutorenew size={13} className="animate-spin" /> {t('patient.request.docCard.saving')}</span>
  } else if (upload === 'error') {
    statusLine = <span className="text-red-600 font-medium">{t('patient.request.docCard.uploadFailed')}</span>
  } else if (needsRetake) {
    statusLine = <span className="text-amber-800 font-medium">{retakeReason}</span>
  } else if (poorPhoto && acked) {
    // Overridden: keep an honest note that the photo was flagged.
    statusLine = <span className="text-gray-500">{t('patient.request.qualityUsingAnyway')}</span>
  } else if (pending) {
    statusLine = ocrBusy
      ? <span className="text-gray-500">{t('patient.request.ocrChecking')}</span>
      : isId && ocr?.match === true
        ? <span className="text-brand-600 font-medium inline-flex items-center gap-1"><MdCheckCircle size={13} /> {t('patient.request.ocrMatch')}</span>
        : <span className="text-brand-600 font-medium inline-flex items-center gap-1"><MdCheckCircle size={13} /> {t('patient.request.docCard.ready')}</span>
  } else if (reusedDoc) {
    statusLine = <span className="text-gray-600">{t('patient.request.docCard.reused', { date: reusedDoc.date ?? '' })}</span>
  }

  return (
    <div className={`bg-white rounded-2xl p-3 flex flex-col gap-2.5 ${cardCls}`}>
      <div className="flex items-center gap-3">
        <div className={`w-13 h-13 flex-shrink-0 rounded-lg flex items-center justify-center ${tileCls}`} style={{ width: 52, height: 52 }}>
          {needsRetake ? <MdWarningAmber size={24} /> : <TileIcon size={22} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-gray-900">
            {tp.name}{!pending && !reusedDoc && <span className="text-red-400"> *</span>}
          </p>
          {statusLine && <p className="text-[13px] mt-0.5 break-words">{statusLine}</p>}
        </div>
        {/* Right-aligned secondary action on ready/reused cards */}
        {pending && !needsRetake && upload == null && (
          <button type="button" onClick={() => onRemove(tp.name)}
            aria-label={t('shell.common.remove', 'Remove')}
            className="flex-shrink-0 min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-gray-400 hover:text-red-500">
            <MdClose size={20} />
          </button>
        )}
        {reusedDoc && (
          isSelfie
            ? <button type="button" onClick={() => onSelfie(tp.name)} className="flex-shrink-0 min-h-[44px] px-3 text-brand-600 font-semibold text-sm">{t('patient.request.replace')}</button>
            : <label className="flex-shrink-0 min-h-[44px] px-3 inline-flex items-center text-brand-600 font-semibold text-sm cursor-pointer">
                {t('patient.request.replace')}
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onAttach(tp.name)} />
              </label>
        )}
      </div>

      {/* Upload progress bar — shown while this doc is being written at submit.
          Indeterminate on purpose: a base64 Firestore write isn't byte-metered. */}
      {upload === 'saving' && (
        <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
          <div className="h-full w-2/5 rounded-full bg-brand-500 animate-pulse" />
        </div>
      )}

      {/* Primary action — attach / take selfie / guided ID photo (todo). */}
      {!pending && !reusedDoc && (
        isSelfie ? (
          <button type="button" onClick={() => onSelfie(tp.name)}
            className="w-full min-h-[44px] rounded-xl border border-brand-200 text-brand-600 text-sm font-semibold inline-flex items-center justify-center gap-1.5">
            <MdCameraAlt size={16} /> {t('patient.request.takeSelfie')}
          </button>
        ) : isId && onScanId ? (
          // Flag-on (VITE_PHILID_QR_ENABLED): one CTA opens the identity step,
          // which itself offers Scan National ID / Use another ID / type PCN.
          <>
            <button type="button" onClick={() => onScanId(tp.name)}
              className="w-full min-h-[44px] rounded-xl border border-brand-200 text-brand-600 text-sm font-semibold inline-flex items-center justify-center gap-1.5">
              <MdCameraAlt size={16} /> {t('patient.request.identity.verifyCta')}
            </button>
            <label className="self-center text-xs text-gray-500 underline underline-offset-2 min-h-[44px] inline-flex items-center cursor-pointer">
              {t('patient.request.guidedId.orUpload')}
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onAttach(tp.name)} />
            </label>
          </>
        ) : isId && onGuidedCapture ? (
          <>
            <button type="button" onClick={() => onGuidedCapture(tp.name)}
              className="w-full min-h-[44px] rounded-xl border border-brand-200 text-brand-600 text-sm font-semibold inline-flex items-center justify-center gap-1.5">
              <MdCameraAlt size={16} /> {t('patient.request.guidedId.takeIdPhoto')}
            </button>
            <label className="self-center text-xs text-gray-500 underline underline-offset-2 min-h-[44px] inline-flex items-center cursor-pointer">
              {t('patient.request.guidedId.orUpload')}
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onAttach(tp.name)} />
            </label>
          </>
        ) : (
          <label className="w-full min-h-[44px] rounded-xl border border-brand-200 text-brand-600 text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer">
            <MdUploadFile size={16} /> {t('patient.request.docAttach')}
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onAttach(tp.name)} />
          </label>
        )
      )}

      {needsRetake && (
        isSelfie ? (
          <button type="button" onClick={() => onSelfie(tp.name)}
            className="w-full min-h-[44px] rounded-xl bg-amber-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5">
            <MdCameraAlt size={16} /> {t('patient.request.docCard.retakePhoto')}
          </button>
        ) : isId && onGuidedCapture ? (
          <button type="button" onClick={() => onGuidedCapture(tp.name)}
            className="w-full min-h-[44px] rounded-xl bg-amber-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5">
            <MdCameraAlt size={16} /> {t('patient.request.docCard.retakePhoto')}
          </button>
        ) : (
          <label className="w-full min-h-[44px] rounded-xl bg-amber-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer">
            <MdCameraAlt size={16} /> {t('patient.request.docCard.retakePhoto')}
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onAttach(tp.name)} />
          </label>
        )
      )}

      {/* Explicit override — advisory quality is never a hard block (CLAUDE.md:
          don't lock out a poor-camera patient). A deliberate tap proceeds with
          the flagged photo and unblocks submit. */}
      {needsRetake && onAckQuality && (
        <button type="button" onClick={() => onAckQuality(tp.name)}
          className="self-center text-xs text-gray-500 underline underline-offset-2 min-h-[44px] inline-flex items-center">
          {t('patient.request.qualityUseAnyway')}
        </button>
      )}

      {/* Hard-failure OCR retry (errored: no text + null match) — keep the
          existing affordance so a transient model-load error is recoverable. */}
      {isId && pending && !ocrBusy && ocr && ocr.match == null && !ocr.text && (
        <button type="button" onClick={() => onRetryOcr(tp.name)}
          className="self-start text-xs text-brand-600 hover:text-brand-700 font-medium underline underline-offset-2 min-h-[44px]">
          {t('shell.common.tryAgain')}
        </button>
      )}
    </div>
  )
}
