/**
 * Compose-modal smoke tests for both PatientComposeModal +
 * AdminComposeModal (Phase 2.2 extractions).
 *
 * Mocks the recipient-list query + the create-conversation + send-
 * message helpers. Pins the routing decisions (who gets to message
 * whom) and the bug-fix-bundled-in for AdminComposeModal (the
 * `conv.id` vs `convId` issue documented in commit d183535).
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockGetDocs = vi.fn()
const mockGetOrCreateConversation = vi.fn(async () => 'new-conv-id')
const mockSendMessage = vi.fn(async () => undefined)

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'mock-collection'),
  query:      vi.fn((...args) => ({ _args: args })),
  where:      vi.fn((f, op, v) => ({ f, op, v })),
  getDocs:    (...args) => mockGetDocs(...args),
}))
vi.mock('../../src/firebase', () => ({ db: {} }))
vi.mock('../../src/utils/messages', () => ({
  getOrCreateConversation: (...args) => mockGetOrCreateConversation(...args),
  sendMessage: (...args) => mockSendMessage(...args),
}))

const mockToast = { success: vi.fn(), error: vi.fn() }
vi.mock('react-hot-toast', () => ({ default: mockToast, ...mockToast }))

let PatientComposeModal, AdminComposeModal
beforeAll(async () => {
  PatientComposeModal = (await import('../../src/pages/admin/messages/PatientComposeModal')).default
  AdminComposeModal   = (await import('../../src/pages/admin/messages/AdminComposeModal')).default
})

beforeEach(() => {
  vi.clearAllMocks()
})

const patientUser = { uid: 'patient-uid', name: 'Maria Santos', role: 'patient' }
const adminUser   = { uid: 'admin-uid', name: 'Admin', role: 'super_admin' }

// ── PatientComposeModal ────────────────────────────────────────────────

describe('PatientComposeModal', () => {
  it('shows loading state while recipients are loading', () => {
    // Don't resolve the recipients query yet
    mockGetDocs.mockImplementation(() => new Promise(() => {}))
    render(<PatientComposeModal user={patientUser} onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByText(/Loading recipients/i)).toBeInTheDocument()
  })

  it('shows error state when recipients query fails', async () => {
    // First call (patient's applications) succeeds with empty
    mockGetDocs.mockImplementationOnce(async () => ({ docs: [] }))
    // Second call (recipients) fails
    mockGetDocs.mockImplementationOnce(async () => { throw new Error('permission-denied') })
    const errSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<PatientComposeModal user={patientUser} onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(await screen.findByText(/Can't load recipients/i)).toBeInTheDocument()
    errSpy.mockRestore()
  })

  it('REGRESSION GUARD: only shows agencies the patient has an application with', async () => {
    // First call: patient's applications -- has slice with malasakit
    mockGetDocs.mockImplementationOnce(async () => ({
      docs: [{ data: () => ({ agencyId: 'malasakit' }) }],
    }))
    // Second call: all eligible recipients
    mockGetDocs.mockImplementationOnce(async () => ({
      docs: [
        { id: 'admin-1',  data: () => ({ name: 'CRMC Admin',     role: 'super_admin' }) },
        { id: 'coord-mal', data: () => ({ name: 'Mal Coord',     role: 'agency', agencyId: 'malasakit' }) },
        { id: 'coord-pcso', data: () => ({ name: 'PCSO Coord',   role: 'agency', agencyId: 'pcso' }) },
      ],
    }))
    render(<PatientComposeModal user={patientUser} onClose={vi.fn()} onCreated={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('CRMC Admin')).toBeInTheDocument())
    expect(screen.getByText('Mal Coord')).toBeInTheDocument()
    // PCSO must NOT appear — patient has no application there
    expect(screen.queryByText('PCSO Coord')).not.toBeInTheDocument()
  })

  it('REGRESSION GUARD: getOrCreateConversation receives string id, calls sendMessage with same id', async () => {
    // Earlier session fixed the bug where this site treated the
    // return value as { id } instead of the bare string. Pin it.
    mockGetDocs.mockImplementationOnce(async () => ({
      docs: [{ data: () => ({ agencyId: 'malasakit' }) }],
    }))
    mockGetDocs.mockImplementationOnce(async () => ({
      docs: [{ id: 'admin-1', data: () => ({ name: 'CRMC Admin', role: 'super_admin' }) }],
    }))
    const onCreated = vi.fn()
    const user = userEvent.setup()
    render(<PatientComposeModal user={patientUser} onClose={vi.fn()} onCreated={onCreated} />)
    await waitFor(() => expect(screen.getByText('CRMC Admin')).toBeInTheDocument())

    // Pick a recipient (click the row)
    await user.click(screen.getByText('CRMC Admin'))

    // Type a message
    const textarea = screen.getByPlaceholderText(/Write your message/i)
    await user.type(textarea, 'Hello CRMC')

    // Send
    await user.click(screen.getByRole('button', { name: /Send/i }))

    await waitFor(() => expect(mockSendMessage).toHaveBeenCalled())
    // sendMessage gets the string id, and onCreated also gets the string id
    expect(mockSendMessage.mock.calls[0][0]).toBe('new-conv-id')
    expect(onCreated).toHaveBeenCalledWith('new-conv-id')
  })
})

// ── AdminComposeModal ─────────────────────────────────────────────────

describe('AdminComposeModal', () => {
  it('loads the full user list (excluding self)', async () => {
    mockGetDocs.mockImplementationOnce(async () => ({
      docs: [
        { id: 'admin-uid', data: () => ({ name: 'Admin Self', role: 'super_admin' }) },  // self
        { id: 'p-1',       data: () => ({ name: 'Patient One', role: 'patient' }) },
        { id: 'c-1',       data: () => ({ name: 'Coord One',   role: 'agency' }) },
      ],
    }))
    const user = userEvent.setup()
    render(<AdminComposeModal user={adminUser} onClose={vi.fn()} onCreated={vi.fn()} />)
    const search = await screen.findByPlaceholderText(/Search by name or email/i)
    await user.type(search, 'one')
    // Two matches; self is excluded
    expect(await screen.findByText('Patient One')).toBeInTheDocument()
    expect(screen.getByText('Coord One')).toBeInTheDocument()
    expect(screen.queryByText('Admin Self')).not.toBeInTheDocument()
  })

  it('REGRESSION GUARD: onCreated fires with the STRING convId (not undefined)', async () => {
    // Bug fixed in d183535: previously did onCreated(conv.id) but
    // getOrCreateConversation returns a string, so the call was
    // onCreated(undefined). The auto-switch-to-new-thread flow
    // silently broke.
    mockGetDocs.mockImplementationOnce(async () => ({
      docs: [{ id: 'p-1', data: () => ({ name: 'Patient One', role: 'patient' }) }],
    }))
    mockGetOrCreateConversation.mockResolvedValue('returned-string-id')
    const onCreated = vi.fn()
    const user = userEvent.setup()
    render(<AdminComposeModal user={adminUser} onClose={vi.fn()} onCreated={onCreated} />)

    // Search and pick a recipient
    const search = await screen.findByPlaceholderText(/Search by name or email/i)
    await user.type(search, 'Patient')
    await user.click(await screen.findByText('Patient One'))

    // Type message
    const textarea = screen.getByPlaceholderText(/Write your message/i)
    await user.type(textarea, 'Important admin message')

    // Send
    await user.click(screen.getByRole('button', { name: /Send Message/i }))

    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(onCreated).toHaveBeenCalledWith('returned-string-id')  // NOT undefined
  })
})
