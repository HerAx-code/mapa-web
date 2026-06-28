import { useState, useEffect } from 'react'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../../../firebase'
import { sendMessage, getOrCreateConversation } from '../../../utils/messages'
import { MdClose, MdSend } from 'react-icons/md'
import toast from 'react-hot-toast'
import { MAX_CHARS } from './helpers'

const ROLE_LABEL = { patient: 'Patient', staff_admin: 'Staff Admin', super_admin: 'Super Admin', agency: 'Agency' }

/**
 * Admin-side compose panel — search any user, pick one, send the first
 * message of a new conversation. Renders as an inline panel (not a
 * modal) inside the admin Messages two-pane layout. Extracted from
 * src/pages/admin/Messages.jsx as part of the Phase 2.2 split.
 *
 * Bug fix bundled in: the original code at line 629 of the source
 * called `onCreated(conv.id)` but getOrCreateConversation returns a
 * STRING id (see src/utils/messages.js:26), so `conv.id` was always
 * undefined and onCreated fired with undefined -- the parent's
 * navigation-to-new-conversation flow silently broke. The patient
 * compose modal had the same bug; documented + fixed there earlier.
 * Now corrected here too.
 */
export default function AdminComposeModal({ user, onClose, onCreated }) {
  const [allUsers,        setAllUsers]        = useState([])
  const [recipientSearch, setRecipientSearch] = useState('')
  const [selectedName,    setSelectedName]    = useState('')
  const [showDropdown,    setShowDropdown]    = useState(false)
  const [toUid,           setToUid]           = useState('')
  const [subject,         setSubject]         = useState('')
  const [text,            setText]            = useState('')
  const [sending,         setSending]         = useState(false)
  const [confirmClose,    setConfirmClose]    = useState(false)

  const hasUnsaved = !!text.trim() || !!subject.trim()
  const charsLeft  = MAX_CHARS - text.length
  const handleClose = () => hasUnsaved ? setConfirmClose(true) : onClose()

  useEffect(() => {
    getDocs(query(collection(db, 'users'),
      where('role', 'in', ['patient', 'staff_admin', 'super_admin', 'agency'])
    )).then(snap => {
      setAllUsers(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(u => u.id !== user.uid)
          .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
      )
    })
  }, [])

  const filteredUsers = allUsers.filter(u =>
    !recipientSearch ||
    u.name?.toLowerCase().includes(recipientSearch.toLowerCase()) ||
    u.email?.toLowerCase().includes(recipientSearch.toLowerCase())
  )

  const selectRecipient = (u) => {
    setToUid(u.id)
    setSelectedName(`${u.name} — ${ROLE_LABEL[u.role] ?? u.role}`)
    setRecipientSearch('')
    setShowDropdown(false)
  }

  const clearRecipient = () => {
    setToUid('')
    setSelectedName('')
    setRecipientSearch('')
  }

  const handleSend = async () => {
    if (!toUid || !text.trim()) return
    setSending(true)
    try {
      const to = allUsers.find(u => u.id === toUid)
      // Bug fix: getOrCreateConversation returns a STRING id (not an
      // object). Previously this site did `conv.id` and `onCreated(conv.id)`
      // which fired undefined into the parent's "switch to new conversation"
      // flow. Now correctly consumes the string.
      const convId = await getOrCreateConversation(user.uid, toUid, {
        subject: subject.trim() || 'General Inquiry',
        names: { [user.uid]: user.name ?? 'Admin', [toUid]: to?.name ?? 'User' },
        roles: { [user.uid]: user.role, [toUid]: to?.role ?? 'patient' },
      })
      await sendMessage(convId, { from: user.uid, fromName: user.name, text: text.trim(), toUid })
      onCreated(convId)
    } catch {
      toast.error('Failed to send message. Please try again.')
    } finally { setSending(false) }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-white">

      {/* Panel header */}
      <div className="px-5 py-3.5 border-b border-gray-100 flex-shrink-0 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">New Message</p>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <MdClose size={18} />
        </button>
      </div>

      {/* Form body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* To */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">To <span className="text-red-400">*</span></label>
          <div className="relative">
            {toUid ? (
              <div className="input flex items-center justify-between gap-2 py-2">
                <span className="text-sm text-gray-800 truncate">{selectedName}</span>
                <button type="button" onClick={clearRecipient}
                  className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                  <MdClose size={16} />
                </button>
              </div>
            ) : (
              <>
                <input
                  className="input text-sm"
                  placeholder="Search by name or email..."
                  value={recipientSearch}
                  onChange={e => { setRecipientSearch(e.target.value); setShowDropdown(true) }}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                />
                {showDropdown && recipientSearch && (
                  <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {filteredUsers.length > 0 ? (
                      filteredUsers.map(u => (
                        <button key={u.id} type="button"
                          className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                          onMouseDown={() => selectRecipient(u)}>
                          <p className="text-sm text-gray-800">{u.name}</p>
                          <p className="text-xs text-gray-400">{ROLE_LABEL[u.role] ?? u.role}</p>
                        </button>
                      ))
                    ) : (
                      <p className="px-4 py-3 text-sm text-gray-400">No users match "{recipientSearch}".</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Subject */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
          <input className="input text-sm" placeholder="What is this about? (optional)"
            value={subject} onChange={e => setSubject(e.target.value)} />
        </div>

        {/* Message */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Message <span className="text-red-400">*</span>
          </label>
          <textarea className="input text-sm resize-none" rows={6}
            placeholder="Write your message..."
            value={text} onChange={e => setText(e.target.value)} maxLength={MAX_CHARS} />
          {text.length > MAX_CHARS * 0.8 && (
            <p className={`text-xs mt-1 text-right ${charsLeft < 50 ? 'text-red-500' : 'text-gray-400'}`}>
              {charsLeft} characters remaining
            </p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-gray-100 flex-shrink-0 flex gap-2 justify-end bg-white">
        <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
        <button className="btn-primary text-sm flex items-center gap-1.5"
          onClick={handleSend} disabled={sending || !toUid || !text.trim()}>
          <MdSend size={14} /> {sending ? 'Sending...' : 'Send Message'}
        </button>
      </div>
    </div>
  )
}
