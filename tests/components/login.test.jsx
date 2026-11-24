/**
 * Login (review 2026-11-25): one honest wrong-credentials message with ways
 * out, errors that stay on the page, help for a disabled account, and a real
 * Forgot password dialog.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../src/i18n'

const login = vi.fn()
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, login }) }))
vi.mock('../../src/firebase', () => ({ auth: {}, db: {} }))
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail: vi.fn(() => Promise.resolve()) }))
vi.mock('../../src/utils/mfa', () => ({ isMfaChallenge: () => false, resolverFor: vi.fn(), resolveTotpSignIn: vi.fn() }))

// Firebase errors are Error objects with a code.
const firebaseError = (code) => Object.assign(new Error(code), { code })

const renderLogin = async () => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  await i18n.changeLanguage('en')
  const { default: Login } = await import('../../src/pages/auth/Login')
  return render(<I18nextProvider i18n={i18n}><MemoryRouter><Login /></MemoryRouter></I18nextProvider>)
}
const fill = (email, password) => {
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
}
const signIn = () => fireEvent.click(screen.getByRole('button', { name: /^Sign in/ }))

describe('Login', () => {
  beforeEach(() => login.mockClear())

  it('a wrong email or password gets one message, with ways out, that stays on the page', async () => {
    login.mockImplementationOnce(async () => { throw firebaseError('auth/invalid-credential') })
    await renderLogin()
    fill('nobody@example.com', 'wrong')
    signIn()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch('The email or password is incorrect.')
    expect(alert.textContent).not.toMatch(/Incorrect password/)
    expect(screen.getByRole('button', { name: 'Reset your password' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create an account' })).toBeTruthy()
    expect(screen.getByLabelText('Email address').getAttribute('aria-invalid')).toBe('true')
    // Typing clears it.
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'nobody2@example.com' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('empty fields are reported on the page', async () => {
    await renderLogin()
    signIn()
    expect((await screen.findByRole('alert')).textContent).toMatch('Please enter your email and password.')
    expect(login).not.toHaveBeenCalled()
  })

  it('a turned-off account is told whom to ask', async () => {
    login.mockImplementationOnce(async () => { throw firebaseError('auth/user-disabled') })
    await renderLogin()
    fill('pat@example.com', 'x')
    signIn()
    expect((await screen.findByRole('alert')).textContent).toMatch(/social-services office of your hospital/)
  })

  it('Forgot password opens a real dialog that Escape closes', async () => {
    await renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
    const dialog = screen.getByRole('dialog', { name: 'Reset your password' })
    expect(dialog).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows help for someone who cannot get in', async () => {
    await renderLogin()
    expect(screen.getByText(/Forgot which email you used/)).toBeTruthy()
  })
})
