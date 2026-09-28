import { useState } from 'react'
import { MdClose, MdInfoOutline, MdCheckCircle, MdBlock } from 'react-icons/md'
import { DocPreview } from '../DocViewerModal'
import StatusBadge from '../ui/StatusBadge'
import { useEscapeKey } from '../../hooks/useEscapeKey'

// Side-by-side ID-portrait ↔ live-selfie compare for the CRMC verifier — the
// highest-value affordance of the ID-verification feature: it puts the two
// faces next to each other so the human match is fast, with the on-device
// face-match score + liveness verdict shown only as a hint. Staff surface
// (English-only). The advisory framing is deliberate: the social worker makes
// the final call (design principle + RA-10173). See docs/id-verification-plan.md.
//
// Phase 4.2 (reviewer console): the verifier can now VERIFY / REJECT both docs
// in place, so a decision doesn't require closing the compare and hunting back
// through the panel. Verify updates in place (buttons collapse to a badge);
// Reject hands off to the parent's reason dialog (which closes this modal).
const TONE = {
  pass:    { chip: 'bg-green-50 text-green-700 border-green-200', icon: '✓' },
  unclear: { chip: 'bg-amber-50 text-amber-700 border-amber-200', icon: '⚠' },
  null:    { chip: 'bg-gray-50 text-gray-500 border-gray-200',    icon: '·' },
}
const tone = (v) => TONE[v] ?? TONE.null

// Per-doc verify/reject controls shown under each face. `decidedOverride` lets a
// just-verified doc show its new state without waiting for the live snapshot.
function DocActions({ doc, decidedOverride, busy, onVerify, onReject }) {
  if (!doc) return null
  const status = decidedOverride ?? doc.status ?? 'pending'
  const decided = status === 'verified' || status === 'rejected'
  return (
    <div className="mt-2 flex items-center gap-2 flex-wrap">
      <StatusBadge status={status} kind="doc" className="flex-shrink-0" />
      {!decided && (
        <>
          <button type="button" disabled={busy}
            onClick={() => onVerify(doc)}
            className="text-xs font-medium text-green-600 hover:text-green-700 inline-flex items-center gap-1 disabled:opacity-50">
            <MdCheckCircle size={14} /> Verify
          </button>
          <button type="button" disabled={busy}
            onClick={() => onReject(doc)}
            className="text-xs font-medium text-red-500 hover:text-red-600 inline-flex items-center gap-1 disabled:opacity-50">
            <MdBlock size={14} /> Reject
          </button>
        </>
      )}
    </div>
  )
}

export default function CompareFacesModal({ selfieDoc, idDoc, busy = false, onVerify, onReject, onClose }) {
  useEscapeKey(onClose)
  // Local optimistic "just verified" state, keyed by doc id (Reject closes the
  // modal, so only Verify needs to reflect in place).
  const [verifiedLocal, setVerifiedLocal] = useState({})
  const handleVerify = (doc) => {
    setVerifiedLocal(v => ({ ...v, [doc.id]: 'verified' }))
    onVerify?.(doc)
  }
  const handleReject = (doc) => onReject?.(doc)
  const hasActions = !!(onVerify || onReject)

  const score = typeof selfieDoc?.faceMatchScore === 'number' ? selfieDoc.faceMatchScore.toFixed(2) : null
  const fm = tone(selfieDoc?.faceMatch)
  const lv = tone(selfieDoc?.liveness)
  const fmLabel = selfieDoc?.faceMatch === 'pass' ? 'Likely the same person'
    : selfieDoc?.faceMatch === 'unclear' ? 'Unclear — decide by eye'
    : 'Could not check'
  const lvLabel = selfieDoc?.liveness === 'pass' ? 'Looks like a live capture'
    : selfieDoc?.liveness === 'unclear' ? 'Hard to confirm'
    : 'Could not check'
  // ID OCR name cross-check (advisory) — surfaced here too so the verifier has
  // the name signal beside the face, not only back in the panel.
  const ocrLabel = idDoc?.ocrMatch === true ? '✓ OCR: ID name matches the account'
    : idDoc?.ocrMatch === false ? '⚠ OCR: name not auto-matched — verify manually'
    : idDoc && (idDoc.ocrText || idDoc.idTypeDetected) ? 'OCR: could not auto-read — verify manually'
    : null
  const ocrCls = idDoc?.ocrMatch === true ? 'text-green-600' : idDoc?.ocrMatch === false ? 'text-amber-600' : 'text-gray-400'

  return (
    <div className="fixed inset-0 bg-black/40 z-[400] flex items-end sm:items-center justify-center sm:p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1.5 bg-gray-300 rounded-full" />
        </div>
        <div className="flex items-center justify-between px-5 py-3 sm:py-4 border-b border-gray-100 flex-shrink-0 gap-3">
          <h2 className="text-base font-semibold text-gray-900">Compare: ID portrait ↔ live selfie</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><MdClose size={20} /></button>
        </div>

        {/* Advisory readout */}
        <div className="px-5 py-3 border-b border-gray-50 flex flex-wrap items-center gap-2 flex-shrink-0">
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${fm.chip}`}>
            {fm.icon} Face match: {fmLabel}{score ? ` · ${score}` : ''}
          </span>
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${lv.chip}`}>
            {lv.icon} Liveness: {lvLabel}
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-gray-400 ml-auto">
            <MdInfoOutline size={13} /> Advisory — you make the final call
          </span>
        </div>

        <div className="flex-1 overflow-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 min-h-0">
          <div className="flex flex-col min-h-0">
            <p className="text-xs font-semibold text-gray-500 mb-1.5 px-1">ID portrait
              {idDoc?.idTypeDetected && <span className="font-normal text-gray-400"> · {idDoc.idTypeDetected}</span>}
            </p>
            {idDoc
              ? <DocPreview docMeta={idDoc} className="flex-1 border border-gray-100 rounded-lg overflow-hidden" />
              : <p className="text-sm text-gray-400 italic p-4">No ID document attached.</p>}
            {ocrLabel && <p className={`mt-1.5 px-1 text-xs ${ocrCls}`}>{ocrLabel}</p>}
            {hasActions && idDoc && (
              <DocActions doc={idDoc} decidedOverride={verifiedLocal[idDoc.id]} busy={busy}
                onVerify={handleVerify} onReject={handleReject} />
            )}
          </div>
          <div className="flex flex-col min-h-0">
            <p className="text-xs font-semibold text-gray-500 mb-1.5 px-1">Live selfie</p>
            <DocPreview docMeta={selfieDoc} className="flex-1 border border-gray-100 rounded-lg overflow-hidden" />
            {hasActions && selfieDoc && (
              <DocActions doc={selfieDoc} decidedOverride={verifiedLocal[selfieDoc.id]} busy={busy}
                onVerify={handleVerify} onReject={handleReject} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
