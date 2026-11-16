/**
 * Public pages render for a signed-out visitor — Landing (with live agencies
 * and several participating hospitals, so every multi-hospital section mounts)
 * and the "For hospitals" onboarding page. Guards against a runtime crash the
 * build can't see (e.g. a JSX component used but never imported), which the
 * CI e2e smoke caught once on the Landing "two doors" cards.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n, { setLanguage } from '../../src/i18n'

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
    // Compact partner-agency strip (landing review 2026-11-16)
    expect(screen.getByText('Funded by 2 partner programs')).toBeTruthy()
    // Participating hospitals: the access-code list and the offices in "Need help"
    expect(screen.getAllByText('Bangsamoro General Hospital').length).toBeGreaterThan(1)
    expect(screen.getAllByText('participating hospitals').length).toBeGreaterThan(0)
    // No single hospital's address or phone is written into the page
    expect(document.body.textContent).not.toMatch(/Sinsuat|421-2500/)
  })

  it('Landing scales to many agencies: 6 badges + "+N", 6 cards + show all, search', async () => {
    const { default: Landing } = await import('../../src/pages/auth/Landing')
    await i18n.changeLanguage('en')
    const saved = DATA.agenciesPublic
    DATA.agenciesPublic = Array.from({ length: 20 }, (_, i) => ({
      id: `a${i}`, name: `Agency ${String(i + 1).padStart(2, '0')}`, enabled: true, slots: { total: 10, remaining: 10 },
    }))
    try {
      wrap(<Landing />)
      expect(screen.getByText('Funded by 20 partner programs')).toBeTruthy()
      expect(screen.getByText('+14')).toBeTruthy()
      expect(screen.getAllByRole('heading', { level: 3, name: /^Agency \d+$/ })).toHaveLength(6)
      fireEvent.click(screen.getByRole('button', { name: 'Show all 20 programs' }))
      expect(screen.getAllByRole('heading', { level: 3, name: /^Agency \d+$/ })).toHaveLength(20)
      fireEvent.change(screen.getByPlaceholderText('Search programs'), { target: { value: 'Agency 07' } })
      expect(screen.getAllByRole('heading', { level: 3, name: /^Agency \d+$/ })).toHaveLength(1)
    } finally {
      DATA.agenciesPublic = saved
    }
  })

  it('Landing renders in Filipino too', async () => {
    const { default: Landing } = await import('../../src/pages/auth/Landing')
    // Filipino is loaded on demand (perf: lazy Filipino) — switch the way the app does.
    await setLanguage('fil')
    wrap(<Landing />)
    expect(screen.getByText('Para sa mga pasyente')).toBeTruthy()
    await i18n.changeLanguage('en')
  })

  it('For hospitals renders the onboarding form', async () => {
    const { default: ForHospitals } = await import('../../src/pages/ForHospitals')
    wrap(<ForHospitals />)
    expect(screen.getByRole('heading', { name: 'Request to join the MAPA network' })).toBeTruthy()
    expect(screen.getByLabelText(/Hospital name \(as on the DOH License to Operate\)/)).toBeTruthy()
    expect(screen.getByText('How joining works')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeTruthy()
  })
})
