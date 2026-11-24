/**
 * /install follows the visitor's browser (review 2026-11-25): in-app browsers
 * are told to open the page in Chrome/Safari, every iPhone browser gets the
 * Share steps, Android shows the steps at once when Chrome offers no install
 * dialog (no 8-second wait), and a desktop gets a QR code.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../src/i18n'

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(() => Promise.resolve('data:image/png;base64,QR')) } }))

const UA = {
  messenger: 'Mozilla/5.0 (Linux; Android 13; SM-A045F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/455.0.0.44.116;]',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}
const realUA = window.navigator.userAgent

const renderAs = async (ua) => {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  window.__mapaDeferredInstallPrompt = null
  await i18n.changeLanguage('en')
  const { default: InstallApp } = await import('../../src/pages/auth/InstallApp')
  return render(<I18nextProvider i18n={i18n}><MemoryRouter><InstallApp /></MemoryRouter></I18nextProvider>)
}

describe('Install page', () => {
  afterEach(() => Object.defineProperty(window.navigator, 'userAgent', { value: realUA, configurable: true }))

  it('Messenger: open the page in Chrome first, with a copy-link button', async () => {
    await renderAs(UA.messenger)
    expect(screen.getByRole('heading', { name: 'Open this page in Chrome first' })).toBeTruthy()
    expect(screen.getByText(/Tap ⋮ at the top right/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Copy link/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Install MAPA/ })).toBeNull()
  })

  it('iPhone with Chrome: the iPhone steps, worded for Chrome, and no Install button', async () => {
    await renderAs(UA.iphoneChrome)
    expect(screen.getByText('Using Chrome on iPhone.')).toBeTruthy()
    expect(screen.getByText(/at the right of the address bar/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Install MAPA/ })).toBeNull()
  })

  it('Android without an install dialog: tapping Install shows the steps at once', async () => {
    await renderAs(UA.android)
    fireEvent.click(screen.getByRole('button', { name: /Install MAPA/ }))
    expect(screen.getByText(/isn't offering the install button right now/)).toBeTruthy()
    expect(screen.queryByText(/Preparing install/)).toBeNull()
  })

  it('desktop: a QR code and the full address, built from this site', async () => {
    await renderAs(UA.desktop)
    expect(await screen.findByAltText(/QR code that opens the MAPA install page/)).toBeTruthy()
    expect(screen.getByText(`${window.location.origin}/install`)).toBeTruthy()
  })

  it('never calls itself "the hospital"', async () => {
    await renderAs(UA.android)
    expect(document.body.textContent).not.toMatch(/the hospital/)
    expect(document.body.textContent).not.toMatch(/coming soon/i)
  })
})
