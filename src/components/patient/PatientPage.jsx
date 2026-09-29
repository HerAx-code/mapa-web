/**
 * PatientPage — the single source of truth for patient page width on the web.
 *
 * Patient screens are mobile-first (the app/PWA is the primary channel; the web
 * is the zero-install fallback). On a phone this is a full-bleed column with a
 * comfortable side gutter; on desktop it sits in a centered, capped column so the
 * page reads as a deliberate design instead of stretching edge-to-edge or sitting
 * as a lonely ribbon. See docs/patient-desktop-layout-plan.md.
 *
 *   width="narrow" (~max-w-3xl)  forms, wizards, long-form reading
 *   width="wide"   (~max-w-5xl)  dashboards, card grids, list + detail
 *
 * Wrap a page's content in this and drop the page's own ad-hoc
 * max-w-* / mx-auto / horizontal-gutter classes so there is one rule.
 */
export default function PatientPage({ width = 'narrow', className = '', children }) {
  const cap = width === 'wide' ? 'max-w-5xl' : 'max-w-3xl'
  return (
    <div className={`mx-auto w-full ${cap} px-4 sm:px-6 py-4 sm:py-6 ${className}`}>
      {children}
    </div>
  )
}
