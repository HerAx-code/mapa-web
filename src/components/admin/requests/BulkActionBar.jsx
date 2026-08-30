import { MdCheck, MdMail, MdPersonAdd, MdClose } from 'react-icons/md'

// Floating bulk-action bar — appears only when rows are selected (Magic
// Patterns adoption, remapped to MAPA + react-icons, no framer-motion).
// The money-path is protected: Endorse never batch-writes money — it routes to
// the per-request endorse flow (the container opens the request's EndorseModal).
export default function BulkActionBar({ count, busy, onAssignMe, onRequestDocs, onEndorse, onClear }) {
  if (count <= 0) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div role="status" className="pointer-events-auto flex items-center gap-2 rounded-xl bg-gray-900 px-3 py-2 text-sm text-white shadow-lg">
        <span className="tabular-nums px-1 font-semibold">{count} selected</span>
        <span className="h-5 w-px bg-white/15" />
        <button type="button" disabled={busy} onClick={onAssignMe}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-white/90 hover:bg-white/10 hover:text-white disabled:opacity-50">
          <MdPersonAdd size={15} /> Assign to me
        </button>
        <button type="button" disabled={busy} onClick={onRequestDocs}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-white/90 hover:bg-white/10 hover:text-white disabled:opacity-50">
          <MdMail size={15} /> Request documents
        </button>
        <button type="button" disabled={busy} onClick={onEndorse}
          className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-2.5 py-1.5 font-medium text-white hover:bg-brand-600 disabled:opacity-50">
          <MdCheck size={15} /> Endorse
        </button>
        <button type="button" onClick={onClear} aria-label="Clear selection"
          className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white">
          <MdClose size={15} />
        </button>
      </div>
    </div>
  )
}
