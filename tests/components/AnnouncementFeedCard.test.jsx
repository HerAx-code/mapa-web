/**
 * AnnouncementFeedCard smoke tests (R38).
 *
 * Pure presentational. Pins:
 *   - Empty items returns null (no clutter on a clean dashboard)
 *   - Warning items have no dismiss button (cannot be dismissed)
 *   - Info items have a dismiss button
 *   - "Show N more" expander appears past 3 items + toggles
 *   - Agency badge renders for source:'agency' items
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../src/i18n'

// Mock useAuth (dismiss helper uses it for the localStorage key).
vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'test-uid', role: 'patient', name: 'T' } }),
}))

// Stub localStorage so dismissAnnouncement doesn't accidentally pollute
// test isolation.
beforeEach(() => {
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
})

// Component loaded after the mocks above.
let AnnouncementFeedCard
beforeAll(async () => {
  AnnouncementFeedCard = (await import('../../src/components/AnnouncementFeedCard')).default
})

const renderWithI18n = (ui) =>
  render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)

const annInfo = (title, overrides = {}) => ({
  id: title.replace(/\s+/g, '-'),
  type: 'info',
  title,
  message: 'Body of ' + title,
  source: 'crmc',
  ...overrides,
})

describe('AnnouncementFeedCard', () => {
  it('renders nothing when items is empty', () => {
    const { container } = renderWithI18n(<AnnouncementFeedCard items={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when items is undefined', () => {
    const { container } = renderWithI18n(<AnnouncementFeedCard />)
    expect(container.firstChild).toBeNull()
  })

  it('renders one item per visible entry (up to 3)', () => {
    renderWithI18n(<AnnouncementFeedCard items={[
      annInfo('First'),
      annInfo('Second'),
      annInfo('Third'),
    ]} />)
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
    expect(screen.getByText('Third')).toBeInTheDocument()
  })

  it('shows "Show N more" expander past 3 items, hides the rest by default', () => {
    renderWithI18n(<AnnouncementFeedCard items={[
      annInfo('First'),
      annInfo('Second'),
      annInfo('Third'),
      annInfo('Fourth'),
      annInfo('Fifth'),
    ]} />)
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Third')).toBeInTheDocument()
    expect(screen.queryByText('Fourth')).not.toBeInTheDocument()
    expect(screen.getByText(/Show 2 more|Magpakita pa ng 2/i)).toBeInTheDocument()
  })

  it('expander reveals the remaining items + flips to "Show less"', async () => {
    const user = userEvent.setup()
    renderWithI18n(<AnnouncementFeedCard items={[
      annInfo('A'), annInfo('B'), annInfo('C'),
      annInfo('D'), annInfo('E'),
    ]} />)
    await user.click(screen.getByText(/Show 2 more|Magpakita pa ng 2/i))
    expect(screen.getByText('D')).toBeInTheDocument()
    expect(screen.getByText('E')).toBeInTheDocument()
    expect(screen.getByText(/Show less|Magpakita ng kaunti/i)).toBeInTheDocument()
  })

  it('renders the agency badge for source:"agency" items', () => {
    renderWithI18n(<AnnouncementFeedCard items={[
      annInfo('Promo', { source: 'agency', agencyName: 'Malasakit Center' }),
    ]} />)
    expect(screen.getByText(/Malasakit Center/)).toBeInTheDocument()
  })

  it('shows a dismiss button on info-type items', () => {
    renderWithI18n(<AnnouncementFeedCard items={[annInfo('Dismissible')]} />)
    expect(screen.getByLabelText(/Dismiss announcement: Dismissible/i)).toBeInTheDocument()
  })

  it('REGRESSION GUARD: does NOT show a dismiss button on warning-type items', () => {
    // Warning announcements (system outage, breaking change) must
    // stay visible until they expire -- otherwise critical info gets
    // hidden by a careless click.
    renderWithI18n(<AnnouncementFeedCard items={[
      annInfo('Outage', { type: 'warning' }),
    ]} />)
    expect(screen.getByText('Outage')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Dismiss announcement: Outage/i)).not.toBeInTheDocument()
  })
})
