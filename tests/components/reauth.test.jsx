/**
 * Step-up re-auth: ReauthModal (password → reauthenticateWithCredential) and
 * useStepUpAuth (freshness window gating).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, renderHook, act } from '@testing-library/react'

const h = vi.hoisted(() => ({
  reauth:      vi.fn(() => Promise.resolve()),
  resolveTotp: vi.fn(() => Promise.resolve()),
  onSuccess:   vi.fn(),
  onClose:     vi.fn(),
}))

vi.mock('../../src/firebase', () => ({ auth: { currentUser: {} } }))
vi.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: vi.fn(() => 'cred') },
  reauthenticateWithCredential: (...a) => h.reauth(...a),
}))
vi.mock('../../src/utils/mfa', () => ({
  isMfaChallenge: (err) => err?.code === 'auth/multi-factor-auth-required',
  resolverFor: () => ({ hints: [] }),
  resolveTotpSignIn: (...a) => h.resolveTotp(...a),
}))
vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'staff@example.org' } }),
}))

import ReauthModal from '../../src/components/ReauthModal'
import { useStepUpAuth } from '../../src/hooks/useStepUpAuth'

const renderOpen = () => render(<ReauthModal open onSuccess={h.onSuccess} onClose={h.onClose} />)
const confirmBtn = () => screen.getByRole('button', { name: /^Confirm$/i })
const pwInput = () => screen.getByPlaceholderText(/password/i)

describe('ReauthModal', () => {
  beforeEach(() => {
    h.reauth.mockReset().mockResolvedValue(undefined)
    h.resolveTotp.mockReset().mockResolvedValue(undefined)
    h.onSuccess.mockClear()
    h.onClose.mockClear()
  })

  it('renders nothing when closed', () => {
    const { container } = render(<ReauthModal open={false} onSuccess={h.onSuccess} onClose={h.onClose} />)
    expect(container.firstChild).toBeNull()
  })

  it('calls onSuccess after a correct password', async () => {
    renderOpen()
    fireEvent.change(pwInput(), { target: { value: 'secret' } })
    fireEvent.click(confirmBtn())
    await waitFor(() => expect(h.onSuccess).toHaveBeenCalledTimes(1))
    expect(h.reauth).toHaveBeenCalled()
  })

  it('shows an error on wrong password and does not call onSuccess', async () => {
    h.reauth.mockRejectedValue({ code: 'auth/wrong-password' })
    renderOpen()
    fireEvent.change(pwInput(), { target: { value: 'bad' } })
    fireEvent.click(confirmBtn())
    await waitFor(() => expect(screen.getByText(/Incorrect password/i)).toBeTruthy())
    expect(h.onSuccess).not.toHaveBeenCalled()
  })

  it('for MFA-enrolled staff: password → TOTP code → onSuccess', async () => {
    h.reauth.mockRejectedValue({ code: 'auth/multi-factor-auth-required' })
    renderOpen()
    fireEvent.change(pwInput(), { target: { value: 'secret' } })
    fireEvent.click(confirmBtn())
    // Transitions to the authenticator-code step.
    await waitFor(() => expect(screen.getByText(/authenticator app/i)).toBeTruthy())
    expect(h.onSuccess).not.toHaveBeenCalled()
    // Enter the 6-digit code and verify.
    fireEvent.change(screen.getByPlaceholderText(/123456/), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/i }))
    await waitFor(() => expect(h.resolveTotp).toHaveBeenCalled())
    expect(h.onSuccess).toHaveBeenCalledTimes(1)
  })
})

describe('useStepUpAuth', () => {
  beforeEach(() => { try { sessionStorage.clear() } catch { /* ignore */ } })

  it('gates when not fresh, then runs guarded actions directly once fresh', () => {
    const { result } = renderHook(() => useStepUpAuth({ freshnessMs: 10_000 }))

    const action = vi.fn()
    act(() => result.current.requireReauth(action))
    expect(result.current.reauthProps.open).toBe(true)   // prompt shown
    expect(action).not.toHaveBeenCalled()

    act(() => result.current.reauthProps.onSuccess())      // re-auth succeeds
    expect(action).toHaveBeenCalledTimes(1)                // queued action runs
    expect(result.current.reauthProps.open).toBe(false)

    const action2 = vi.fn()
    act(() => result.current.requireReauth(action2))        // within freshness
    expect(action2).toHaveBeenCalledTimes(1)                // runs without a prompt
    expect(result.current.reauthProps.open).toBe(false)
  })

  it('cancelling the prompt does not run the action', () => {
    const { result } = renderHook(() => useStepUpAuth({ freshnessMs: 10_000 }))
    const action = vi.fn()
    act(() => result.current.requireReauth(action))
    act(() => result.current.reauthProps.onClose())
    expect(action).not.toHaveBeenCalled()
    expect(result.current.reauthProps.open).toBe(false)
  })
})
