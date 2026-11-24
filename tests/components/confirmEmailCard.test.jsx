/**
 * The filing page's confirm-email card (registration research 2026-11-24):
 * shows the address, resends the link, and lets the patient through only once
 * Firebase says the email is verified (with a fresh token for the rules).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../src/i18n'

const currentUser = { emailVerified: false, reload: vi.fn(), getIdToken: vi.fn() }
vi.mock('../../src/firebase', () => ({ auth: { currentUser } }))
const sendEmailVerification = vi.fn()
vi.mock('firebase/auth', () => ({ sendEmailVerification: (...a) => sendEmailVerification(...a) }))

const renderCard = async (onConfirmed = vi.fn()) => {
  await i18n.changeLanguage('en')
  const { default: ConfirmEmailCard } = await import('../../src/components/patient/ConfirmEmailCard')
  render(<I18nextProvider i18n={i18n}><ConfirmEmailCard email="juan@example.com" onConfirmed={onConfirmed} /></I18nextProvider>)
  return onConfirmed
}

describe('ConfirmEmailCard', () => {
  beforeEach(() => {
    currentUser.emailVerified = false
    currentUser.reload.mockReset().mockResolvedValue()
    currentUser.getIdToken.mockReset().mockResolvedValue('t')
    sendEmailVerification.mockReset().mockResolvedValue()
  })

  it('shows the address and resends the link, then waits before another', async () => {
    await renderCard()
    expect(screen.getByText('juan@example.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send the link again' }))
    expect(await screen.findByText('We sent a new link to juan@example.com.')).toBeTruthy()
    expect(sendEmailVerification).toHaveBeenCalledWith(currentUser)
    expect(screen.getByRole('button', { name: /Send again in \d+ s/ }).disabled).toBe(true)
  })

  it('says so when the email is not confirmed yet', async () => {
    const onConfirmed = await renderCard()
    fireEvent.click(screen.getByRole('button', { name: "I've opened the link" }))
    expect(await screen.findByText(/isn't confirmed yet/)).toBeTruthy()
    expect(onConfirmed).not.toHaveBeenCalled()
  })

  it('lets the patient through once confirmed, with a fresh token', async () => {
    currentUser.reload.mockImplementation(async () => { currentUser.emailVerified = true })
    const onConfirmed = await renderCard()
    fireEvent.click(screen.getByRole('button', { name: "I've opened the link" }))
    await vi.waitFor(() => expect(onConfirmed).toHaveBeenCalled())
    expect(currentUser.getIdToken).toHaveBeenCalledWith(true)
  })
})
