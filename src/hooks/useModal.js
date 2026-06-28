import { useState, useCallback } from 'react'

/**
 * useModal — small wrapper around useState for show/hide boolean state.
 *
 * The codebase has dozens of `const [showFoo, setShowFoo] = useState(false)`
 * declarations, with the parent component manually wiring up onOpen
 * (setShowFoo(true)) and onClose (setShowFoo(false)) callbacks for every
 * modal it hosts. ApplicationDetail.jsx alone has six such pairs.
 *
 * This hook collapses the pattern to one call:
 *
 *   const reject = useModal()
 *   ...
 *   <button onClick={reject.openModal}>Reject</button>
 *   {reject.open && <RejectModal onClose={reject.close} />}
 *
 * The handlers are stable across renders (useCallback) so passing
 * `reject.close` as a prop to a memoized child doesn't bust its memo.
 *
 * Phase 2.3 deliverable. Use it for new modal-hosting code; the
 * existing showXxx pairs can be migrated incrementally during the
 * Phase 2.1 / 2.2 page splits.
 */
export function useModal(initial = false) {
  const [open, setOpen] = useState(initial)
  const openModal = useCallback(() => setOpen(true),  [])
  const close     = useCallback(() => setOpen(false), [])
  const toggle    = useCallback(() => setOpen(prev => !prev), [])
  return { open, openModal, close, toggle }
}
