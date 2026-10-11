import { MdCheckCircle, MdWarning } from 'react-icons/md'

// One shared real-time capture hint pill, used over the dark camera viewport in
// BOTH GuidedIdCapture (ID photo) and SelfieCaptureModal (live selfie), so the
// two capture screens speak one guidance language (sharp / bright / glare / good
// light). Light pill on a dark viewport; `warn` (amber) overrides `ok` (brand),
// idle is a quiet neutral. Presentational only.
export default function CaptureHint({ ok = false, warn = false, label }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
      warn ? 'bg-amber-100 text-amber-800'
        : ok ? 'bg-brand-50 text-brand-700'
        : 'bg-white/80 text-gray-500'
    }`}>
      {warn ? <MdWarning size={13} /> : ok ? <MdCheckCircle size={13} /> : null}{label}
    </span>
  )
}
