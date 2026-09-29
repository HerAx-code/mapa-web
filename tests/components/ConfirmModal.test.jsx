/**
 * ConfirmModal accessibility tests (Phase 5.3 a11y pass).
 *
 * ConfirmModal is the shared confirmation dialog used across every role,
 * including patient flows. These pin the dialog semantics + keyboard behavior
 * added in the a11y pass so a future refactor can't silently drop them:
 *   - role="dialog" + aria-modal + aria-labelledby wired to the title
 *   - initial focus moves into the dialog (the safe Cancel action by default)
 *   - Escape closes it
 *
 * (Tab-wrap trapping is a real-browser behavior — jsdom has no layout so
 * offsetParent-based visibility can't be exercised here; it's verified live.)
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfirmModal from '../../src/components/ConfirmModal'

const baseProps = {
  open: true,
  onClose: () => {},
  onConfirm: async () => {},
  title: 'Delete this request?',
  body: 'This cannot be undone.',
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
}

describe('ConfirmModal a11y', () => {
  it('renders a labelled modal dialog', () => {
    render(<ConfirmModal {...baseProps} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // aria-labelledby points at the visible title
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy)).toHaveTextContent('Delete this request?')
  })

  it('moves initial focus to the safe Cancel action', () => {
    render(<ConfirmModal {...baseProps} />)
    // Two controls are named "Cancel" (icon-only X + footer button); initial
    // focus lands on the footer button, the only one with visible text.
    const focused = document.activeElement
    expect(focused?.tagName).toBe('BUTTON')
    expect(focused).toHaveTextContent('Cancel')
  })

  it('focuses the reason textarea when a reason is required', () => {
    render(<ConfirmModal {...baseProps} withReason reasonRequired />)
    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<ConfirmModal {...baseProps} onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('gives the header close button an accessible name', () => {
    render(<ConfirmModal {...baseProps} />)
    // Two controls share the "Cancel" name (X + footer) — both must be labelled.
    const closers = screen.getAllByRole('button', { name: 'Cancel' })
    expect(closers.length).toBeGreaterThanOrEqual(2)
  })
})
