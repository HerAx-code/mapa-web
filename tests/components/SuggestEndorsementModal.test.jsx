/**
 * SuggestEndorsementModal smoke tests (R36 — Bonterra warm-handoff).
 *
 * Mocks the two Firestore writes the modal makes:
 *   - getDocs of /agencies to populate the picker (filtered to
 *     non-sibling agencies)
 *   - addDoc to /referralSuggestions on submit
 *
 * Pins behaviors that, if regressed, would silently break the
 * cross-agency suggestion flow (one of the harder-to-manually-test
 * features because it requires switching between two agency accounts).
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ── Mocks ──────────────────────────────────────────────────────────────

const mockAddDoc = vi.fn(async () => ({ id: 'new-suggestion' }))
const mockGetDocs = vi.fn(async () => ({
  docs: [
    { id: 'malasakit', data: () => ({ name: 'Malasakit Center', enabled: true }) },
    { id: 'pcso',      data: () => ({ name: 'PCSO',             enabled: true }) },
    { id: 'dswd',      data: () => ({ name: 'DSWD AICS',        enabled: true }) },
    { id: 'old-org',   data: () => ({ name: 'Disabled Org',     enabled: false }) },
  ],
}))

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'mock-collection'),
  addDoc:     (...args) => mockAddDoc(...args),
  getDocs:    (...args) => mockGetDocs(...args),
  query:      vi.fn((...args) => ({ _args: args })),
  orderBy:    vi.fn((field, dir) => ({ field, dir })),
  serverTimestamp: vi.fn(() => 'mock-server-timestamp'),
}))

vi.mock('../../src/firebase', () => ({ db: {} }))

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'coord-malasakit', name: 'Maria Santos', agencyId: 'malasakit' } }),
}))

// Silence the toast UI -- we don't have react-hot-toast's Toaster mounted.
const mockToast = { success: vi.fn(), error: vi.fn() }
vi.mock('react-hot-toast', () => ({ default: mockToast, ...mockToast }))

let SuggestEndorsementModal
beforeAll(async () => {
  SuggestEndorsementModal = (await import('../../src/components/agency/SuggestEndorsementModal')).default
})

beforeEach(() => {
  vi.clearAllMocks()
})

const defaultProps = {
  app: { id: 'app-1', appId: 'APP-001', requestId: 'req-1', patientName: 'Baher Blah' },
  request: { amountNeeded: 25000 },
  siblings: [{ agencyId: 'malasakit' }],  // own agency already on the case
  onClose: vi.fn(),
}

// The agency picker is now a SearchableSelect combobox: a trigger button
// whose label is the placeholder ("Loading…" then "Pick an agency" once the
// fetch resolves), which opens a listbox of options. findByRole on the
// loaded label doubles as the load-settled wait that this suite needs
// (it flaked in CI when it asserted before the getDocs promise resolved).
const agencyTriggerLoaded = () =>
  screen.findByRole('button', { name: /pick an agency/i })

// Open the agency picker and return the option labels it renders.
async function openAgencyOptions(user) {
  await user.click(await agencyTriggerLoaded())
  return screen.getAllByRole('option').map(o => o.textContent)
}

// Open the picker and click one agency option by its visible name.
async function pickAgency(user, name) {
  await user.click(await agencyTriggerLoaded())
  await user.click(screen.getByRole('option', { name }))
}

describe('SuggestEndorsementModal', () => {
  it('renders header with patient name and app ID', async () => {
    render(<SuggestEndorsementModal {...defaultProps} />)
    expect(screen.getByText(/Suggest another agency/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/Baher Blah/)).toBeInTheDocument())
  })

  it('REGRESSION GUARD: excludes own agency (sibling) from the picker', async () => {
    const user = userEvent.setup()
    render(<SuggestEndorsementModal {...defaultProps} />)
    const optionText = await openAgencyOptions(user)
    // Malasakit (own) should not appear
    expect(optionText).not.toContain('Malasakit Center')
    // PCSO and DSWD AICS should appear
    expect(optionText).toContain('PCSO')
    expect(optionText).toContain('DSWD AICS')
  })

  it('REGRESSION GUARD: excludes disabled agencies from the picker', async () => {
    const user = userEvent.setup()
    render(<SuggestEndorsementModal {...defaultProps} />)
    const optionText = await openAgencyOptions(user)
    expect(optionText).not.toContain('Disabled Org')
  })

  it('disables Send until both agency picked AND reason >= 10 chars', async () => {
    const user = userEvent.setup()
    render(<SuggestEndorsementModal {...defaultProps} />)
    await agencyTriggerLoaded()

    const sendBtn = screen.getByRole('button', { name: /Send suggestion/i })
    expect(sendBtn).toBeDisabled()

    // Pick agency only
    await pickAgency(user, 'PCSO')
    expect(sendBtn).toBeDisabled()  // still disabled, no reason yet

    // Type 5 chars — still below 10
    const textarea = screen.getByPlaceholderText(/Patient mentions/i)
    await user.type(textarea, 'short')
    expect(sendBtn).toBeDisabled()

    // Type past 10 chars
    await user.type(textarea, ' justifies')
    expect(sendBtn).not.toBeDisabled()
  })

  it('REGRESSION GUARD: addDoc payload self-attributes via fromAgencyId/fromUserId', async () => {
    const user = userEvent.setup()
    render(<SuggestEndorsementModal {...defaultProps} />)
    await agencyTriggerLoaded()

    await pickAgency(user, 'PCSO')
    await user.type(
      screen.getByPlaceholderText(/Patient mentions/i),
      'Patient eligible under PCSO MAP scope',
    )
    await user.click(screen.getByRole('button', { name: /Send suggestion/i }))

    await waitFor(() => expect(mockAddDoc).toHaveBeenCalled())
    const [, payload] = mockAddDoc.mock.calls[0]
    expect(payload).toMatchObject({
      fromAgencyId: 'malasakit',
      fromUserId:   'coord-malasakit',
      toAgencyId:   'pcso',
      toAgencyName: 'PCSO',
      requestId:    'req-1',
      patientName:  'Baher Blah',
      status:       'pending',
      urgency:      'medium',  // default selection
    })
  })

  it('renders "no eligible agencies" hint when all agencies are siblings', async () => {
    render(<SuggestEndorsementModal
      {...defaultProps}
      siblings={[
        { agencyId: 'malasakit' },
        { agencyId: 'pcso' },
        { agencyId: 'dswd' },
      ]}
    />)
    // NOT waitForAgencyPicker() here: every agency is a sibling, so the
    // picker is never populated and waiting for 'PCSO' would time out.
    // findByText already retries until the load settles.
    expect(await screen.findByText(/All eligible agencies are already on this case/i))
      .toBeInTheDocument()
  })
})
