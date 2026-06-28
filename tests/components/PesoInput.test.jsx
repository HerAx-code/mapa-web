/**
 * PesoInput smoke tests.
 *
 * Tiny UI primitive extracted from IntakeSheet.jsx in Phase 2.3.
 * Pins the things that, if regressed, would silently change money-
 * input UX across 9+ form sites:
 *   - The ₱ glyph is always rendered (currency cue)
 *   - The input is type=number with inputMode=numeric
 *   - Wrapper classes pass through (grid col-span integration)
 *   - onChange fires with the raw event
 *   - disabled prop disables the input
 */

import { describe, it, expect, vi } from 'vitest'
import { useState as reactUseState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PesoInput from '../../src/components/ui/PesoInput'

// Wrapper that holds controlled state so typing actually updates the
// input value. Mirrors how PesoInput is used in real parent forms.
function StatefulHost({ initial = '', onChange }) {
  const [v, setV] = reactUseState(initial)
  return (
    <PesoInput
      value={v}
      onChange={e => { setV(e.target.value); onChange?.(e) }}
    />
  )
}

describe('PesoInput', () => {
  it('always renders the ₱ glyph regardless of value', () => {
    const { rerender, getByText } = render(<PesoInput value="" onChange={() => {}} />)
    expect(getByText('₱')).toBeInTheDocument()
    rerender(<PesoInput value={42} onChange={() => {}} />)
    expect(getByText('₱')).toBeInTheDocument()
  })

  it('renders a numeric input with inputMode=numeric (mobile keyboard)', () => {
    const { container } = render(<PesoInput value="" onChange={() => {}} />)
    const input = container.querySelector('input')
    expect(input).toHaveAttribute('type', 'number')
    expect(input).toHaveAttribute('inputmode', 'numeric')
  })

  it('passes wrapperClassName through to the relative wrapper', () => {
    // Used by family-member rows where col-span needs to be on the
    // wrapper, not the input itself.
    const { container } = render(
      <PesoInput value="" onChange={() => {}} wrapperClassName="col-span-10 sm:col-span-2" />
    )
    const wrapper = container.firstChild
    expect(wrapper).toHaveClass('relative', 'col-span-10', 'sm:col-span-2')
  })

  it('passes className through to the input', () => {
    const { container } = render(
      <PesoInput value="" onChange={() => {}} className="text-sm" />
    )
    const input = container.querySelector('input')
    expect(input).toHaveClass('input', 'pl-7', 'text-sm')
  })

  it('fires onChange with the raw event when the user types', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { container } = render(<StatefulHost onChange={onChange} />)
    const input = container.querySelector('input')
    await user.type(input, '500')
    expect(onChange).toHaveBeenCalled()
    // After typing 3 chars in a controlled wrapper, the input value
    // should be '500'.
    expect(input).toHaveValue(500)
  })

  it('disables the input when disabled={true}', () => {
    const { container } = render(<PesoInput value="" onChange={() => {}} disabled />)
    expect(container.querySelector('input')).toBeDisabled()
  })

  it('respects min prop (defaults to 0)', () => {
    const { container, rerender } = render(<PesoInput value="" onChange={() => {}} />)
    expect(container.querySelector('input')).toHaveAttribute('min', '0')
    rerender(<PesoInput value="" onChange={() => {}} min={100} />)
    expect(container.querySelector('input')).toHaveAttribute('min', '100')
  })
})
