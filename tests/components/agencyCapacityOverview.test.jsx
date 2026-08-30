/**
 * AgencyCapacityOverview smoke tests — the admin Agencies fund-capacity band.
 * Pure component; aggregates agency budgets and flags near-depletion.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AgencyCapacityOverview from '../../src/components/admin/AgencyCapacityOverview'

const agencies = [
  { id: 'a1', name: 'City Social Welfare', enabled: true, budget: { allocated: 100000, committed: 90000, disbursed: 40000 }, slots: { total: 20, remaining: 5 } },
  { id: 'a2', name: 'PCSO',                enabled: true, budget: { allocated: 100000, committed: 20000, disbursed: 10000 }, slots: { total: 10, remaining: 8 } },
  { id: 'a3', name: 'Unfunded NGO',        enabled: false, budget: { allocated: 0 }, slots: { total: 0, remaining: 0 } },
]

describe('AgencyCapacityOverview', () => {
  it('aggregates budgets into remaining capacity + utilization', () => {
    render(<AgencyCapacityOverview agencies={agencies} />)
    // allocated 200k, committed 110k → remaining 90k, 55% committed
    expect(screen.getByText('Remaining fund capacity')).toBeInTheDocument()
    expect(screen.getByText('₱90,000')).toBeInTheDocument()
    expect(screen.getByText('55%')).toBeInTheDocument()
  })

  it('flags agencies near depletion (>=85% committed)', () => {
    render(<AgencyCapacityOverview agencies={agencies} />)
    // a1 is 90% committed → near depletion; a2 (20%) is not.
    expect(screen.getByText('City Social Welfare')).toBeInTheDocument()
    expect(screen.getByText('90%')).toBeInTheDocument()
    expect(screen.queryByText('PCSO')).not.toBeInTheDocument()
  })

  it('renders nothing when no agency has an allocation', () => {
    const { container } = render(<AgencyCapacityOverview agencies={[{ id: 'x', budget: { allocated: 0 } }]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
