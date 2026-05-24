import { MdShield } from 'react-icons/md'
import { useState } from 'react'

/**
 * Brand logo. Renders /mapa-logo.png if available; falls back to the shield
 * placeholder if the image fails to load. Pass `size` in pixels (default 32).
 *
 * Use this wherever the MAPA brand mark appears (sidebar header, landing
 * page header, login screen, footer, etc.). One source of truth so swapping
 * the logo later is a one-file change.
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
          <span className="text-sm font-semibold text-gray-900">MAPA</span>
          <span className="text-xs text-gray-400 ml-1">CRMC</span>
        </div>
      )}
    </div>
  )
}
