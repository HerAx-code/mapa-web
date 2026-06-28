/**
 * Field — labelled form field wrapper.
 *
 * Extracted from src/pages/agency/IntakeSheet.jsx (Phase 2.3) so
 * other intake-style forms can reuse the same label/required/hint
 * convention without re-declaring the helper. The original lived
 * inline; promoting it lets the patient IntakeWizard, admin
 * Announcements form, and any future structured form share one
 * implementation.
 *
 * Props:
 *   label     string  — shown above the input
 *   required  bool    — appends a red asterisk
 *   children  node    — the actual input/select/textarea
 *   hint      string  — optional sub-label below the children
 *   colSpan   1 | 2   — grid column-span at sm+ breakpoints
 *
 * Layout-wise this assumes the parent renders a
 *   `grid grid-cols-1 sm:grid-cols-2` (or 3) wrapper. Stand-alone
 *   usage outside a grid still works; colSpan is just a no-op.
 */
export default function Field({ label, required, children, hint, colSpan }) {
  return (
    <div className={colSpan === 2 ? 'sm:col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
  )
}
