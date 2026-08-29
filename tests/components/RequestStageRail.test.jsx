/**
 * RequestStageRail smoke tests. The rail is the visible centrepiece of the
 * CRMC request-workspace redesign; it renders the verify → assess → interview
 * → endorse progression from the requestStage model. Pure component (no
 * router/auth/Firestore), so verifying it in jsdom stands in for a browser
 * screenshot while pinning the states that matter.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RequestStageRail from '../../src/components/admin/RequestStageRail'
import { deriveRequestStage } from '../../src/utils/requestStage'

const completeIntake = {
  householdSize: 4, monthlyIncome: 8000, diagnosis: 'Pneumonia',
  recommendation: 'Endorse', meansTestCategory: 'C3', completedBy: 'MSW',
}
const verified = [{ status: 'verified' }, { status: 'verified' }]

describe('RequestStageRail', () => {
  it('renders all four stages with their detail', () => {
    render(<RequestStageRail stage={deriveRequestStage({ status: 'submitted' }, [{ status: 'pending' }])} />)
    for (const label of ['Verify documents', 'Assess', 'Interview', 'Endorse']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('0/1 verified')).toBeInTheDocument()
  })

  it('marks completed stages done and the first incomplete as current', () => {
    // docs verified → verify done (check icon), assess still incomplete.
    render(<RequestStageRail stage={deriveRequestStage({ status: 'under_review' }, verified)} />)
    expect(screen.getByLabelText('done')).toBeInTheDocument()       // verify shows a check
    expect(screen.getByText('2/2 verified')).toBeInTheDocument()
    expect(screen.getByText('Intake incomplete')).toBeInTheDocument()
  })

  it('renders nothing for terminal requests', () => {
    const { container } = render(
      <RequestStageRail stage={deriveRequestStage({ status: 'fully_funded', intakeSheet: completeIntake, interviewOutcome: 'x' }, verified)} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when no stage is passed', () => {
    const { container } = render(<RequestStageRail stage={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
