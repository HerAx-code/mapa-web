/**
 * PipelineFunnel smoke tests — the admin dashboard's active-request stage
 * distribution. Pure presentational component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PipelineFunnel from '../../src/components/admin/PipelineFunnel'

const stages = [
  { key: 'submitted', label: 'Submitted', count: 5 },
  { key: 'under_review', label: 'Under review', count: 3 },
  { key: 'assessment', label: 'Assessment', count: 0 },
  { key: 'endorsed', label: 'Endorsed', count: 2 },
]

describe('PipelineFunnel', () => {
  it('renders each stage with its count and the open total', () => {
    render(<PipelineFunnel stages={stages} />)
    expect(screen.getByText('Submitted')).toBeInTheDocument()
    expect(screen.getByText('Endorsed')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    // total = 5+3+0+2 = 10 open
    expect(screen.getByText('10')).toBeInTheDocument()
  })

  it('shows an empty state when nothing is in the pipeline', () => {
    render(<PipelineFunnel stages={stages.map(s => ({ ...s, count: 0 }))} />)
    expect(screen.getByText('No active requests in the pipeline.')).toBeInTheDocument()
  })

  it('fires onOpenQueue from the header link', async () => {
    const onOpen = vi.fn()
    render(<PipelineFunnel stages={stages} onOpenQueue={onOpen} />)
    await userEvent.click(screen.getByRole('button', { name: /Open queue/ }))
    expect(onOpen).toHaveBeenCalled()
  })
})
