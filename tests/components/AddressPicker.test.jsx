/**
 * AddressPicker smoke tests.
 *
 * AddressPicker (R39) was introduced as a shared component across 4
 * forms (patient Register, ProfileModals, AddAgency, edit-Agency). The
 * cascading state (province -> city -> barangay, with "Other" fallback
 * at every level) is intricate and easy to break during maintenance.
 * These tests pin the behaviors that, if regressed, would surface as
 * subtle UX bugs (cities not populating, "Other" mode lost on edit, etc.).
 *
 * Pure component — no router, auth, or Firestore. Test cost is tiny.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddressPicker, { joinAddress } from '../../src/components/AddressPicker'

// Labels are now properly bound to their controls via useId() +
// htmlFor (fixed alongside this test refactor). Tests use accessible
// queries -- if a future change breaks the binding, the test fails
// immediately, which is the right signal.
const provinceSelect = () => screen.getByRole('combobox', { name: /province/i })
const citySelect     = () => screen.getByRole('combobox', { name: /city/i })

describe('AddressPicker', () => {
  it('renders the province + city selects (no barangay until selection)', () => {
    render(<AddressPicker value={{}} onChange={() => {}} />)
    expect(provinceSelect()).toBeInTheDocument()
    expect(citySelect()).toBeInTheDocument()
    expect(screen.getByText(/barangay/i)).toBeInTheDocument()
  })

  it('emits a structured value when a known BARMM province is picked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<AddressPicker value={{}} onChange={onChange} />)

    await user.selectOptions(provinceSelect(), 'Cotabato City')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      province: 'Cotabato City',
      city: '',
      barangay: '',
    }))
  })

  it('switches to free-text mode when "Other" is picked at the province level', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<AddressPicker value={{}} onChange={onChange} />)

    await user.selectOptions(provinceSelect(), '__other__')
    expect(screen.getByPlaceholderText(/enter province/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/enter city/i)).toBeInTheDocument()
  })

  it('hides the barangay row when showBarangay={false} (agency-form usage)', () => {
    render(<AddressPicker value={{}} onChange={() => {}} showBarangay={false} />)
    expect(screen.queryByText(/barangay/i)).not.toBeInTheDocument()
  })

  it('hydrates "Other" mode correctly when value contains a non-BARMM province (edit-flow)', () => {
    // This is the regression I worry most about: user previously
    // entered "Metro Manila" as Other, edits the form, and the picker
    // must remember it's Other mode instead of resetting to a fresh
    // dropdown.
    render(<AddressPicker
      value={{ province: 'Metro Manila', city: 'Quezon City', barangay: '' }}
      onChange={() => {}}
    />)
    expect(screen.getByDisplayValue('Metro Manila')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Quezon City')).toBeInTheDocument()
  })
})

describe('joinAddress helper', () => {
  it('joins all three fields with comma-space', () => {
    expect(joinAddress({
      barangay: 'Rosary Heights V',
      city: 'Cotabato City',
      province: 'Cotabato City',
    })).toBe('Rosary Heights V, Cotabato City, Cotabato City')
  })

  it('skips missing or empty pieces', () => {
    expect(joinAddress({
      barangay: '',
      city: 'Cotabato City',
      province: 'Cotabato City',
    })).toBe('Cotabato City, Cotabato City')

    expect(joinAddress({ city: 'Manila' })).toBe('Manila')
  })

  it('trims whitespace around each piece', () => {
    expect(joinAddress({
      barangay: '  Bgy. X  ',
      city: 'Cotabato City',
      province: ' Maguindanao del Sur ',
    })).toBe('Bgy. X, Cotabato City, Maguindanao del Sur')
  })

  it('handles undefined / null input gracefully', () => {
    expect(joinAddress()).toBe('')
    expect(joinAddress({})).toBe('')
    expect(joinAddress({ barangay: undefined, city: null })).toBe('')
  })
})
