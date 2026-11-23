/**
 * DemoAccountsPanel (dev only) — reads the same list bootstrap-users.js seeds,
 * shows it as ONE dropdown grouped by role with the current display names,
 * hides accounts that can't sign in (active:false) or are switched off
 * (loginPanel:false), and fills the login fields with the chosen account
 * (picking copies email + password into the form — it does not auto sign-in).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import DemoAccountsPanel from '../../src/components/DemoAccountsPanel'
import { USERS } from '../../scripts/demo-accounts.js'

// The component prefers a private demo-accounts.local.json when one exists on
// the machine; tests pin the source so they don't depend on that file.
const seeded = async () => ({
  source: 'seeded',
  accounts: USERS.map((u) => ({ email: u.email, password: u.password, role: u.profile.role, agencyId: u.profile.agencyId, active: u.profile.active, loginPanel: u.loginPanel })),
})
const select = () => screen.findByLabelText(/Demo accounts/)

describe('DemoAccountsPanel', () => {
  it('is one dropdown, grouped by role, with the new role names', async () => {
    render(<DemoAccountsPanel onPick={() => {}} load={seeded} />)
    const box = await select()
    expect(box.tagName).toBe('SELECT')
    const groups = [...box.querySelectorAll('optgroup')].map((g) => g.label)
    expect(groups).toEqual(['Network', 'Hospital', 'Agencies', 'Patient'])
    expect(within(box).getByRole('option', { name: /^Super Admin — platform@mapa.gov.ph/ })).toBeTruthy()
    expect(within(box).getByRole('option', { name: /^Hospital Admin — admin@mapa.gov.ph/ })).toBeTruthy()
    expect(within(box).getByRole('option', { name: /^Staff Admin — staff@mapa.gov.ph/ })).toBeTruthy()
    expect(within(box).getByRole('option', { name: /patient@gmail.com/ })).toBeTruthy()
  })

  it('hides deactivated and switched-off accounts', async () => {
    render(<DemoAccountsPanel onPick={() => {}} load={seeded} />)
    const box = await select()
    const hidden = USERS.filter((u) => u.profile.active === false || u.loginPanel === false)
    expect(hidden.length).toBeGreaterThan(0)
    for (const u of hidden) expect(box.querySelector(`option[value="${u.email}"]`)).toBeNull()
  })

  it('fills the login fields with the chosen account on select (no auto sign-in)', async () => {
    const onPick = vi.fn()
    render(<DemoAccountsPanel onPick={onPick} load={seeded} />)
    fireEvent.change(await select(), { target: { value: 'admin@mapa.gov.ph' } })
    expect(onPick).toHaveBeenCalledWith('admin@mapa.gov.ph', 'admin123')
  })

  it('the Fill button re-fills from the current pick, and is disabled until one is chosen', async () => {
    const onPick = vi.fn()
    render(<DemoAccountsPanel onPick={onPick} load={seeded} />)
    await select()
    const fill = screen.getByRole('button', { name: 'Fill' })
    expect(fill).toBeDisabled()
    fireEvent.change(await select(), { target: { value: 'admin@mapa.gov.ph' } })
    onPick.mockClear()
    fireEvent.click(fill)
    expect(onPick).toHaveBeenCalledWith('admin@mapa.gov.ph', 'admin123')
  })

  it('a private-list entry without a password only hands over the email', async () => {
    const onPick = vi.fn()
    const local = async () => ({ source: 'local', accounts: [
      { role: 'platform_admin', email: 'ops@hospital.example', password: '', label: 'Network operator' },
    ] })
    render(<DemoAccountsPanel onPick={onPick} load={local} />)
    expect(await screen.findByText(/your private list/)).toBeTruthy()
    fireEvent.change(await select(), { target: { value: 'ops@hospital.example' } })
    expect(onPick).toHaveBeenCalledWith('ops@hospital.example', '')
  })
})
