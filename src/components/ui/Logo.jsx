/**
 * MAPA brand mark — the "care pin": a geometric map-pin ("mapa" = map; points
 * patients to assistance) with a health cross carved as negative space. Rendered
 * as inline SVG (fill=currentColor) so it themes, reverses cleanly on pine, and
 * scales crisply with no network/asset dependency. Source of truth for the mark
 * also lives at public/brand/mapa-mark.svg (used for the favicon + asset
 * generation). See docs/visual-identity/03-identity-system.md.
 */

// The mark path — one closed pin + an evenodd cross cut-out. viewBox 64×80.
const MARK_D = 'M32 3 C17 3 5 15 5 30 C5 48 32 77 32 77 C32 77 59 48 59 30 C59 15 47 3 32 3 Z M28 16 H36 V25 H45 V33 H36 V42 H28 V33 H19 V25 H28 Z'

// Icon-only mark. Colour comes from the current text color (currentColor), so
// callers set it via className (e.g. text-brand-500, text-white).
export function MapaMark({ size = 32, className = '', title = 'MAPA' }) {
  return (
    <svg viewBox="0 0 64 80" role="img" aria-label={title}
      style={{ height: size, width: 'auto' }} className={className}>
      <path fill="currentColor" fillRule="evenodd" d={MARK_D} />
    </svg>
  )
}

/**
 * Brand lockup: mark + optional wordmark ("MAPA" in the display face + "CRMC"
 * attribution). Pass `reversed` on dark/pine surfaces (login column, card-hero,
 * PWA bounce). `size` is the mark height in px (default 32).
 */
export default function Logo({ size = 32, withWordmark = false, reversed = false, className = '' }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <MapaMark size={size} className={`flex-shrink-0 ${reversed ? 'text-white' : 'text-brand-500'}`} />
      {withWordmark && (
        <div className="leading-tight">
          <span className={`font-display text-sm font-bold tracking-tight ${reversed ? 'text-white' : 'text-gray-900'}`}>MAPA</span>
          <span className={`text-xs ml-1 ${reversed ? 'text-brand-200' : 'text-gray-400'}`}>CRMC</span>
        </div>
      )}
    </div>
  )
}
