/**
 * Chart smoke tests. BarList + TrendArea render the analytics figures the
 * program-impact and agency-impact pages depend on. Pure components (no
 * router/auth/Firestore), so the test cost is tiny — they pin that the
 * charts produce the expected labels/values with data and a clean empty
 * state without it.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import BarList from '../../src/components/charts/BarList'
import TrendArea from '../../src/components/charts/TrendArea'

describe('BarList', () => {
  const data = [
    { key: 'PCSO', label: 'PCSO', amount: 13000, count: 2 },
    { key: 'DOH',  label: 'DOH',  amount: 7000,  count: 2 },
  ]

  it('renders each category label and its peso value', () => {
    render(<BarList data={data} />)
    expect(screen.getByText('PCSO')).toBeInTheDocument()
    expect(screen.getByText(/₱13,000/)).toBeInTheDocument()
    expect(screen.getByText('DOH')).toBeInTheDocument()
    expect(screen.getByText(/₱7,000/)).toBeInTheDocument()
  })

  it('exposes each bar with an accessible label (not color-alone)', () => {
    render(<BarList data={data} />)
    expect(screen.getByRole('img', { name: /PCSO: ₱13,000/ })).toBeInTheDocument()
  })

  it('shows an empty state with no data', () => {
    render(<BarList data={[]} emptyText="Nothing yet." />)
    expect(screen.getByText('Nothing yet.')).toBeInTheDocument()
  })
})

describe('TrendArea', () => {
  const data = [
    { key: '2026-08', amount: 15000 },
    { key: '2026-09', amount: 5000 },
  ]

  it('renders an accessible figure and direct-labels the endpoint', () => {
    const { container } = render(<TrendArea data={data} labelFor={(d) => d.key} />)
    expect(screen.getByRole('img', { name: /facilitated per month/i })).toBeInTheDocument()
    // Endpoint value is direct-labelled.
    expect(screen.getByText('₱5,000')).toBeInTheDocument()
    // One point per month.
    expect(container.querySelectorAll('circle').length).toBe(2)
  })

  it('shows an empty state with no data', () => {
    render(<TrendArea data={[]} emptyText="Nothing yet." />)
    expect(screen.getByText('Nothing yet.')).toBeInTheDocument()
  })
})
