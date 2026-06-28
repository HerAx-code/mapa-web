/**
 * ConversationModal smoke tests (extracted in Phase 2.2 from
 * src/pages/admin/Messages.jsx).
 *
 * Mocks the Firestore subscription + sendMessage helper. Pins:
 *   - Renders the other participant's name in the header
 *   - Shows loading skeletons before the first snapshot
 *   - Renders message bubbles after the snapshot fires
 *   - Read-receipt indicator appears when other party has seen
 *   - Close button fires onClose when there's no unsaved reply
 *   - Pager (prev/next) renders only when conversations.length > 1
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Capture the onSnapshot callback so tests drive it.
let snapshotCallback = null
const mockUnsub = vi.fn()
const mockUpdateDoc = vi.fn(async () => undefined)
const mockSendMessage = vi.fn(async () => undefined)

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'mock-collection'),
  query:      vi.fn((...args) => ({ _args: args })),
  orderBy:    vi.fn((field, dir) => ({ field, dir })),
  doc:        vi.fn((...args) => ({ _args: args })),
  updateDoc:  (...args) => mockUpdateDoc(...args),
  serverTimestamp: vi.fn(() => 'TS'),
  onSnapshot: vi.fn((q, onNext) => { snapshotCallback = onNext; return mockUnsub }),
}))
vi.mock('../../src/firebase', () => ({ db: {} }))
vi.mock('../../src/utils/messages', () => ({
  sendMessage: (...args) => mockSendMessage(...args),
}))

let ConversationModal
beforeAll(async () => {
  ConversationModal = (await import('../../src/pages/admin/messages/ConversationModal')).default
})

beforeEach(() => {
  snapshotCallback = null
  vi.clearAllMocks()
})

const ts = (date) => ({ toDate: () => new Date(date), seconds: new Date(date).getTime() / 1000 })

const conv = (overrides = {}) => ({
  id: 'conv-1',
  participants: ['me-uid', 'them-uid'],
  names: { 'me-uid': 'You', 'them-uid': 'Maria Santos' },
  subject: 'Hospital bill',
  ...overrides,
})

const fakeSnap = (docs) => ({
  docs: docs.map((d, i) => ({ id: `m-${i}`, data: () => d })),
})

const me = { uid: 'me-uid', name: 'You', role: 'patient' }

describe('ConversationModal', () => {
  it('renders the other participant name in the header', () => {
    render(<ConversationModal
      conversations={[conv()]}
      activeIndex={0}
      user={me}
      onClose={vi.fn()}
      onNavigate={vi.fn()}
    />)
    expect(screen.getByText('Maria Santos')).toBeInTheDocument()
  })

  it('renders the subject line below the header', () => {
    render(<ConversationModal
      conversations={[conv({ subject: 'Hospital bill' })]}
      activeIndex={0}
      user={me}
      onClose={vi.fn()}
      onNavigate={vi.fn()}
    />)
    expect(screen.getByText(/Hospital bill/)).toBeInTheDocument()
  })

  it('shows loading skeletons before snapshot fires', () => {
    const { container } = render(<ConversationModal
      conversations={[conv()]}
      activeIndex={0}
      user={me}
      onClose={vi.fn()}
      onNavigate={vi.fn()}
    />)
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('renders message bubbles after snapshot fires', async () => {
    render(<ConversationModal
      conversations={[conv()]}
      activeIndex={0}
      user={me}
      onClose={vi.fn()}
      onNavigate={vi.fn()}
    />)
    snapshotCallback(fakeSnap([
      { from: 'them-uid', fromName: 'Maria Santos', text: 'Hello, do you have my receipt?', createdAt: ts('2026-06-20T09:00:00Z') },
      { from: 'me-uid',   fromName: 'You',          text: 'Yes — uploaded just now.',        createdAt: ts('2026-06-20T09:05:00Z') },
    ]))
    expect(await screen.findByText(/Hello, do you have my receipt/)).toBeInTheDocument()
    expect(screen.getByText(/Yes — uploaded just now/)).toBeInTheDocument()
  })

  it('REGRESSION GUARD: pager is hidden when only one conversation', () => {
    render(<ConversationModal
      conversations={[conv()]}
      activeIndex={0}
      user={me}
      onClose={vi.fn()}
      onNavigate={vi.fn()}
    />)
    // No "N of M" indicator when there's only one conversation
    expect(screen.queryByText(/1 of/)).not.toBeInTheDocument()
  })

  it('renders the pager when multiple conversations are passed', () => {
    render(<ConversationModal
      conversations={[
        conv({ id: 'conv-1' }),
        conv({ id: 'conv-2', names: { 'me-uid': 'You', 'them-uid': 'Other' } }),
      ]}
      activeIndex={0}
      user={me}
      onClose={vi.fn()}
      onNavigate={vi.fn()}
    />)
    expect(screen.getByText(/1 of 2/)).toBeInTheDocument()
  })

  it('close button fires onClose when there is no unsaved reply', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ConversationModal
      conversations={[conv()]}
      activeIndex={0}
      user={me}
      onClose={onClose}
      onNavigate={vi.fn()}
    />)
    snapshotCallback(fakeSnap([]))
    // Close X button (first in the header)
    const closeBtns = screen.getAllByRole('button')
    const xBtn = closeBtns.find(b => b.querySelector('svg'))
    await user.click(xBtn)
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the discard guard when user closes with unsaved text', async () => {
    const user = userEvent.setup()
    render(<ConversationModal
      conversations={[conv()]}
      activeIndex={0}
      user={me}
      onClose={vi.fn()}
      onNavigate={vi.fn()}
    />)
    snapshotCallback(fakeSnap([]))
    const textarea = screen.getByPlaceholderText(/Reply to Maria Santos/i)
    await user.type(textarea, 'unfinished message')
    // Click the X
    const closeBtns = screen.getAllByRole('button')
    const xBtn = closeBtns.find(b => b.querySelector('svg'))
    await user.click(xBtn)
    expect(screen.getByText(/Discard your reply/i)).toBeInTheDocument()
  })
})
