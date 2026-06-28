/**
 * PatientAccessLog smoke tests (R37).
 *
 * Mocks the two external surfaces the component touches:
 *   - useAuth() from src/contexts/AuthContext (returns { user })
 *   - firebase/firestore onSnapshot (returns a controlled snapshot)
 *
 * Pins three behaviors:
 *   1. Loading state shows skeleton placeholders
 *   2. Empty state shows the "No activity yet" message
 *   3. Populated state renders one timeline entry per audit-log doc
 *      with the localized action label
 *
 * If the Firestore mock or the i18n key wiring breaks, these tests
 * catch it before the patient sees a blank page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../src/i18n'

// ── Mocks ──────────────────────────────────────────────────────────────

// onSnapshot is the only Firestore call PatientAccessLog makes.
// Capture the callback so tests can push controlled snapshots into it.
let snapshotCallback = null
let snapshotErrorCallback = null
const mockUnsub = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'mock-collection'),
  query: vi.fn((...args) => ({ _args: args })),
  where: vi.fn((field, op, val) => ({ field, op, val })),
  orderBy: vi.fn((field, dir) => ({ field, dir })),
  limit: vi.fn(n => ({ limit: n })),
  onSnapshot: vi.fn((q, onNext, onError) => {
    snapshotCallback = onNext
    snapshotErrorCallback = onError
    return mockUnsub
  }),
}))

vi.mock('../../src/firebase', () => ({ db: {} }))

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'patient-1', role: 'patient', name: 'Test Patient' } }),
}))

// ── Helpers ────────────────────────────────────────────────────────────

const ts = (date) => ({ toDate: () => new Date(date) })

const fakeSnap = (docs) => ({
  docs: docs.map((d, i) => ({ id: `entry-${i}`, data: () => d })),
})

const renderWithI18n = (ui) =>
  render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)

// Component under test (imported AFTER mocks so they take effect).
let PatientAccessLog
beforeEach(async () => {
  snapshotCallback = null
  snapshotErrorCallback = null
  vi.clearAllMocks()
  if (!PatientAccessLog) {
    PatientAccessLog = (await import('../../src/components/patient/PatientAccessLog')).default
  }
})

// ── Tests ──────────────────────────────────────────────────────────────

describe('PatientAccessLog', () => {
  it('renders the heading and description from i18n', () => {
    renderWithI18n(<PatientAccessLog />)
    expect(screen.getByText(/Who has accessed your record|Sino ang nakakita/i)).toBeInTheDocument()
  })

  it('shows skeleton placeholders before the first snapshot fires', () => {
    const { container } = renderWithI18n(<PatientAccessLog />)
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('shows the empty state when the snapshot returns zero entries', async () => {
    renderWithI18n(<PatientAccessLog />)
    expect(snapshotCallback).toBeTypeOf('function')
    snapshotCallback(fakeSnap([]))
    expect(await screen.findByText(/No activity on your record yet|Wala pang aksyon sa iyong rekord/i))
      .toBeInTheDocument()
  })

  it('renders one timeline entry per audit-log doc', async () => {
    renderWithI18n(<PatientAccessLog />)
    snapshotCallback(fakeSnap([
      { action: 'app_approved',  actorName: 'Maria Santos', createdAt: ts('2026-06-20T10:00:00Z') },
      { action: 'doc_verified',  actorName: 'CRMC Admin',   createdAt: ts('2026-06-19T15:30:00Z') },
      { action: 'patient_proceeded', actorName: 'You',      createdAt: ts('2026-06-18T08:00:00Z') },
    ]))
    expect(await screen.findByText(/Maria Santos/)).toBeInTheDocument()
    expect(screen.getByText(/approved a funding slice/i)).toBeInTheDocument()
    expect(screen.getByText(/verified one of your documents/i)).toBeInTheDocument()
  })

  it('renders a fallback label for unknown action types', async () => {
    renderWithI18n(<PatientAccessLog />)
    snapshotCallback(fakeSnap([
      { action: 'mystery_action', actorName: 'System', createdAt: ts('2026-06-20T10:00:00Z') },
    ]))
    expect(await screen.findByText(/performed an action.*mystery_action/i)).toBeInTheDocument()
  })

  it('surfaces an unavailable message on snapshot error', async () => {
    renderWithI18n(<PatientAccessLog />)
    // Silence the console.error the component logs in this path
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    snapshotErrorCallback(new Error('permission-denied'))
    expect(await screen.findByText(/Access log temporarily unavailable|Pansamantalang hindi makuha/i))
      .toBeInTheDocument()
    errSpy.mockRestore()
  })
})
