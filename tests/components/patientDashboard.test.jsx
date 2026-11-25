/**
 * Patient dashboard (review 2026-11-25): one "do this now" for the current
 * case — an agency offer to accept, never a past case's document — the
 * email and holding-period blocks explained, and no "find a program" advice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../src/i18n'

// Firestore: each listener gets the rows set for its collection.
let rows = {}
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => name),
  query:      vi.fn((name) => name),
  where:      vi.fn(() => null),
  orderBy:    vi.fn(() => null),
  onSnapshot: vi.fn((name, onNext) => {
    onNext({ docs: (rows[name] ?? []).map((d) => ({ id: d.id, data: () => d })) })
    return () => {}
  }),
}))
const authState = { currentUser: { emailVerified: true } }
vi.mock('../../src/firebase', () => ({ db: {}, auth: authState }))
let profile = {}
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: profile }) }))
vi.mock('../../src/components/Layout', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../src/components/InstallPrompt', () => ({ default: () => null }))
vi.mock('../../src/components/Tour', () => ({ default: () => <div data-testid="tour" /> }))
vi.mock('../../src/components/patient/ProfileGapsCard', () => ({ default: () => null }))
vi.mock('../../src/components/AnnouncementFeedCard', () => ({ default: () => null }))
vi.mock('../../src/utils/announcements', () => ({ useFeedAnnouncements: () => [] }))

const renderDashboard = async () => {
  await i18n.changeLanguage('en')
  const { default: Dashboard } = await import('../../src/pages/patient/Dashboard')
  return render(<I18nextProvider i18n={i18n}><MemoryRouter><Dashboard /></MemoryRouter></I18nextProvider>)
}

const ts = (d) => ({ toDate: () => new Date(d), seconds: new Date(d).getTime() / 1000 })
const request = (over = {}) => ({
  id: 'r1', requestId: 'REQ-1', patientId: 'u1', status: 'endorsed', amountNeeded: 50000, totalBill: 60000,
  philhealthCovered: 10000, attachedDocuments: [{ documentId: 'd1', status: 'verified' }], ...over,
})

describe('Patient dashboard', () => {
  beforeEach(() => {
    rows = {}
    profile = { uid: 'u1', role: 'patient', name: 'juan dela cruz' }
    authState.currentUser = { emailVerified: true }
  })

  it('a new patient sees "How it works" in the real order and the tour', async () => {
    await renderDashboard()
    expect(screen.getByText('Welcome back, Juan.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeTruthy()
    const steps = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(steps[0]).toMatch('File your request')
    expect(steps[3]).toMatch('Guarantee Letter')
    expect(screen.getByTestId('tour')).toBeTruthy()
    expect(screen.queryByText(/Browse Programs|different program/)).toBeNull()
  })

  it('an endorsed slice asks the patient to accept the offer', async () => {
    rows.requests = [request()]
    rows.applications = [{ id: 'a1', requestId: 'r1', status: 'endorsed', agencyName: 'PCSO', agencyId: 'g1', amountRequested: 50000, submittedAt: ts('2026-11-20') }]
    await renderDashboard()
    const card = screen.getByText('An agency offered to help — accept it').closest('button')
    expect(card.textContent).toMatch('PCSO')
    expect(card.textContent).toMatch('Review')
    // Returning patient: no guide, no tour.
    expect(screen.queryByRole('heading', { name: 'How it works' })).toBeNull()
    expect(screen.queryByTestId('tour')).toBeNull()
  })

  it("a past case's rejected document doesn't ask for anything", async () => {
    rows.requests = [request({ id: 'r0', status: 'closed' })]
    rows.documents = [{ id: 'old', patientId: 'u1', status: 'rejected', requestId: 'r0', documentTypeName: 'Medical certificate' }]
    await renderDashboard()
    expect(screen.queryByText('Action needed')).toBeNull()
    expect(screen.queryByText('Medical certificate')).toBeNull()
    // The ended case gets "file a new request", not "try another program".
    expect(screen.getByText('Your last request has ended')).toBeTruthy()
    expect(screen.getByRole('button', { name: /File a new request/ })).toBeTruthy()
  })

  it('an unconfirmed email is explained before filing', async () => {
    profile = { ...profile, createdAt: ts('2026-11-25T02:00:00Z') }
    authState.currentUser = { emailVerified: false }
    await renderDashboard()
    expect(screen.getByText('Confirm your email address')).toBeTruthy()
  })

  it('a holding period is explained', async () => {
    profile = { ...profile, cooldown: 1 }
    await renderDashboard()
    expect(screen.getByText('New requests are on hold')).toBeTruthy()
  })

  it('the bill breakdown starts collapsed', async () => {
    rows.requests = [request()]
    await renderDashboard()
    const toggle = screen.getByRole('button', { name: /Bill breakdown/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Total hospital bill')).toBeNull()
  })
})
