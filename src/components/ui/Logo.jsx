import { ORG } from '../../config/org'

/**
 * Brand logo — the "care pin" (visual-identity Phase C).
 *
 * `MapaMark` is the designed logomark: a map-pin ("mapa" = map → points patients
 * to assistance) with a health cross carved as negative space (medical care),
 * one closed pine shape with an evenodd cut-out. It is rendered INLINE as SVG
 * with `fill="currentColor"`, so it themes with the surrounding text color and
 * reverses cleanly to white on a pine `card-hero` / dark login column. The
 * standalone asset at public/brand/mapa-mark.svg keeps an explicit pine fill for
 * favicon/PWA use (no CSS color context there). See docs/visual-identity/.
 *
 * `Logo` is the one place the brand mark is composed (sidebar, landing, login,
 * footer), so swapping or recoloring it is a one-file change. Color via the
 * parent's text color (default pine); pass `text-white` for the reversed variant.
 * The wordmark is the host product name (ORG.name) with the optional institution
 * tag (ORG.shortName) as small attribution — never baked into the mark.
 */

// viewBox 64×80 (pin is taller than wide). Single evenodd path = pin − cross.
export function MapaMark({ size = 32, className = '', title = ORG.name }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 80"
      width={Math.round(size * 0.8)}
      height={size}
      className={`flex-shrink-0 ${className}`}
      role="img"
      aria-label={title}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M32 3 C17 3 5 15 5 30 C5 48 32 77 32 77 C32 77 59 48 59 30 C59 15 47 3 32 3 Z M28 16 H36 V25 H45 V33 H36 V42 H28 V33 H19 V25 H28 Z"
      />
    </svg>
  )
}

export default function Logo({ size = 32, withWordmark = false, className = '', markClassName = 'text-brand-500' }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <MapaMark size={size} className={markClassName} />
      {withWordmark && (
        <div className="leading-tight">
          <span className="font-display text-sm font-bold tracking-tight text-gray-900">{ORG.name}</span>
          {ORG.shortName && (
            <span className="block text-[10px] font-medium uppercase tracking-wide text-gray-500">{ORG.shortName}</span>
          )}
        </div>
      )}
    </div>
  )
}
