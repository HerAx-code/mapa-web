/**
 * Public pages render for a signed-out visitor — Landing (with live agencies
 * and several participating hospitals, so every multi-hospital section mounts)
 * and the "For hospitals" onboarding page. Guards against a runtime crash the
 * build can't see (e.g. a JSX component used but never imported), which the
 * CI e2e smoke caught once on the Landing "two doors" cards.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../src/i18n'

const DATA = {
  agenciesPublic: [
    { id: 'dswd', name: 'DSWD', enabled: true, slots: { total: 10, remaining: 4 } },
    { id: 'pcso', name: 'PCSO', enabled: true, slots: { total: 5, remaining: 5 } },
  ],
  hospitalsPublic: [
    { id: 'hospital-1', facilityName: 'Cotabato Regional Medical Center', accessCodePrefix: 'CRMC', enabled: true },
    { id: 'bgh', facilityName: 'Bangsamoro General Hospital', accessCodePrefix: 'BGH', enabled: true },
  ],
}

vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../src/firebase', () => ({ db: {}, auth: { currentUser: null }, signInAnonymously: vi.fn() }))
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }))
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ name }),
  query: (c) => c,
  where: () => ({}),
  doc: () => ({}),
  setDoc: vi.fn(),
  serverTimestamp: () => 'TS',
  onSnapshot: (q, cb) => {
    cb({ docs: (DATA[q.name] ?? []).map((d) => ({ id: d.id, data: () => d })) })
    return () => {}
  },
}))

const wrap = (ui) => render(
  <I18nextProvider i18n={i18n}><MemoryRouter>{ui}</MemoryRouter></I18nextProvider>,
)

describe('public pages (signed out)', () => {
  it('Landing renders every multi-hospital section without crashing', async () => {
    const { default: Landing } = await import('../../src/pages/auth/Landing')
    await i18n.changeLanguage('en')
    wrap(<Landing />)
    // Two doors
    expect(screen.getByText('For patients')).toBeTruthy()
    expect(screen.getByText('Request onboarding')).toBeTruthy()
    // Live partner-agency strip
    expect(screen.getByText('One application reaches every partner agency')).toBeTruthy()
    // Participating hospitals with their prefixes, and the network band counts
    expect(screen.getByText('Bangsamoro General Hospital')).toBeTruthy()
    // The band label appears twice by design: screen-reader <dt> + visible <dd>.
    expect(screen.getAllByText('participating hospitals').length).toBeGreaterThan(0)
  })

  it('Landing renders in Filipino too', async () => {
    const { default: Landing } = await import('../../src/pages/auth/Landing')
    await i18n.changeLanguage('fil')
    wrap(<Landing />)
    expect(screen.getByText('Para sa mga pasyente')).toBeTruthy()
    await i18n.changeLanguage('en')
  })

  it('For hospitals renders the onboarding form', async () => {
    const { default: ForHospitals } = await import('../../src/pages/ForHospitals')
    wrap(<ForHospitals />)
    expect(screen.getByRole('heading', { name: 'Bring MAPA to your hospital' })).toBeTruthy()
    expect(screen.getByLabelText('Hospital name')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Request onboarding' })).toBeTruthy()
  })
})
