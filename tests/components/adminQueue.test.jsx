/**
 * Admin request-queue smoke tests — QueueTabs + RequestsTable (redesign
 * Phase 2). Both are presentational; the container owns state. These pin the
 * things a regression would break silently: the stage-bucket tabs render with
 * counts and switch, and the table row surfaces the scannable figures
 * (balance, coverage %, docs X/N, stage chip) bound to the shared queueBuckets
 * model. Pure components — no router, auth, or Firestore.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import QueueTabs from '../../src/components/admin/requests/QueueTabs'
import RequestsTable from '../../src/components/admin/requests/RequestsTable'

const counts = { verify: 3, assess: 1, interview: 0, endorse: 2, endorsed: 4, completed: 5, all: 15 }

describe('QueueTabs', () => {
  it('renders every stage bucket with its count and marks the active one', () => {
    render(<QueueTabs active="verify" counts={counts} onChange={() => {}} />)
    expect(screen.getByRole('tab', { name: /Needs verification/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Ready to endorse/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /All/ })).toBeInTheDocument()
    // The active tab shows its count.
    expect(within(screen.getByRole('tab', { name: /Needs verification/ })).getByText('3')).toBeInTheDocument()
  })
  it('calls onChange with the bucket key when a tab is clicked', async () => {
    const onChange = vi.fn()
    render(<QueueTabs active="all" counts={counts} onChange={onChange} />)
    await userEvent.click(screen.getByRole('tab', { name: /Endorsed/ }))
    expect(onChange).toHaveBeenCalledWith('endorsed')
  })
})

describe('RequestsTable', () => {
  // One pre-endorsement request: 1/2 docs verified → "Needs verification".
  const request = {
    id: 'r1', requestId: 'REQ-2026-01', patientName: 'Maria Santos',
    assistanceType: 'Dialysis', status: 'under_review',
    amountNeeded: 10000, totalBill: 10000,
    attachedDocuments: [{ documentId: 'd1', status: 'verified' }, { documentId: 'd2', status: 'pending' }],
    submittedAt: { seconds: Math.floor(Date.now() / 1000) - 2 * 86400 },
  }
  const slicesByRequest = new Map() // no slices → 0% covered, full balance

  it('renders a scannable row: patient, docs X/N, balance', () => {
    render(
      <RequestsTable requests={[request]} slicesByRequest={slicesByRequest}
        sort="waiting" onSort={() => {}} onOpen={() => {}} coverageWarning={() => null} />
    )
    // Patient appears (desktop table + mobile card both render in jsdom).
    expect(screen.getAllByText('Maria Santos').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/REQ-2026-01/).length).toBeGreaterThan(0)
    // Docs 1/2 verified.
    expect(screen.getAllByText('1/2').length).toBeGreaterThan(0)
    // Full balance (no coverage): ₱10,000.
    expect(screen.getAllByText(/₱10,000/).length).toBeGreaterThan(0)
    // Stage chip for the verify bucket.
    expect(screen.getAllByText('Verify docs').length).toBeGreaterThan(0)
  })

  it('opens a request when a row is clicked', async () => {
    const onOpen = vi.fn()
    render(
      <RequestsTable requests={[request]} slicesByRequest={slicesByRequest}
        sort="waiting" onSort={() => {}} onOpen={onOpen} coverageWarning={() => null} />
    )
    await userEvent.click(screen.getAllByText('Maria Santos')[0])
    expect(onOpen).toHaveBeenCalledWith(request)
  })

  it('fires onSort from a sortable header', async () => {
    const onSort = vi.fn()
    render(
      <RequestsTable requests={[request]} slicesByRequest={slicesByRequest}
        sort="waiting" onSort={onSort} onOpen={() => {}} coverageWarning={() => null} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Balance' }))
    expect(onSort).toHaveBeenCalledWith('balance')
  })
})
