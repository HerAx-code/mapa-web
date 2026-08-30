/**
 * PathToZeroBalance smoke tests — the consolidated funding-source breakdown on
 * the CRMC request detail. Pins the two-layer math (coverage-first → agency
 * slices) and the slice state badges. Pure component.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PathToZeroBalance from '../../src/components/admin/requests/PathToZeroBalance'

const agencies = [{ id: 'a1', name: 'City Social Welfare' }, { id: 'a2', name: 'PCSO' }]

describe('PathToZeroBalance', () => {
  it('lists coverage-first + each agency slice toward the remaining balance', () => {
    const request = { totalBill: 10000, philhealthCovered: 3000, otherCovered: 1000, amountNeeded: 6000 }
    const slices = [
      { id: 's1', agencyId: 'a1', status: 'approved', amountApproved: 4000 },
      { id: 's2', agencyId: 'a2', status: 'endorsed', amountRequested: 1500 },
    ]
    const funding = { committed: 4000, outstanding: 1500, balance: 2000, pct: 67 }
    render(<PathToZeroBalance request={request} slices={slices} agencies={agencies} funding={funding} />)

    expect(screen.getByText('Path to zero balance')).toBeInTheDocument()
    expect(screen.getByText('Total bill')).toBeInTheDocument()
    expect(screen.getByText('PhilHealth')).toBeInTheDocument()
    expect(screen.getByText('Needed from agencies')).toBeInTheDocument()
    expect(screen.getByText('City Social Welfare')).toBeInTheDocument()
    expect(screen.getByText('PCSO')).toBeInTheDocument()
    // Remaining balance surfaced.
    expect(screen.getByText('Remaining balance')).toBeInTheDocument()
    expect(screen.getAllByText(/₱2,000/).length).toBeGreaterThan(0)
    // % of the full bill covered: (3000+1000+4000)/10000 = 80%.
    expect(screen.getByText(/80% of ₱10,000 covered/)).toBeInTheDocument()
  })

  it('shows an empty note when no agency is endorsed', () => {
    const request = { totalBill: 5000, amountNeeded: 5000 }
    const funding = { committed: 0, outstanding: 0, balance: 5000, pct: 0 }
    render(<PathToZeroBalance request={request} slices={[]} agencies={agencies} funding={funding} />)
    expect(screen.getByText('No agency endorsed yet.')).toBeInTheDocument()
  })
})
