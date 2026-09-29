import { useState, useLayoutEffect, useCallback } from 'react'

/**
 * useDropdownPlacement — decide whether a popover opens above or below its
 * anchor, and how tall it may be, from the anchor's position in the viewport.
 *
 * Prevents the "dropdown runs off the bottom of the screen with no way to
 * reach it" bug when a trigger sits low in a scroll area. Recomputes on open
 * (via useLayoutEffect, so the first paint is already correct — no flicker)
 * and while the page scrolls/resizes.
 *
 *   const ref = useRef(null)
 *   const { dropUp, maxHeight } = useDropdownPlacement(ref, open)
 *   <div ref={ref} className="relative">
 *     <button>…</button>
 *     {open && (
 *       <div className={dropUp ? 'absolute bottom-full mb-1' : 'absolute top-full mt-1'}>
 *         <ul style={{ maxHeight }} className="overflow-y-auto">…</ul>
 *       </div>
 *     )}
 *   </div>
 *
 * @param {React.RefObject<HTMLElement>} anchorRef  the trigger / positioning box
 * @param {boolean} open                            whether the popover is shown
 * @param {object}  [opts]
 * @param {number}  [opts.extraOffset=0]  height inside the panel above the
 *                  scrollable part (e.g. a search box), subtracted from maxHeight
 * @param {number}  [opts.maxHeight=240]  hard cap on the scrollable height
 * @param {number}  [opts.minHeight=120]  floor so it never collapses to nothing
 * @returns {{ dropUp: boolean, maxHeight: number }}
 */
export function useDropdownPlacement(anchorRef, open, opts = {}) {
  const { extraOffset = 0, maxHeight = 240, minHeight = 120 } = opts
  const [placement, setPlacement] = useState({ dropUp: false, maxHeight })

  const compute = useCallback(() => {
    const el = anchorRef.current
    if (!el || typeof window === 'undefined') return
    const rect = el.getBoundingClientRect()
    const margin = 12
    const spaceBelow = window.innerHeight - rect.bottom - margin
    const spaceAbove = rect.top - margin
    const up = spaceBelow < maxHeight && spaceAbove > spaceBelow
    const avail = (up ? spaceAbove : spaceBelow) - extraOffset
    setPlacement({ dropUp: up, maxHeight: Math.max(minHeight, Math.min(maxHeight, avail)) })
  }, [anchorRef, extraOffset, maxHeight, minHeight])

  useLayoutEffect(() => {
    if (!open) return
    compute()
    const onReflow = () => compute()
    window.addEventListener('resize', onReflow)
    // Capture phase so scrolling of an ancestor container (a facet sidebar, a
    // modal body) counts, not just the window.
    window.addEventListener('scroll', onReflow, true)
    return () => {
      window.removeEventListener('resize', onReflow)
      window.removeEventListener('scroll', onReflow, true)
    }
  }, [open, compute])

  return placement
}
