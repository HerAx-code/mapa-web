/**
 * AssessmentSnapshot smoke tests — the intake-sheet side-rail decision-support
 * panel (financial figures + advisory DOH AO 2021-0044 class). Pure component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AssessmentSnapshot from '../../src/components/AssessmentSnapshot'

const settings = { povertyLinePerCapita: 2500, povertyLineYear: 2023, region: 'BARMM' }

describe('AssessmentSnapshot', () => {
  const sheet = { monthlyIncome: 6000, householdSize: 4, expenses: { food: 2000, rent: 1000 }, meansTestCategory: '' }

  it('shows income per person against the hospital\'s poverty line and a suggested class', () => {
    render(<AssessmentSnapshot sheet={sheet} settings={settings} showMeansTest canEdit onApplyMeansTest={() => {}} />)
    expect(screen.getByText('Income per person')).toBeInTheDocument()
    // 6000 / 4 = 1500 per person = 60% of ₱2,500 → Indigent (C3).
    expect(screen.getByText(/₱1,500/)).toBeInTheDocument()
    expect(screen.getByText(/60% of the poverty line/)).toBeInTheDocument()
    expect(screen.getByText(/BARMM 2023/)).toBeInTheDocument()
    expect(screen.getByText('Indigent (C3)')).toBeInTheDocument()
    expect(screen.getByText('Expenses vs income')).toBeInTheDocument()
    expect(screen.getByText(/₱3,000/)).toBeInTheDocument()
  })

  it('says when the hospital has not set a poverty line, and suggests nothing', () => {
    render(<AssessmentSnapshot sheet={sheet} showMeansTest canEdit onApplyMeansTest={() => {}} />)
    expect(screen.getByText(/Poverty line not set/)).toBeInTheDocument()
    expect(screen.queryByText('Suggested means-test')).not.toBeInTheDocument()
  })

  it('flags the MAIFIP catastrophic-spending test', () => {
    render(<AssessmentSnapshot sheet={sheet} bill={10000} settings={settings} showMeansTest={false} />)
    // ₱10,000 > 10% of a year of ₱6,000 income (₱7,200).
    expect(screen.getByText(/may qualify for MAIFIP/)).toBeInTheDocument()
  })

  it('states the peso shortfall (not a raw ratio) when expenses exceed income', () => {
    const underwater = { monthlyIncome: 10, householdSize: 9, expenses: { bills: 35085 } }
    render(<AssessmentSnapshot sheet={underwater} settings={settings} showMeansTest={false} />)
    expect(screen.getByText(/₱35,075 monthly shortfall/)).toBeInTheDocument()
    expect(screen.queryByText(/350,?850%/)).not.toBeInTheDocument()
  })

  it('applies the suggestion when "Use suggestion" is clicked', async () => {
    const onApply = vi.fn()
    render(<AssessmentSnapshot sheet={sheet} settings={settings} showMeansTest canEdit onApplyMeansTest={onApply} />)
    await userEvent.click(screen.getByRole('button', { name: /Use suggestion/ }))
    expect(onApply).toHaveBeenCalledWith('indigent_c3')
  })

  it('hides the class block when showMeansTest is false (patient facts mode)', () => {
    render(<AssessmentSnapshot sheet={sheet} settings={settings} showMeansTest={false} canEdit={false} />)
    expect(screen.queryByText('Suggested means-test')).not.toBeInTheDocument()
    expect(screen.getByText('Income per person')).toBeInTheDocument()
  })

  it('renders nothing when there is no income/household or expenses yet', () => {
    const { container } = render(<AssessmentSnapshot sheet={{ expenses: {} }} />)
    expect(container).toBeEmptyDOMElement()
  })
})
