import { useEffect } from 'react'

/**
 * useFocusTrap — keyboard focus management for a modal / dialog (WCAG 2.4.3
 * Focus Order + 2.1.2 No Keyboard Trap, the *good* kind: focus stays inside the
 * dialog while it's open and is released when it closes).
 *
 * When `active` flips true it:
 *   1. remembers the element that had focus (to restore on close),
 *   2. moves focus into the dialog — the first [data-autofocus] element if
 *      present, else the first focusable element, else the container itself,
 *   3. wraps Tab / Shift+Tab so focus cycles within the container instead of
 *      escaping to the page behind the backdrop.
 * When it flips false (or unmounts) it restores focus to the remembered element.
 *
 *   const ref = useRef(null)
 *   useFocusTrap(ref, open)
 *   return open ? <div ref={ref} role="dialog" aria-modal="true">…</div> : null
 *
 * @param {React.RefObject<HTMLElement>} ref     the dialog container
 * @param {boolean}                      active  trap on/off
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useFocusTrap(ref, active = true) {
  useEffect(() => {
    if (!active) return
    const container = ref.current
    if (!container) return

    const previouslyFocused =
      typeof document !== 'undefined' ? document.activeElement : null

    const focusables = () =>
      Array.from(container.querySelectorAll(FOCUSABLE)).filter(
        el => el.offsetParent !== null || el === document.activeElement
      )

    // Move focus in: explicit [data-autofocus], else first focusable, else the
    // container (made focusable via tabIndex=-1 by the caller).
    const initial =
      container.querySelector('[data-autofocus]') || focusables()[0] || container
    initial?.focus?.()

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        // Nothing focusable — keep focus on the container, don't escape.
        e.preventDefault()
        container.focus?.()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const activeEl = document.activeElement
      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault()
          last.focus()
        }
      } else if (activeEl === last || !container.contains(activeEl)) {
        e.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', onKeyDown)
    return () => {
      container.removeEventListener('keydown', onKeyDown)
      // Restore focus to where the user was, if it's still in the document.
      if (previouslyFocused && typeof previouslyFocused.focus === 'function' &&
          document.contains(previouslyFocused)) {
        previouslyFocused.focus()
      }
    }
  }, [ref, active])
}
