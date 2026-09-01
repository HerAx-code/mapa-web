import { useEffect } from 'react'

/**
 * useEscapeKey — close a modal / overlay when Escape is pressed, matching
 * native <dialog> behavior and the handler already baked into ConfirmModal.
 *
 * Most inline modals in the app close on a backdrop click and a Cancel / X
 * button but not on Escape, so behavior was inconsistent across the workspace.
 * Drop this one-liner into any modal component so they all behave the same:
 *
 *   useEscapeKey(onClose)              // always active
 *   useEscapeKey(onClose, !saving)    // suspended while a save is in flight
 *
 * @param {() => void} onClose  called when Escape is pressed
 * @param {boolean}    active   when false, the listener is not attached
 */
export function useEscapeKey(onClose, active = true) {
  useEffect(() => {
    if (!active) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, active])
}
