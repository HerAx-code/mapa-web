/**
 * AssessmentSnapshot smoke tests — the intake-sheet side-rail decision-support
 * panel (financial figures + advisory means-test suggestion). Pure component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AssessmentSnapshot from '../../src/components/AssessmentSnapshot'

describe('AssessmentSnapshot', () => {
  const sheet = { monthlyIncome: 6000, householdSize: 4, expenses: { food: 2000, rent: 1000 }, meansTestCategory: '' }

  it('shows income per person and a means-test suggestion', () => {
    render(<AssessmentSnapshot sheet={sheet} showMeansTest canEdit onApplyMeansTest={() => {}} />)
    expect(screen.getByText('Income per person')).toBeInTheDocument()
    // 6000 / 4 = 1500 per person → below the 2600 line → Indigent.
    expect(screen.getByText(/₱1,500/)).toBeInTheDocument()
    expect(screen.getByText('Suggested means-test')).toBeInTheDocument()
    expect(screen.getByText('Indigent')).toBeInTheDocument()
    // Below the poverty line → warning pill (1500 / 2600 ≈ 0.58 → 42% under).
    expect(screen.getByText(/Below poverty line — 42% under/)).toBeInTheDocument()
    // Expenses vs income section shows the entered figures.
    expect(screen.getByText('Expenses vs income')).toBeInTheDocument()
    expect(screen.getByText(/₱3,000/)).toBeInTheDocument()
  })

  it('states the peso shortfall (not a raw ratio) when expenses exceed income', () => {
    // A household several times underwater must not render a runaway percentage.
    const underwater = { monthlyIncome: 10, householdSize: 9, expenses: { bills: 35085 } }
    render(<AssessmentSnapshot sheet={underwater} showMeansTest={false} />)
    expect(screen.getByText(/₱35,075 monthly shortfall/)).toBeInTheDocument()
    expect(screen.queryByText(/350,?850%/)).not.toBeInTheDocument() // the old runaway ratio is gone
  })

  it('applies the suggestion when "Use suggestion" is clicked', async () => {
    const onApply = vi.fn()
    render(<AssessmentSnapshot sheet={sheet} showMeansTest canEdit onApplyMeansTest={onApply} />)
    await userEvent.click(screen.getByRole('button', { name: /Use suggestion/ }))
    expect(onApply).toHaveBeenCalledWith('indigent')
  })

  it('hides the means-test block when showMeansTest is false (patient facts mode)', () => {
    render(<AssessmentSnapshot sheet={sheet} showMeansTest={false} canEdit={false} />)
    expect(screen.queryByText('Suggested means-test')).not.toBeInTheDocument()
    expect(screen.getByText('Income per person')).toBeInTheDocument() // financials still shown
  })

  it('renders nothing when there is no income/household or expenses yet', () => {
    const { container } = render(<AssessmentSnapshot sheet={{ expenses: {} }} />)
    expect(container).toBeEmptyDOMElement()
  })
})
