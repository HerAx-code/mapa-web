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
    expect(screen.getByText('Income / person')).toBeInTheDocument()
    // 6000 / 4 = 1500 per person → below the 2600 line → Indigent.
    expect(screen.getByText(/₱1,500/)).toBeInTheDocument()
    expect(screen.getByText('Suggested means-test')).toBeInTheDocument()
    expect(screen.getByText('Indigent')).toBeInTheDocument()
    // Expenses 3000 / income 6000 = 50%.
    expect(screen.getByText('50%')).toBeInTheDocument()
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
    expect(screen.getByText('Income / person')).toBeInTheDocument() // financials still shown
  })

  it('renders nothing when there is no income/household or expenses yet', () => {
    const { container } = render(<AssessmentSnapshot sheet={{ expenses: {} }} />)
    expect(container).toBeEmptyDOMElement()
  })
})
