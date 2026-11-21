/**
 * MfaGate — staff two-factor required (Phase 1, decision P1-C stage 1).
 * A staff member without a second factor gets a setup dialog they can't
 * dismiss (sign out is the only exit), unless the project doesn't offer
 * two-factor at all. Patients and enrolled staff never see it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let currentRole = 'staff_admin'
let enrolled = false
const logout = vi.fn()
const reauth = vi.fn()

vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1', role: currentRole }, logout }) }))
vi.mock('../../src/firebase', () => ({ auth: { currentUser: { uid: 'u1', email: 'sw@hospital.ph' } } }))
vi.mock('firebase/auth', () => ({ sendEmailVerification: vi.fn() }))
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:' } }))
vi.mock('../../src/utils/mfa', async (orig) => {
  const real = await orig()
  return {
    ...real,
    isMfaEnrolled: () => enrolled,
    mfaEnrolmentDue: (role, fbUser) => real.mfaEnrolmentDue(role, fbUser, 'required') && !enrolled,
    reauthWithPassword: (...a) => reauth(...a),
    startTotpEnrollment: async () => ({ secret: {}, qrUrl: 'otpauth://x', sharedKey: 'KEY' }),
  }
})

import MfaGate from '../../src/components/MfaGate'

beforeEach(() => { currentRole = 'staff_admin'; enrolled = false; logout.mockReset(); reauth.mockReset() })

describe('MfaGate', () => {
  it('shows a setup dialog to staff without two-factor, with no close button and Escape ignored', async () => {
    render(<MfaGate />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText(/Staff accounts need two-step verification/)).toBeTruthy()
    expect(screen.queryByLabelText('Close')).toBeNull()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('offers sign out as the way out', async () => {
    render(<MfaGate />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(logout).toHaveBeenCalled()
  })

  it("lets staff continue when the project doesn't offer two-factor (never a lockout)", async () => {
    reauth.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/operation-not-allowed' }))
    render(<MfaGate />)
    await userEvent.type(screen.getByPlaceholderText('Your password'), 'pw')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Continue for now' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('never shows to patients or to staff who already have two-factor', () => {
    currentRole = 'patient'
    const a = render(<MfaGate />)
    expect(screen.queryByRole('dialog')).toBeNull()
    a.unmount()
    currentRole = 'agency'; enrolled = true
    render(<MfaGate />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
