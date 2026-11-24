/**
 * Register, step 3 (register review 2026-11-24): the access-code field starts
 * empty (codes carry the issuing hospital's prefix), is labelled optional with
 * no required marker, and the review shows — and marks as permanent — the last
 * name and birthdate the code is checked against.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../src/i18n'

const HOSPITALS = [
  { id: 'crmc', facilityName: 'Cotabato Regional and Medical Center', accessCodePrefix: 'CRMC', enabled: true },
]

vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, updateUser: vi.fn() }) }))
vi.mock('../../src/firebase', () => ({
  db: {}, auth: { currentUser: null }, functions: {}, signInAnonymously: vi.fn(), httpsCallable: vi.fn(),
}))
vi.mock('firebase/auth', () => ({ createUserWithEmailAndPassword: vi.fn(), fetchSignInMethodsForEmail: vi.fn(), deleteUser: vi.fn(), signOut: vi.fn() }))
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ name }), query: (c) => c, where: () => ({}), doc: () => ({}),
  getDoc: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), serverTimestamp: () => 'TS',
  onSnapshot: (q, cb) => { cb({ docs: (q.name === 'hospitalsPublic' ? HOSPITALS : []).map((d) => ({ id: d.id, data: () => d })) }); return () => {} },
}))

const DRAFT = {
  step: 3,
  form: {
    firstName: 'Juan', middleName: '', lastName: 'Dela Cruz', suffix: '', birthdate: '1958-03-14', sex: 'male',
    managedByFamily: false, managerName: '', managerRelationship: '',
    email: 'juan@example.com', contactNumber: '09171234567',
    barangay: 'Poblacion', city: 'Cotabato City', province: 'Maguindanao del Norte',
  },
}

const renderDraft = async (form = {}, step = 3) => {
  sessionStorage.setItem('mapa_register_draft', JSON.stringify({ ...DRAFT, step, form: { ...DRAFT.form, ...form } }))
  await i18n.changeLanguage('en')
  const { default: Register } = await import('../../src/pages/auth/Register')
  return render(<I18nextProvider i18n={i18n}><MemoryRouter><Register /></MemoryRouter></I18nextProvider>)
}
// A draft saved at step 3 reopens step 2 (passwords are never saved), so the
// patient types the password again and moves on — as a real patient would.
const renderStep3 = async (form = {}) => {
  const r = await renderDraft(form, 3)
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'Abcdefg1' } })
  fireEvent.change(screen.getByLabelText(/^Confirm Password/), { target: { value: 'Abcdefg1' } })
  fireEvent.click(screen.getByRole('button', { name: /^Next/ }))
  await screen.findByLabelText('Patient Access Code (optional)')
  return r
}

describe('Register step 3', () => {
  beforeEach(() => sessionStorage.clear())

  it('starts the code empty, optional, with a real hospital example', async () => {
    await renderStep3()
    const field = screen.getByLabelText('Patient Access Code (optional)')
    expect(field.value).toBe('')
    expect(field.placeholder).toMatch(/^CRMC-\d{4}-00042$/)
    expect(screen.getByText(/Type the whole code from your slip, for example CRMC-/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Enter the 5-digit number after the prefix/)
  })

  it('clears the old pre-filled prefix from an earlier draft', async () => {
    await renderStep3({ hospitalId: `MAPA-${new Date().getFullYear()}-` })
    expect(screen.getByLabelText('Patient Access Code (optional)').value).toBe('')
  })

  it('sends "code already used" to the hospital that issued the code', async () => {
    const { httpsCallable } = await import('../../src/firebase')
    httpsCallable.mockReturnValue(() => Promise.resolve({ data: { exists: true, available: false } }))
    await renderStep3()
    const field = screen.getByLabelText('Patient Access Code (optional)')
    fireEvent.change(field, { target: { value: 'CRMC-2026-00042' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText(/tell the social-services office of Cotabato Regional and Medical Center/)).toBeTruthy()
  })

  it('shows and marks the last name and birthdate in an open review', async () => {
    await renderStep3()
    expect(screen.getByText('Full name')).toBeTruthy()
    expect(screen.getByText('Juan Dela Cruz')).toBeTruthy()
    expect(screen.getByText('March 14, 1958')).toBeTruthy()
    expect(screen.getByText(/can't be changed after you sign up/)).toBeTruthy()
    expect(document.querySelector('details').open).toBe(true)
  })

  it('the Privacy Notice link has its words and opens the notice', async () => {
    await renderStep3()
    const link = screen.getByRole('button', { name: 'Privacy Notice' })
    fireEvent.click(link)
    const checkbox = document.querySelector('main form input[type=checkbox]')
    expect(checkbox.checked).toBe(false)
    // The shared profile dialog has no dialog role (app-wide, separate fix);
    // its heading is the notice's title.
    expect(await screen.findByRole('heading', { level: 2, name: 'Privacy Notice' })).toBeTruthy()
  })

  it('the step circles going back are named for screen readers', async () => {
    await renderStep3()
    expect(screen.getByRole('button', { name: 'Go back to step 1: Personal Info' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Go back to step 2: Account Setup' })).toBeTruthy()
  })
})

describe('Register after a refresh', () => {
  beforeEach(() => sessionStorage.clear())

  it('a draft saved at step 3 reopens step 2 and asks for the password again', async () => {
    await renderDraft({}, 3)
    expect(screen.getByLabelText(/^Password/).value).toBe('')
    expect(screen.getByText(/your password is not saved/)).toBeTruthy()
    expect(screen.queryByLabelText('Patient Access Code (optional)')).toBeNull()
  })
})

describe('sanitizePhone', () => {
  it('keeps pasted numbers whole: spaces, dashes and +63 are cleaned, not cut', async () => {
    const { sanitizePhone } = await import('../../src/pages/auth/Register')
    expect(sanitizePhone('0917 123 4567')).toBe('09171234567')
    expect(sanitizePhone('0917-123-4567')).toBe('09171234567')
    expect(sanitizePhone('+639171234567')).toBe('09171234567')
    expect(sanitizePhone('+63 917 123 4567')).toBe('09171234567')
    expect(sanitizePhone('091712345678999')).toBe('09171234567')
  })
})
