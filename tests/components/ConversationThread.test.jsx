/**
 * ConversationThread smoke tests (Phase 2.2 extraction).
 *
 * Inline two-pane variant of the conversation view. Same Firestore
 * snapshot pattern as ConversationModal but renders inline (no
 * full-screen wrapper, no pager, no discard-guard). Tests pin the
 * shared behaviors that the parent admin page depends on.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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
  onSnapshot: vi.fn((q, onNext, onError) => {
    snapshotCallback = onNext
    return mockUnsub
  }),
}))
vi.mock('../../src/firebase', () => ({ db: {} }))
vi.mock('../../src/utils/messages', () => ({
  sendMessage: (...args) => mockSendMessage(...args),
}))

let ConversationThread
beforeAll(async () => {
  ConversationThread = (await import('../../src/pages/admin/messages/ConversationThread')).default
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

const me = { uid: 'me-uid', name: 'You', role: 'admin' }
const fakeSnap = (docs) => ({ docs: docs.map((d, i) => ({ id: `m-${i}`, data: () => d })) })

describe('ConversationThread', () => {
  it('renders the other-participant name in the thread header', () => {
    render(<ConversationThread
      conversation={conv()}
      user={me}
      text=""
      setText={vi.fn()}
    />)
    expect(screen.getByText('Maria Santos')).toBeInTheDocument()
  })

  it('shows loading skeletons before snapshot fires', () => {
    const { container } = render(<ConversationThread
      conversation={conv()}
      user={me}
      text=""
      setText={vi.fn()}
    />)
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('renders message bubbles after snapshot fires', async () => {
    render(<ConversationThread
      conversation={conv()}
      user={me}
      text=""
      setText={vi.fn()}
    />)
    snapshotCallback(fakeSnap([
      { from: 'them-uid', fromName: 'Maria Santos', text: 'First message', createdAt: ts('2026-06-20T09:00:00Z') },
      { from: 'me-uid',   fromName: 'You',          text: 'Reply',         createdAt: ts('2026-06-20T09:05:00Z') },
    ]))
    expect(await screen.findByText('First message')).toBeInTheDocument()
    expect(screen.getByText('Reply')).toBeInTheDocument()
  })

  it('shows empty state when snapshot returns zero messages', async () => {
    render(<ConversationThread
      conversation={conv()}
      user={me}
      text=""
      setText={vi.fn()}
    />)
    snapshotCallback(fakeSnap([]))
    expect(await screen.findByText(/No messages yet/i)).toBeInTheDocument()
  })

  it('setText is called with the input value as user types', async () => {
    const user = userEvent.setup()
    const setText = vi.fn()
    render(<ConversationThread
      conversation={conv()}
      user={me}
      text=""
      setText={setText}
    />)
    snapshotCallback(fakeSnap([]))
    const textarea = screen.getByPlaceholderText(/Reply to Maria Santos/i)
    await user.type(textarea, 'h')
    expect(setText).toHaveBeenCalledWith('h')
  })

  it('REGRESSION GUARD: calls sendMessage with the conversation id when send is clicked', async () => {
    const user = userEvent.setup()
    render(<ConversationThread
      conversation={conv()}
      user={me}
      text="Test reply"
      setText={vi.fn()}
    />)
    snapshotCallback(fakeSnap([]))
    // Find the send button (the one with the MdSend icon -- it's the only
    // button in the reply box footer)
    const buttons = screen.getAllByRole('button')
    const sendBtn = buttons.find(b => !b.disabled && b.querySelector('svg'))
    await user.click(sendBtn)
    expect(mockSendMessage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      from:     'me-uid',
      text:     'Test reply',
      toUid:    'them-uid',
    }))
  })
})
