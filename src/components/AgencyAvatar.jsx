import { useState } from 'react'

/**
 * AgencyAvatar — one source of truth for how an agency is visually
 * represented across the app (admin/Agencies list, patient/MedicalPrograms,
 * EndorseModal, slice cards, etc.).
 *
 * Behaviour:
 *   - If agency.logoUrl is set AND loads successfully -> render the image
 *   - Otherwise (no URL, URL failed to load) -> render the existing
 *     colored-initials block as a fallback
 *
 * The `className` prop controls size + corner radius so callers don't have
 * to drop the component when they need a different look. Example:
 *
 *   <AgencyAvatar agency={a} className="w-12 h-12 rounded-xl text-sm" />
 *   <AgencyAvatar agency={a} className="w-8 h-8 rounded-lg text-xs" />
 *
 * The component is the only place onError swap logic exists. Pages that
 * still render the inline pattern continue to work fine — they just
 * don't get logo support until they switch over.
 */
export default function AgencyAvatar({ agency, className = 'w-10 h-10 rounded-xl text-xs' }) {
  const [imgFailed, setImgFailed] = useState(false)
  const initials = agency?.initials || agency?.name?.slice(0, 2)?.toUpperCase() || '?'
  const color    = agency?.color || 'bg-gray-400'
  const showImg  = agency?.logoUrl && !imgFailed

  if (showImg) {
    return (
      <img
        src={agency.logoUrl}
        alt={agency.name || 'Agency logo'}
        // Background defaults to white so a transparent PNG still looks
        // sharp against gray/colored surrounding areas. object-contain so
        // an asymmetric logo isn't stretched.
        className={`${className} object-contain bg-white border border-gray-100 flex-shrink-0`}
        onError={() => setImgFailed(true)}
      />
    )
  }

  return (
    <div
      className={`${className} ${color} text-white font-bold flex items-center justify-center flex-shrink-0`}
      aria-label={agency?.name ? `${agency.name} avatar` : 'Agency avatar'}
    >
      {initials}
    </div>
  )
}