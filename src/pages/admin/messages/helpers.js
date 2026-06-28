/**
 * Date formatting helpers extracted from src/pages/admin/Messages.jsx
 * as part of the Phase 2.2 split. Used by ConversationModal,
 * ConversationThread, PatientComposeModal, AdminComposeModal, and the
 * Messages page itself for inbox + bubble timestamps + date separators.
 *
 * - fmtDate(ts)      "9:32 AM" today, "Mar 5" otherwise -- inbox preview
 * - fmtFull(ts)      "Mar 5, 9:32 AM" -- bubble timestamps
 * - fmtDateLabel(ts) "Today" / "Yesterday" / "March 5" -- thread separators
 */

import { tsToDate } from '../../../utils/dates'

export const MAX_CHARS = 1000

export const fmtDate = (ts) => {
  const d = tsToDate(ts)
  if (!d) return '—'
  const now = new Date()
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export const fmtFull = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

export const fmtDateLabel = (ts) => {
  const d = tsToDate(ts)
  if (!d) return ''
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === now.toDateString())        return 'Today'
  if (d.toDateString() === yesterday.toDateString())  return 'Yesterday'
  return d.toLocaleDateString([], {
    month: 'long', day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  })
}
