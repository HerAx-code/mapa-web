/**
 * TermsGate — the Terms of Use re-accept gate. Verifies it blocks a patient who
 * hasn't accepted the current TERMS_VERSION, lets them through once accepted,
 * exempts staff, and records {version, timestamp} + local state on accept.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../src/i18n'
import { ROLES, TERMS_VERSION } from '../../src/utils/constants'

const h = vi.hoisted(() => ({
  updateUser: vi.fn(),
  updateDoc:  vi.fn(() => Promise.resolve()),
  state:      { user: { uid: 'u1', role: 'patient', termsVersion: undefined } },
}))

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: h.state.user, updateUser: h.updateUser }),
}))
vi.mock('../../src/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  updateDoc: (...a) => h.updateDoc(...a),
  serverTimestamp: vi.fn(() => 'TS'),
}))

import TermsGate from '../../src/components/TermsGate'

const renderIt = () => render(
  <I18nextProvider i18n={i18n}><TermsGate><div>app content</div></TermsGate></I18nextProvider>
)
const agreeBtn = () => screen.queryByRole('button', { name: /I Agree/i })

describe('TermsGate', () => {
  beforeEach(() => {
    h.updateUser.mockClear()
    h.updateDoc.mockClear()
    h.state.user = { uid: 'u1', role: ROLES.PATIENT, termsVersion: undefined }
  })

  it('blocks a patient who has not accepted the current terms', () => {
    renderIt()
    expect(agreeBtn()).toBeTruthy()
    expect(screen.getByText(/have been updated/i)).toBeTruthy()
  })

  it('does not show for a patient already on the current version', () => {
    h.state.user = { uid: 'u1', role: ROLES.PATIENT, termsVersion: TERMS_VERSION }
    renderIt()
    expect(agreeBtn()).toBeNull()
  })

  it('exempts staff', () => {
    h.state.user = { uid: 's1', role: ROLES.STAFF_ADMIN, termsVersion: undefined }
    renderIt()
    expect(agreeBtn()).toBeNull()
  })

  it('records version + timestamp and updates local state on accept', async () => {
    renderIt()
    fireEvent.click(agreeBtn())
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalledTimes(1))
    expect(h.updateDoc.mock.calls[0][1].termsVersion).toBe(TERMS_VERSION)
    expect(h.updateUser).toHaveBeenCalledWith({ termsVersion: TERMS_VERSION })
  })
})
