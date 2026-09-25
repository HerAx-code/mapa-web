import { MdClose, MdInfoOutline } from 'react-icons/md'
import { DocPreview } from '../DocViewerModal'
import { useEscapeKey } from '../../hooks/useEscapeKey'

// Side-by-side ID-portrait ↔ live-selfie compare for the CRMC verifier — the
// highest-value affordance of the ID-verification feature: it puts the two
// faces next to each other so the human match is fast, with the on-device
// face-match score + liveness verdict shown only as a hint. Staff surface
// (English-only). The advisory framing is deliberate: the social worker makes
// the final call (design principle + RA-10173). See docs/id-verification-plan.md.
const TONE = {
  pass:    { chip: 'bg-green-50 text-green-700 border-green-200', icon: '✓' },
  unclear: { chip: 'bg-amber-50 text-amber-700 border-amber-200', icon: '⚠' },
  null:    { chip: 'bg-gray-50 text-gray-500 border-gray-200',    icon: '·' },
}
const tone = (v) => TONE[v] ?? TONE.null

export default function CompareFacesModal({ selfieDoc, idDoc, onClose }) {
  useEscapeKey(onClose)
  const score = typeof selfieDoc?.faceMatchScore === 'number' ? selfieDoc.faceMatchScore.toFixed(2) : null
  const fm = tone(selfieDoc?.faceMatch)
  const lv = tone(selfieDoc?.liveness)
  const fmLabel = selfieDoc?.faceMatch === 'pass' ? 'Likely the same person'
    : selfieDoc?.faceMatch === 'unclear' ? 'Unclear — decide by eye'
    : 'Could not check'
  const lvLabel = selfieDoc?.liveness === 'pass' ? 'Looks like a live capture'
    : selfieDoc?.liveness === 'unclear' ? 'Hard to confirm'
    : 'Could not check'

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
          </div>
          <div className="flex flex-col min-h-0">
            <p className="text-xs font-semibold text-gray-500 mb-1.5 px-1">Live selfie</p>
            <DocPreview docMeta={selfieDoc} className="flex-1 border border-gray-100 rounded-lg overflow-hidden" />
          </div>
        </div>
      </div>
    </div>
  )
}
