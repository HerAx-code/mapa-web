/**
 * Public pages render for a signed-out visitor — Landing (with live agencies
 * and several participating hospitals, so every multi-hospital section mounts)
 * and the "For hospitals" onboarding page. Guards against a runtime crash the
 * build can't see (e.g. a JSX component used but never imported), which the
 * CI e2e smoke caught once on the Landing's old "two doors" cards.
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
    // The one journey uses the tracker's own stage names (relayout 2026-11-24)
    for (const stage of ['Submitted', 'Under review', 'Assessment', 'Endorsed', 'Funding', 'Complete']) {
      expect(screen.getByText(stage)).toBeTruthy()
    }
    // Who can apply: no "already classified indigent" precondition
    expect(screen.getByText('Who can apply')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/classified you as an indigent/)
    // One list of hospital offices, each with its code prefix
    expect(screen.getAllByText('Bangsamoro General Hospital')).toHaveLength(1)
    expect(screen.getByText('Codes from this office start with BGH-')).toBeTruthy()
    // Partner agencies by name only (FAQ), no public slot counts
    expect(screen.getByRole('list', { name: 'Partner programs' }).textContent).toMatch(/DSWD.*PCSO/)
    expect(document.body.textContent).not.toMatch(/slots remaining|Funded by/)
    // Nothing that isn't built: no Meet link, no authorization letter
    expect(document.body.textContent).not.toMatch(/Google Meet|authorization letter/)
    // A one-line band for hospitals
    expect(screen.getByText('Are you a hospital?')).toBeTruthy()
    // No single hospital's address or phone is written into the page
    expect(document.body.textContent).not.toMatch(/Sinsuat|421-2500/)
  })

  it('Landing lists many hospitals 4 at a time, with one show-all switch', async () => {
    const { default: Landing } = await import('../../src/pages/auth/Landing')
    await i18n.changeLanguage('en')
    const saved = DATA.hospitalsPublic
    DATA.hospitalsPublic = Array.from({ length: 7 }, (_, i) => ({
      id: `h${i}`, facilityName: `Hospital ${i + 1}`, accessCodePrefix: `H${i}`, enabled: true,
    }))
    try {
      wrap(<Landing />)
      expect(screen.getAllByText(/^Hospital \d$/)).toHaveLength(4)
      fireEvent.click(screen.getByRole('button', { name: 'Show all 7 hospitals' }))
      expect(screen.getAllByText(/^Hospital \d$/)).toHaveLength(7)
    } finally {
      DATA.hospitalsPublic = saved
    }
  })

  it('Landing renders in Filipino too', async () => {
    const { default: Landing } = await import('../../src/pages/auth/Landing')
    // Filipino is loaded on demand (perf: lazy Filipino) — switch the way the app does.
    await setLanguage('fil')
    wrap(<Landing />)
    expect(screen.getByText('Sino ang maaaring mag-apply')).toBeTruthy()
    expect(screen.getByText('Kayo ba ay isang ospital?')).toBeTruthy()
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
