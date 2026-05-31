import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  MdClose, MdArrowBack, MdArrowForward, MdCheck,
} from 'react-icons/md'

// First-time-visit guided tour.
//
// Why DIY rather than driver.js / react-joyride:
//   - Patient bundle is the smallest, on entry-level Android — a tour
//     library adds 15-40 KB of dep we don't need for this much logic.
//   - Tailwind + portal gives us full styling control to match the rest
//     of the app, so the tour doesn't look bolted on.
//   - Bilingual support is just t() at the caller — no lib-specific i18n
//     plumbing to learn.
//
// Caller passes steps; this component handles overlay, spotlight,
// positioning, and the dismiss flag in localStorage.
//
// Each step:
//   { targetId, title, body, position?: 'top' | 'bottom' | 'left' | 'right' }
//
// targetId matches `data-tour-id="..."` on the element to spotlight.
// If the element isn't found, the step still shows centered on the
// screen with a full-page dim, so a missing data-tour-id in some
// layout (responsive variants, lazy-rendered) doesn't break the flow.
export default function Tour({ steps, storageKey, onComplete }) {
  const { user } = useAuth()
  const [active, setActive]       = useState(false)
  const [stepIdx, setStepIdx]     = useState(0)
  const [targetRect, setTargetRect] = useState(null)
  // Per-user-per-tour dismiss flag. uid scoping means a fresh login on
  // a shared device gets their own tour, and a returning user doesn't
  // re-see one they already finished.
  const fullKey = user?.uid ? `mapa_tour_${storageKey}_${user.uid}` : null

  // Auto-open on first visit. Slight delay so the page has rendered and
  // the target elements exist before we try to measure them.
  useEffect(() => {
    if (!fullKey) return
    if (localStorage.getItem(fullKey) === '1') return
    const t = setTimeout(() => setActive(true), 400)
    return () => clearTimeout(t)
  }, [fullKey])

  // Re-measure target on step change, window resize, and scroll. Scroll
  // listener uses capture so we catch nested scroll containers too.
  useEffect(() => {
    if (!active) return
    const step = steps[stepIdx]
    if (!step) return

    let cancelled = false
    const measure = () => {
      if (cancelled) return
      const target = document.querySelector(`[data-tour-id="${step.targetId}"]`)
      if (!target) { setTargetRect(null); return }
      const rect = target.getBoundingClientRect()
      setTargetRect({
        top: rect.top, left: rect.left,
        width: rect.width, height: rect.height,
        bottom: rect.bottom, right: rect.right,
      })
    }

    // Scroll the target into view first, then measure after the smooth
    // scroll has had time to settle. 350ms covers most browsers'
    // smooth-scroll animation length.
    const target = document.querySelector(`[data-tour-id="${step.targetId}"]`)
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const initial = setTimeout(measure, 350)

    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      cancelled = true
      clearTimeout(initial)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [active, stepIdx, steps])

  const finish = (completed) => {
    if (fullKey) {
      try { localStorage.setItem(fullKey, '1') } catch { /* quota / private mode */ }
    }
    setActive(false)
    setStepIdx(0)
    onComplete?.(completed)
  }
  const next = () => stepIdx < steps.length - 1 ? setStepIdx(stepIdx + 1) : finish(true)
  const back = () => setStepIdx(s => Math.max(0, s - 1))

  if (!active || !steps[stepIdx]) return null
  const step = steps[stepIdx]
  const isLast = stepIdx === steps.length - 1

  // Tooltip positioning. Defaults to below the target. Caller can
  // override per-step (e.g., 'top' for a bottom-of-page target so the
  // tooltip stays on-screen). Always clamped to the viewport so the
  // card never half-disappears off the edge.
  const TOOLTIP_W = 320
  const PAD = 12
  let tipStyle = { position: 'fixed', zIndex: 10001, width: TOOLTIP_W }
  if (!targetRect) {
    tipStyle = { ...tipStyle, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  } else {
    const pos = step.position || 'bottom'
    const clampLeft = (x) => Math.max(8, Math.min(x, window.innerWidth - TOOLTIP_W - 8))
    const clampTop  = (y) => Math.max(8, Math.min(y, window.innerHeight - 220))
    if (pos === 'top') {
      tipStyle.top  = clampTop(targetRect.top - 220 - PAD)
      tipStyle.left = clampLeft(targetRect.left)
    } else if (pos === 'right') {
      tipStyle.top  = clampTop(targetRect.top)
      tipStyle.left = clampLeft(targetRect.right + PAD)
    } else if (pos === 'left') {
      tipStyle.top  = clampTop(targetRect.top)
      tipStyle.left = clampLeft(targetRect.left - TOOLTIP_W - PAD)
    } else {
      tipStyle.top  = clampTop(targetRect.bottom + PAD)
      tipStyle.left = clampLeft(targetRect.left)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[10000] pointer-events-none">
      {targetRect ? (
        <>
          {/* 4-quadrant dim overlay carves a "hole" around the target
              without needing SVG masking. Each quadrant is its own
              click-blocking surface, so taps off-target go nowhere
              and the user follows the tour. */}
          <div className="fixed bg-black/60 pointer-events-auto" style={{ top: 0, left: 0, right: 0, height: Math.max(0, targetRect.top - 6) }} />
          <div className="fixed bg-black/60 pointer-events-auto" style={{ top: targetRect.bottom + 6, left: 0, right: 0, bottom: 0 }} />
          <div className="fixed bg-black/60 pointer-events-auto" style={{ top: Math.max(0, targetRect.top - 6), left: 0, width: Math.max(0, targetRect.left - 6), height: targetRect.height + 12 }} />
          <div className="fixed bg-black/60 pointer-events-auto" style={{ top: Math.max(0, targetRect.top - 6), left: targetRect.right + 6, right: 0, height: targetRect.height + 12 }} />
          {/* Pulsing spotlight ring on the target. ring-4 + animate-pulse
              draws the eye without obscuring the underlying element. */}
          <div
            className="fixed pointer-events-none rounded-xl ring-4 ring-brand-400 animate-pulse"
            style={{
              top: targetRect.top - 6, left: targetRect.left - 6,
              width: targetRect.width + 12, height: targetRect.height + 12,
            }}
          />
        </>
      ) : (
        // Target missing -> dim the whole page so the tooltip still has
        // visual focus, even though no spotlight is drawn.
        <div className="fixed inset-0 bg-black/60 pointer-events-auto" />
      )}

      {/* Tooltip card */}
      <div className="card p-4 shadow-2xl bg-white pointer-events-auto" style={tipStyle}>
        <div className="flex items-center justify-between mb-2 gap-2">
          <span className="text-xs font-semibold text-brand-600">
            {stepIdx + 1} / {steps.length}
          </span>
          <button
            onClick={() => finish(false)}
            className="text-gray-400 hover:text-gray-600 -mr-1"
            aria-label="Skip tour">
            <MdClose size={18} />
          </button>
        </div>
        <h3 className="text-base font-bold text-gray-900 mb-1.5">{step.title}</h3>
        <p className="text-sm text-gray-600 leading-relaxed mb-4">{step.body}</p>
        <div className="flex items-center justify-between gap-2">
          {stepIdx > 0 ? (
            <button onClick={back} className="btn-secondary text-xs inline-flex items-center gap-1">
              <MdArrowBack size={14} /> Back
            </button>
          ) : (
            <button onClick={() => finish(false)} className="text-xs text-gray-400 hover:text-gray-600">
              Skip
            </button>
          )}
          <button onClick={next} className="btn-primary text-xs inline-flex items-center gap-1">
            {isLast ? (<><MdCheck size={14} /> Done</>) : (<>Next <MdArrowForward size={14} /></>)}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}