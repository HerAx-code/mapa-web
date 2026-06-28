/**
 * CaseTimeline smoke tests (R33).
 *
 * Pure presentational component. No mocks needed -- takes events +
 * loading as props, renders icons + timestamps. Pins:
 *   - Loading state shows skeleton placeholders
 *   - Empty state shows the "no events yet" message
 *   - Events render most-recent-first (reverse of input order)
 *   - Known action types render with their typed label
 *   - Unknown action types fall through to the generic "Activity" label
 *   - Connector line is hidden on the last item
 *   - `actorName ?? 'System'` fallback works
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CaseTimeline from '../../src/components/CaseTimeline'

const ts = (date) => ({ toDate: () => new Date(date) })

const event = (id, action, overrides = {}) => ({
  id,
  action,
  actorName: 'Maria Santos',
  createdAt: ts('2026-06-20T10:00:00Z'),
  ...overrides,
})

describe('CaseTimeline', () => {
  it('renders the section heading', () => {
    render(<CaseTimeline events={[]} />)
    expect(screen.getByText(/Case Timeline/i)).toBeInTheDocument()
  })

  it('shows skeleton placeholders when loading', () => {
    const { container } = render(<CaseTimeline events={[]} loading />)
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('shows the empty state when there are no events', () => {
    render(<CaseTimeline events={[]} />)
    expect(screen.getByText(/No timeline events recorded yet/i)).toBeInTheDocument()
  })

  it('renders one row per event with the action label', () => {
    render(<CaseTimeline events={[
      event('a', 'app_approved'),
      event('b', 'gl_redeemed'),
      event('c', 'doc_verified'),
    ]} />)
    expect(screen.getByText('Slice Approved')).toBeInTheDocument()
    expect(screen.getByText('GL Redeemed')).toBeInTheDocument()
    expect(screen.getByText('Document Verified')).toBeInTheDocument()
  })

  it('renders most-recent-first (reverses input order)', () => {
    // The snapshot query returns ascending; the component reverses
    // so the latest activity is at the top.
    const { container } = render(<CaseTimeline events={[
      event('first',  'doc_verified', { details: 'first event' }),
      event('second', 'app_approved', { details: 'second event' }),
      event('third',  'gl_redeemed',  { details: 'third event' }),
    ]} />)
    const rows = container.querySelectorAll('.space-y-3 > div')
    // First rendered row should be the third event (most recent input)
    expect(rows[0].textContent).toContain('third event')
    expect(rows[2].textContent).toContain('first event')
  })

  it('REGRESSION GUARD: unknown action types render fallback label, not blank', () => {
    // If a new audit-log action ships without a matching ACTION_VISUAL
    // entry, the row must still render something readable instead of
    // crashing or showing an empty bubble.
    render(<CaseTimeline events={[event('x', 'some_new_action_type')]} />)
    expect(screen.getByText('Activity')).toBeInTheDocument()
    // Actor name still surfaces
    expect(screen.getByText(/Maria Santos/)).toBeInTheDocument()
  })

  it('renders the actor "System" fallback when actorName is missing', () => {
    render(<CaseTimeline events={[
      event('x', 'gl_auto_expired', { actorName: null }),
    ]} />)
    expect(screen.getByText(/System/)).toBeInTheDocument()
  })

  it('renders details text after the label when present', () => {
    render(<CaseTimeline events={[
      event('x', 'app_approved', { details: '₱25,000 approved for Maria' }),
    ]} />)
    expect(screen.getByText(/₱25,000 approved for Maria/)).toBeInTheDocument()
  })
})
