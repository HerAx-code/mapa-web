/**
 * Compose-modal smoke tests for AdminComposeModal (Phase 2.2 extraction).
 * (PatientComposeModal was removed in the reply-only messaging change.)
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

let AdminComposeModal
beforeAll(async () => {
  AdminComposeModal   = (await import('../../src/pages/admin/messages/AdminComposeModal')).default
})

beforeEach(() => {
  vi.clearAllMocks()
})

const adminUser   = { uid: 'admin-uid', name: 'Admin', role: 'super_admin' }

// PatientComposeModal was removed in the reply-only messaging change (abuse
// hardening #2) — patients can no longer start conversations, so there is no
// patient compose modal to test.

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
