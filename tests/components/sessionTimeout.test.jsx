/**
 * SessionTimeoutProvider — staff idle timeout. Verifies it arms for staff,
 * warns before logout, logs out on expiry, resets on "Stay signed in", and is
 * a no-op for patients. Uses fake timers (which also fake Date.now()).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { ROLES, SESSION_IDLE_MS, SESSION_WARN_MS } from '../../src/utils/constants'

// Shared mock handles (hoisted so the vi.mock factories can close over them).
const h = vi.hoisted(() => ({
  logout:   vi.fn(),
  navigate: vi.fn(),
  state:    { user: { role: 'staff_admin' } },
}))

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: h.state.user, logout: h.logout }),
}))
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => h.navigate,
}))

import SessionTimeoutProvider from '../../src/components/SessionTimeoutProvider'

const renderIt = () =>
  render(<SessionTimeoutProvider><div>app content</div></SessionTimeoutProvider>)

describe('SessionTimeoutProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    h.logout.mockClear()
    h.navigate.mockClear()
    h.state.user = { role: ROLES.STAFF_ADMIN }
    try { sessionStorage.clear() } catch { /* ignore */ }
  })
  afterEach(() => { vi.useRealTimers() })

  it('warns a staff user before idle logout, then logs out and redirects', () => {
    renderIt()
    // Just inside the warning window — modal appears.
    act(() => { vi.advanceTimersByTime(SESSION_IDLE_MS - SESSION_WARN_MS + 1000) })
    expect(screen.getByText(/Still there/i)).toBeTruthy()
    // Past the idle threshold — logout + redirect.
    act(() => { vi.advanceTimersByTime(SESSION_WARN_MS + 1000) })
    expect(h.logout).toHaveBeenCalledTimes(1)
    expect(h.navigate).toHaveBeenCalledWith('/login?reason=timeout', { replace: true })
  })

  it('is a no-op for a patient — no warning, no logout', () => {
    h.state.user = { role: ROLES.PATIENT }
    renderIt()
    act(() => { vi.advanceTimersByTime(SESSION_IDLE_MS + 5000) })
    expect(screen.queryByText(/Still there/i)).toBeNull()
    expect(h.logout).not.toHaveBeenCalled()
  })

  it('"Stay signed in" dismisses the warning and keeps the session alive', () => {
    renderIt()
    act(() => { vi.advanceTimersByTime(SESSION_IDLE_MS - SESSION_WARN_MS + 1000) })
    fireEvent.click(screen.getByText(/Stay signed in/i))
    expect(screen.queryByText(/Still there/i)).toBeNull()
    act(() => { vi.advanceTimersByTime(5000) })
    expect(h.logout).not.toHaveBeenCalled()
  })

  it('"Log out" in the warning ends the session immediately', () => {
    renderIt()
    act(() => { vi.advanceTimersByTime(SESSION_IDLE_MS - SESSION_WARN_MS + 1000) })
    fireEvent.click(screen.getByText(/^Log out$/i))
    expect(h.logout).toHaveBeenCalledTimes(1)
  })
})
