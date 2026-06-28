/**
 * PesoInput — money input with a persistent ₱ prefix glyph.
 *
 * Extracted from src/pages/agency/IntakeSheet.jsx (Phase 2.3). The
 * pattern was first introduced in src/pages/patient/IntakeWizard.jsx
 * inline; the intake sheet adopted the same pattern via a co-located
 * helper. This promotes the helper to a shared component so future
 * money inputs (Allocation page, budget forms, agency Top-Up modal,
 * etc.) pick up the same glyph + alignment automatically.
 *
 * Props:
 *   value             current numeric value (string or number)
 *   onChange          onChange handler (receives the raw event)
 *   disabled          disable both glyph and input
 *   placeholder       optional placeholder
 *   min               default 0
 *   ariaLabel         optional aria-label for screen readers
 *   className         extra classes on the <input>
 *   wrapperClassName  extra classes on the relative wrapper
 *                     (use this when the input lives in a grid and the
 *                      column-span needs to be on the wrapper)
 *
 * The relative wrapper hosts the ₱ glyph absolutely positioned at
 * left:0.75rem; the input compensates with pl-7. pointer-events-none
 * on the glyph means clicking it focuses the input, not the span.
 */
export default function PesoInput({
  value, onChange, disabled, placeholder, min = 0,
  ariaLabel, className = '', wrapperClassName = '',
}) {
  return (
    <div className={`relative ${wrapperClassName}`}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none select-none">₱</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        className={`input pl-7 ${className}`}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
    </div>
  )
}
