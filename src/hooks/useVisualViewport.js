import { useState, useEffect } from 'react'

/**
 * useVisualViewport — tracks the *visual* viewport (the area not covered by the
 * on-screen keyboard), returning { height, offsetTop } to size a full-screen
 * surface so its bottom-pinned content (e.g. a chat composer) stays above the
 * keyboard.
 *
 * Why it exists: a `position: fixed; inset: 0` box is sized to the *layout*
 * viewport, which does not shrink when the keyboard opens on iOS Safari (and on
 * Android only when interactive-widget=resizes-content is set). Without this,
 * the composer sits under the keyboard and looks "sliced." Applying
 * { top: offsetTop, height } to the wrapper keeps it exactly over the visible
 * area on both platforms.
 *
 * Fallback: where window.visualViewport is unavailable, returns the full
 * innerHeight with offsetTop 0 — i.e. the previous full-screen behaviour, no
 * worse than before.
 */
export function useVisualViewport() {
  const [vp, setVp] = useState(() => ({
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
    offsetTop: 0,
  }))

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setVp({ height: vv.height, offsetTop: vv.offsetTop })
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return vp
}
