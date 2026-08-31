/**
 * CommandPalette — the ⌘K admin quick-jump. Verifies the toggle, filtering,
 * keyboard selection, and close behaviour without needing an admin session.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MdSearch } from 'react-icons/md'
import CommandPalette from '../../src/components/admin/CommandPalette'

const renderPalette = (overrides = {}) => {
  const onDash  = vi.fn()
  const onAudit = vi.fn()
  const items = [
    { key: '/dash',  label: 'Dashboard', icon: MdSearch, section: 'System admin', action: onDash },
    { key: '/audit', label: 'Audit Log', icon: MdSearch, section: 'Operations',   action: onAudit },
    ...(overrides.items ?? []),
  ]
  render(<MemoryRouter><CommandPalette items={items} /></MemoryRouter>)
  return { onDash, onAudit }
}

const openPalette = () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
const PLACEHOLDER = 'Jump to a page…'

describe('CommandPalette', () => {
  it('is closed until Ctrl/Cmd-K, then opens', () => {
    renderPalette()
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull()
    openPalette()
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeInTheDocument()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('filters items by the query', () => {
    renderPalette()
    openPalette()
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'audit' } })
    expect(screen.getByText('Audit Log')).toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).toBeNull()
  })

  it('runs the highlighted item on Enter', () => {
    const { onAudit } = renderPalette()
    openPalette()
    const input = screen.getByPlaceholderText(PLACEHOLDER)
    fireEvent.change(input, { target: { value: 'audit' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onAudit).toHaveBeenCalledTimes(1)
    // Selecting closes the palette.
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull()
  })

  it('runs an item on click', () => {
    const { onDash } = renderPalette()
    openPalette()
    fireEvent.click(screen.getByText('Dashboard'))
    expect(onDash).toHaveBeenCalledTimes(1)
  })

  it('shows an empty state and closes on Escape', () => {
    renderPalette()
    openPalette()
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'zzzznope' } })
    expect(screen.getByText(/No matches/)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull()
  })
})
