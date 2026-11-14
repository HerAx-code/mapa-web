/**
 * DemoAccountsPanel (dev only) — reads the same list bootstrap-users.js seeds,
 * groups it by role with the current display names, hides accounts that can't
 * sign in (active:false) or are switched off (loginPanel:false), and signs in
 * with one click.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DemoAccountsPanel from '../../src/components/DemoAccountsPanel'
import { USERS } from '../../scripts/demo-accounts.js'

describe('DemoAccountsPanel', () => {
  it('lists every sign-in-able seeded account, grouped, with the new role names', async () => {
    render(<DemoAccountsPanel onPick={() => {}} />)
    expect(await screen.findByText('Network')).toBeTruthy()
    expect(screen.getByText('Super Admin')).toBeTruthy()          // platform_admin
    expect(screen.getByText('Hospital Admin')).toBeTruthy()       // super_admin
    expect(screen.getByText('Staff Admin')).toBeTruthy()
    expect(screen.getByText('platform@mapa.gov.ph')).toBeTruthy() // the seeded emails, not stale ones
    expect(screen.getByText('admin@mapa.gov.ph')).toBeTruthy()
    expect(screen.getByText('patient@gmail.com')).toBeTruthy()
  })

  it('hides deactivated and switched-off accounts', async () => {
    render(<DemoAccountsPanel onPick={() => {}} />)
    await screen.findByText('Network')
    const hidden = USERS.filter((u) => u.profile.active === false || u.loginPanel === false)
    expect(hidden.length).toBeGreaterThan(0)
    for (const u of hidden) expect(screen.queryByText(u.email)).toBeNull()
  })

  it('signs in with the clicked account', async () => {
    const onPick = vi.fn()
    render(<DemoAccountsPanel onPick={onPick} />)
    fireEvent.click(await screen.findByText('admin@mapa.gov.ph'))
    expect(onPick).toHaveBeenCalledWith('admin@mapa.gov.ph', 'admin123')
  })
})
