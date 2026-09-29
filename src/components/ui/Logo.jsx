import { MdShield } from 'react-icons/md'
import { useState } from 'react'

/**
 * Brand logo. Renders /mapa-logo.png (the map-pin + cross-over-hand mark);
 * falls back to a shield placeholder if the image fails to load. Pass `size`
 * in pixels (default 32).
 *
 * Use this wherever the MAPA brand mark appears (sidebar header, landing page
 * header, login screen, footer, etc.). One source of truth so swapping the
 * logo later is a one-file change. The wordmark is the standalone MAPA name —
 * the operating institution (CRMC) is credited in content/legal copy, not
 * baked into the lockup.
 */
export default function Logo({ size = 32, withWordmark = false, className = '' }) {
  const [failed, setFailed] = useState(false)

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {failed ? (
        <div
          className="bg-brand-500 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ width: size, height: size }}>
          <MdShield size={Math.round(size * 0.55)} className="text-white" />
        </div>
      ) : (
        <img
          src="/mapa-logo.png"
          alt="MAPA"
          onError={() => setFailed(true)}
          style={{ width: size, height: size }}
          className="object-contain flex-shrink-0"
        />
      )}
      {withWordmark && (
        <div className="leading-tight">
          <span className="font-display text-sm font-bold tracking-tight text-gray-900">MAPA</span>
        </div>
      )}
    </div>
  )
}
