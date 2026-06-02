import { useState, useEffect, useRef, Fragment } from 'react'
import Layout from '../../components/Layout'
import {
  collection, query, where, orderBy, onSnapshot,
  doc, updateDoc, deleteDoc, serverTimestamp, getDocs, writeBatch,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { sendMessage, getOrCreateConversation } from '../../utils/messages'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { tsToDate } from '../../utils/dates'
import {
  MdSearch, MdCheckCircle, MdDelete, MdDone, MdSend,
  MdClose, MdMessage, MdChevronLeft, MdChevronRight, MdAdd,
} from 'react-icons/md'

const MAX_CHARS = 1000

const fmtDate = (ts) => {
  const d = tsToDate(ts)
  if (!d) return '—'
  const now = new Date()
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const fmtFull = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

const fmtDateLabel = (ts) => {
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

// ── Conversation Modal (patient view) ─────────────────────────────────────

function ConversationModal({ conversations, activeIndex, user, onClose, onNavigate }) {
  const conv      = conversations[activeIndex]
  const [messages, setMessages]     = useState([])
  const [loadingMsgs, setLoadingMsgs] = useState(true)
  const [text, setText]             = useState('')
  const [sending, setSending]       = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [pendingNav, setPendingNav] = useState(null)
  const bottomRef                   = useRef(null)

  const hasUnsaved = !!text.trim()
  const handleClose = () => hasUnsaved ? setConfirmClose(true) : onClose()
  const handleNavigate = (idx) => {
    if (hasUnsaved) { setPendingNav(idx); setConfirmClose(true) }
    else onNavigate(idx)
  }
  const confirmDiscard = () => {
    setText('')
    setConfirmClose(false)
    if (pendingNav !== null) { onNavigate(pendingNav); setPendingNav(null) }
    else onClose()
  }

  const oUid  = conv?.participants?.find(p => p !== user.uid)
  const oName = conv?.names?.[oUid] ?? 'Unknown'

  useEffect(() => {
    if (!conv?.id) return
    setText('')
    setLoadingMsgs(true)
    const q = query(collection(db, 'conversations', conv.id, 'messages'), orderBy('createdAt', 'asc'))
    const unsub = onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoadingMsgs(false)
    }, (err) => {
      setLoadingMsgs(false)
      console.error('[Messages] thread snapshot error:', err)
    })
    updateDoc(doc(db, 'conversations', conv.id), {
      [`unread.${user.uid}`]:  0,
      [`seenBy.${user.uid}`]: serverTimestamp(),
    }).catch(() => {})
    return unsub
  }, [conv?.id])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  if (!conv) return null

  const handleSend = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    await sendMessage(conv.id, { from: user.uid, fromName: user.name, text: text.trim(), toUid: oUid })
    setText('')
    setSending(false)
  }

  const lastMsg   = messages[messages.length - 1]
  const otherSeen = conv.seenBy?.[oUid]
  const showSeen  = lastMsg?.from === user.uid && otherSeen &&
    (otherSeen.seconds ?? 0) >= (lastMsg?.createdAt?.seconds ?? 0)
  const charsLeft = MAX_CHARS - text.length
  const hasPrev   = activeIndex > 0
  const hasNext   = activeIndex < conversations.length - 1

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[85vh] relative">

        {confirmClose && (
          <div className="absolute inset-0 bg-white/90 z-10 flex items-center justify-center rounded-2xl p-6">
            <div className="text-center space-y-3">
              <p className="text-sm font-semibold text-gray-800">Discard your reply?</p>
              <p className="text-xs text-gray-500">
                You have an unsaved reply. If you {pendingNav !== null ? 'navigate away' : 'close'}, it will be lost.
              </p>
              <div className="flex gap-2 justify-center pt-1">
                <button className="btn-secondary text-sm" onClick={() => { setConfirmClose(false); setPendingNav(null) }}>
                  Keep writing
                </button>
                <button className="btn-danger text-sm" onClick={confirmDiscard}>Discard</button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">{oName}</h2>
            {conv.subject && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">
                <span className="font-medium">Subject:</span> {conv.subject}
              </p>
            )}
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0 ml-3 mt-0.5">
            <MdClose size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loadingMsgs && (
            <div className="space-y-4 animate-pulse">
              <div className="flex flex-col items-start gap-1">
                <div className="h-2.5 bg-gray-100 rounded w-20" />
                <div className="h-9 bg-gray-100 rounded-2xl w-48" />
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="h-2.5 bg-gray-100 rounded w-16" />
                <div className="h-9 bg-gray-100 rounded-2xl w-40" />
              </div>
            </div>
          )}
          {!loadingMsgs && messages.length === 0 && (
            <div className="flex flex-col items-center py-10 gap-3 text-center">
              <div className="w-12 h-12 bg-brand-50 rounded-full flex items-center justify-center">
                <MdMessage size={22} className="text-brand-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">No messages yet</p>
                <p className="text-xs text-gray-400 mt-0.5">Send the first message to start the conversation with {oName}.</p>
              </div>
              {conv.subject && (
                <span className="text-xs text-brand-500 bg-brand-50 px-3 py-1 rounded-full font-medium">
                  📎 {conv.subject}
                </span>
              )}
            </div>
          )}
          {!loadingMsgs && messages.map((m, idx) => {
            const isMe      = m.from === user.uid
            const dateLabel = fmtDateLabel(m.createdAt)
            const prevLabel = idx > 0 ? fmtDateLabel(messages[idx - 1].createdAt) : null
            const showSep   = dateLabel && dateLabel !== prevLabel
            return (
              <Fragment key={m.id}>
                {showSep && (
                  <div className="flex items-center gap-3 my-1">
                    <div className="flex-1 h-px bg-gray-100" />
                    <span className="text-xs text-gray-400 font-medium px-1">{dateLabel}</span>
                    <div className="flex-1 h-px bg-gray-100" />
                  </div>
                )}
                <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  <p className="text-xs text-gray-400 mb-0.5">
                    {isMe ? 'You' : m.fromName} · {fmtFull(m.createdAt)}
                  </p>
                  <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed
                    ${isMe ? 'bg-brand-500 text-white rounded-br-sm' : 'bg-gray-100 text-gray-800 rounded-bl-sm'}`}>
                    {m.text}
                  </div>
                </div>
              </Fragment>
            )
          })}
          {!loadingMsgs && showSeen && (
            <p className="text-xs text-gray-400 text-right">Seen by {oName}</p>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="px-4 py-3 border-t border-gray-100 flex-shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              className="input flex-1 text-sm resize-none min-h-[38px] max-h-[120px] leading-relaxed"
              placeholder={`Reply to ${oName}...`}
              value={text}
              maxLength={MAX_CHARS}
              rows={1}
              onChange={e => {
                setText(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
              }}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
            />
            <button
              className="w-11 h-11 bg-brand-500 text-white rounded-xl flex items-center justify-center hover:bg-brand-600 disabled:opacity-40 transition-colors flex-shrink-0"
              onClick={handleSend} disabled={sending || !text.trim()}>
              <MdSend size={18} />
            </button>
          </div>
          {text.length > MAX_CHARS * 0.8 && (
            <p className={`text-xs mt-1 text-right ${charsLeft < 50 ? 'text-red-500' : 'text-gray-400'}`}>
              {charsLeft} characters remaining
            </p>
          )}
        </div>

        {conversations.length > 1 && (
          <div className="px-5 py-2.5 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <button disabled={!hasPrev} onClick={() => handleNavigate(activeIndex - 1)}
                className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                <MdChevronLeft size={18} />
              </button>
              <span className="text-xs text-gray-400">{activeIndex + 1} of {conversations.length}</span>
              <button disabled={!hasNext} onClick={() => handleNavigate(activeIndex + 1)}
                className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                <MdChevronRight size={18} />
              </button>
            </div>
            <button onClick={handleClose} className="text-xs text-gray-400 hover:text-gray-600 font-medium">Close</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Patient Compose Modal ─────────────────────────────────────────────────

function PatientComposeModal({ user, onClose, onCreated }) {
  const [recipients,    setRecipients]    = useState([])
  const [patientAgencyIds, setPatientAgencyIds] = useState(new Set())
  const [toUid,         setToUid]         = useState('')
  const [subject,       setSubject]       = useState('')
  const [text,          setText]          = useState('')
  const [sending,       setSending]       = useState(false)
  const [confirmClose,  setConfirmClose]  = useState(false)

  const hasUnsaved = !!text.trim()
  const charsLeft  = MAX_CHARS - text.length
  const handleClose = () => hasUnsaved ? setConfirmClose(true) : onClose()

  useEffect(() => {
    if (!user?.uid) return
    getDocs(query(collection(db, 'applications'), where('patientId', '==', user.uid)))
      .then(snap => {
        setPatientAgencyIds(new Set(snap.docs.map(d => d.data().agencyId).filter(Boolean)))
      })
  }, [user?.uid])

  useEffect(() => {
    getDocs(query(collection(db, 'users'), where('role', 'in', ['super_admin', 'staff_admin', 'agency'])))
      .then(snap => setRecipients(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
  }, [])

  const recipientLabel = (r) => {
    if (r.role === 'super_admin' || r.role === 'staff_admin') return `${r.name} — Hospital Administration`
    return `${r.name} — Agency`
  }

  const filteredRecipients = recipients.filter(r =>
    r.role === 'super_admin' || r.role === 'staff_admin' ||
    ((r.role === 'agency' || r.role === 'agency_admin') && patientAgencyIds.has(r.agencyId))
  )

  const handleSend = async () => {
    if (!toUid || !text.trim()) return
    setSending(true)
    try {
      const to   = recipients.find(r => r.id === toUid)
      const conv = await getOrCreateConversation(user.uid, toUid, {
        subject: subject.trim() || 'General Inquiry',
        names: { [user.uid]: user.name ?? 'Patient', [toUid]: to?.name ?? 'Staff' },
      })
      await sendMessage(conv.id, { from: user.uid, fromName: user.name, text: text.trim(), toUid })
      onCreated(conv.id)
    } catch {
      toast.error('Failed to send message. Please try again.')
    } finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative">
        {confirmClose && (
          <div className="absolute inset-0 bg-white/90 z-10 flex items-center justify-center rounded-2xl p-6">
            <div className="text-center space-y-3">
              <p className="text-sm font-semibold text-gray-800">Discard your message?</p>
              <p className="text-xs text-gray-500">Your message will be lost if you close now.</p>
              <div className="flex gap-2 justify-center pt-1">
                <button className="btn-secondary text-sm" onClick={() => setConfirmClose(false)}>Keep writing</button>
                <button className="btn-danger text-sm" onClick={onClose}>Discard</button>
              </div>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">New Message</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To <span className="text-red-400">*</span></label>
            <select className="input" value={toUid} onChange={e => setToUid(e.target.value)}>
              <option value="">Select recipient...</option>
              {filteredRecipients.map(r => (
                <option key={r.id} value={r.id}>{recipientLabel(r)}</option>
              ))}
            </select>
            {filteredRecipients.length === 0 && patientAgencyIds.size === 0 && (
              <p className="text-xs text-gray-400 mt-1">Submit an assistance request first — agencies become reachable once CRMC endorses your request to them.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
            <input className="input text-sm" placeholder="What is this about? (optional)"
              value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message <span className="text-red-400">*</span></label>
            <textarea className="input text-sm resize-none" rows={4}
              placeholder="Write your message..."
              value={text} onChange={e => setText(e.target.value)} maxLength={MAX_CHARS} />
            {text.length > MAX_CHARS * 0.8 && (
              <p className={`text-xs mt-1 text-right ${charsLeft < 50 ? 'text-red-500' : 'text-gray-400'}`}>
                {charsLeft} characters remaining
              </p>
            )}
          </div>
        </div>
        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={handleClose}>Cancel</button>
          <button className="btn-primary text-sm flex items-center gap-1.5"
            onClick={handleSend} disabled={sending || !toUid || !text.trim()}>
            <MdSend size={14} /> {sending ? 'Sending...' : 'Send Message'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Admin Compose Modal ───────────────────────────────────────────────────

const ROLE_LABEL = { patient: 'Patient', staff_admin: 'Staff Admin', super_admin: 'Super Admin', agency: 'Agency' }

function AdminComposeModal({ user, onClose, onCreated }) {
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
      const to   = allUsers.find(u => u.id === toUid)
      const conv = await getOrCreateConversation(user.uid, toUid, {
        subject: subject.trim() || 'General Inquiry',
        names: { [user.uid]: user.name ?? 'Admin', [toUid]: to?.name ?? 'User' },
        roles: { [user.uid]: user.role, [toUid]: to?.role ?? 'patient' },
      })
      await sendMessage(conv.id, { from: user.uid, fromName: user.name, text: text.trim(), toUid })
      onCreated(conv.id)
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

// ── Inline Conversation Thread (admin two-panel) ───────────────────────────

function ConversationThread({ conversation, user, text, setText }) {
  const [messages,    setMessages]    = useState([])
  const [loadingMsgs, setLoadingMsgs] = useState(true)
  const [sending,     setSending]     = useState(false)
  const bottomRef                     = useRef(null)

  const oUid  = conversation?.participants?.find(p => p !== user.uid)
  const oName = conversation?.names?.[oUid] ?? 'Unknown'

  useEffect(() => {
    if (!conversation?.id) return
    setLoadingMsgs(true)
    const q = query(
      collection(db, 'conversations', conversation.id, 'messages'),
      orderBy('createdAt', 'asc')
    )
    const unsub = onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoadingMsgs(false)
    }, (err) => {
      setLoadingMsgs(false)
      console.error('[Messages] thread snapshot error:', err)
    })
    updateDoc(doc(db, 'conversations', conversation.id), {
      [`unread.${user.uid}`]: 0,
      [`seenBy.${user.uid}`]: serverTimestamp(),
    }).catch(() => {})
    return unsub
  }, [conversation?.id])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const handleSend = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    await sendMessage(conversation.id, { from: user.uid, fromName: user.name, text: text.trim(), toUid: oUid })
    setText('')
    setSending(false)
  }

  const lastMsg   = messages[messages.length - 1]
  const otherSeen = conversation.seenBy?.[oUid]
  const showSeen  = lastMsg?.from === user.uid && otherSeen &&
    (otherSeen.seconds ?? 0) >= (lastMsg?.createdAt?.seconds ?? 0)
  const charsLeft = MAX_CHARS - text.length

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* Thread header */}
      <div className="px-5 py-3.5 border-b border-gray-100 flex-shrink-0 bg-white">
        <p className="text-sm font-semibold text-gray-900">{oName}</p>
        {conversation.subject && (
          <p className="text-xs text-gray-500 mt-0.5">
            <span className="font-medium">Subject:</span> {conversation.subject}
          </p>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {loadingMsgs && (
          <div className="space-y-4 animate-pulse">
            <div className="flex flex-col items-start gap-1">
              <div className="h-2.5 bg-gray-100 rounded w-20" />
              <div className="h-9 bg-gray-100 rounded-2xl w-48" />
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="h-2.5 bg-gray-100 rounded w-16" />
              <div className="h-9 bg-gray-100 rounded-2xl w-40" />
            </div>
            <div className="flex flex-col items-start gap-1">
              <div className="h-2.5 bg-gray-100 rounded w-20" />
              <div className="h-12 bg-gray-100 rounded-2xl w-56" />
            </div>
          </div>
        )}

        {!loadingMsgs && messages.length === 0 && (
          <div className="flex flex-col items-center py-10 gap-3 text-center">
            <div className="w-12 h-12 bg-brand-50 rounded-full flex items-center justify-center">
              <MdMessage size={22} className="text-brand-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">No messages yet</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Send the first message to start the conversation with {oName}.
              </p>
            </div>
            {conversation.subject && (
              <span className="text-xs text-brand-500 bg-brand-50 px-3 py-1 rounded-full font-medium">
                📎 {conversation.subject}
              </span>
            )}
          </div>
        )}

        {!loadingMsgs && messages.map((m, idx) => {
          const isMe      = m.from === user.uid
          const dateLabel = fmtDateLabel(m.createdAt)
          const prevLabel = idx > 0 ? fmtDateLabel(messages[idx - 1].createdAt) : null
          const showSep   = dateLabel && dateLabel !== prevLabel
          return (
            <Fragment key={m.id}>
              {showSep && (
                <div className="flex items-center gap-3 my-1">
                  <div className="flex-1 h-px bg-gray-100" />
                  <span className="text-xs text-gray-400 font-medium px-1">{dateLabel}</span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
              )}
              <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                <p className="text-xs text-gray-400 mb-0.5">
                  {isMe ? 'You' : m.fromName} · {fmtFull(m.createdAt)}
                </p>
                <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed
                  ${isMe ? 'bg-brand-500 text-white rounded-br-sm' : 'bg-gray-100 text-gray-800 rounded-bl-sm'}`}>
                  {m.text}
                </div>
              </div>
            </Fragment>
          )
        })}

        {!loadingMsgs && showSeen && (
          <p className="text-xs text-gray-400 text-right">Seen by {oName}</p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Reply box */}
      <div className="px-4 py-3 border-t border-gray-100 flex-shrink-0 bg-white">
        <div className="flex items-end gap-2">
          <textarea
            className="input flex-1 text-sm resize-none min-h-[38px] max-h-[120px] leading-relaxed"
            placeholder={`Reply to ${oName}...`}
            value={text}
            maxLength={MAX_CHARS}
            rows={1}
            onChange={e => {
              setText(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
            }}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
          />
          <button
            className="w-11 h-11 bg-brand-500 text-white rounded-xl flex items-center justify-center hover:bg-brand-600 disabled:opacity-40 transition-colors flex-shrink-0"
            onClick={handleSend} disabled={sending || !text.trim()}>
            <MdSend size={18} />
          </button>
        </div>
        {text.length > MAX_CHARS * 0.8 && (
          <p className={`text-xs mt-1 text-right ${charsLeft < 50 ? 'text-red-500' : 'text-gray-400'}`}>
            {charsLeft} characters remaining
          </p>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function Messages() {
  const { user }               = useAuth()
  const isPatient              = user?.role === 'patient'
  const [searchParams]         = useSearchParams()
  const [conversations, setConversations] = useState([])
  const [loading, setLoading]  = useState(true)
  const [selected, setSelected] = useState(new Set())
  const [search, setSearch]    = useState('')

  // Patient: modal uses index-based navigation
  const [activeIndex, setActiveIndex] = useState(null)

  // Admin: inline thread uses conversation ID
  const [activeConvId,       setActiveConvId]       = useState(null)
  const [threadText,         setThreadText]         = useState('')
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const [pendingConvId,      setPendingConvId]      = useState(null)

  const [showCompose,       setShowCompose]       = useState(false)
  const [pendingOpenConvId, setPendingOpenConvId] = useState(null)
  const [confirmDelete,     setConfirmDelete]     = useState(false)

  // ── Load conversations ─────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return
    const q = query(collection(db, 'conversations'), where('participants', 'array-contains', user.uid))
    const unsub = onSnapshot(q, snap => {
      setConversations(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.lastAt?.seconds ?? 0) - (a.lastAt?.seconds ?? 0))
      )
      setLoading(false)
    }, (err) => {
      setLoading(false)
      console.error('[Messages] conversations snapshot error:', err)
      toast.error('Failed to load conversations.')
    })
    return unsub
  }, [user?.uid])

  // ── Auto-open from ?conv= param ────────────────────────────────────────
  useEffect(() => {
    const convParam = searchParams.get('conv')
    if (!convParam || conversations.length === 0) return
    if (isPatient) {
      const idx = filtered.findIndex(c => c.id === convParam)
      if (idx !== -1) setActiveIndex(idx)
    } else {
      setActiveConvId(convParam)
    }
  }, [searchParams, conversations])

  // ── Auto-open after compose ────────────────────────────────────────────
  useEffect(() => {
    if (!pendingOpenConvId || conversations.length === 0) return
    if (isPatient) {
      const idx = filtered.findIndex(c => c.id === pendingOpenConvId)
      if (idx !== -1) {
        setActiveIndex(idx)
        setPendingOpenConvId(null)
      }
    } else {
      setActiveConvId(pendingOpenConvId)
      setPendingOpenConvId(null)
    }
  }, [pendingOpenConvId, conversations])

  // ── Filtered list ──────────────────────────────────────────────────────
  const filtered = conversations.filter(c => {
    const oUid = c.participants?.find(p => p !== user.uid)
    const name = c.names?.[oUid] ?? ''
    const q    = search.toLowerCase()
    return !q || name.toLowerCase().includes(q) || (c.subject ?? '').toLowerCase().includes(q)
  })

  // Admin: find the active conversation object by ID
  const activeConv = filtered.find(c => c.id === activeConvId) ?? null

  // ── Admin: try-navigate with unsaved-changes guard ─────────────────────
  const trySelectConversation = (convId) => {
    if (showCompose) setShowCompose(false)
    if (threadText.trim() && convId !== activeConvId) {
      setPendingConvId(convId)
      setShowDiscardConfirm(true)
    } else {
      setActiveConvId(convId)
      setThreadText('')
    }
  }

  const confirmDiscardAndNavigate = () => {
    setThreadText('')
    setActiveConvId(pendingConvId)
    setPendingConvId(null)
    setShowDiscardConfirm(false)
  }

  // ── Bulk actions ───────────────────────────────────────────────────────
  const toggleSelect = (id) =>
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const selectAll = () =>
    setSelected(selected.size === filtered.length && filtered.length > 0
      ? new Set()
      : new Set(filtered.map(c => c.id))
    )

  const markSelectedRead = async () => {
    const batch = writeBatch(db)
    for (const id of selected)
      batch.update(doc(db, 'conversations', id), { [`unread.${user.uid}`]: 0 })
    await batch.commit()
    setSelected(new Set())
  }

  const performDelete = async () => {
    await Promise.all([...selected].map(async (id) => {
      const msgsSnap = await getDocs(collection(db, 'conversations', id, 'messages'))
      if (msgsSnap.empty) return
      for (let i = 0; i < msgsSnap.docs.length; i += 500) {
        const b = writeBatch(db)
        msgsSnap.docs.slice(i, i + 500).forEach(d => b.delete(d.ref))
        await b.commit()
      }
    }))
    const batch = writeBatch(db)
    for (const id of selected) batch.delete(doc(db, 'conversations', id))
    await batch.commit()
    if (selected.has(activeConvId)) { setActiveConvId(null); setThreadText('') }
    setSelected(new Set())
    setActiveIndex(null)
    setConfirmDelete(false)
  }

  const unreadCount = conversations.filter(c => (c.unread?.[user?.uid] ?? 0) > 0).length

  // ── Shared conversation list markup ────────────────────────────────────
  const convList = (
    <>
      {loading && Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5 animate-pulse">
          <div className="w-4 h-4 bg-gray-100 rounded flex-shrink-0" />
          <div className="w-8 h-8 rounded-full bg-gray-100 flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 bg-gray-100 rounded w-28" />
            <div className="h-2.5 bg-gray-100 rounded w-48" />
          </div>
          <div className="h-3 bg-gray-100 rounded w-12 flex-shrink-0" />
        </div>
      ))}
      {!loading && filtered.map((c, idx) => {
        const oUid      = c.participants?.find(p => p !== user.uid)
        const name      = c.names?.[oUid] ?? 'Unknown'
        const unread    = (c.unread?.[user.uid] ?? 0) > 0
        const isSelected = selected.has(c.id)
        const isActive   = isPatient ? activeIndex === idx : c.id === activeConvId
        return (
          <div key={c.id}
            onClick={() => isPatient ? setActiveIndex(idx) : trySelectConversation(c.id)}
            className={`flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-colors
              ${isActive
                ? 'bg-brand-50 border-r-2 border-brand-500'
                : isSelected ? 'bg-brand-50/30'
                : unread ? 'bg-amber-50/30 hover:bg-amber-50/60'
                : 'hover:bg-gray-50'
              }`}>
            {!isPatient && (
              <div onClick={e => { e.stopPropagation(); toggleSelect(c.id) }} className="flex-shrink-0">
                <input type="checkbox" className="w-4 h-4 accent-brand-500" checked={isSelected} onChange={() => {}} />
              </div>
            )}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
              ${unread ? 'bg-brand-500 text-white' : isActive ? 'bg-brand-100 text-brand-600' : 'bg-gray-100 text-gray-500'}`}>
              {name[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <p className={`text-sm truncate ${unread ? 'font-semibold text-gray-900' : isActive ? 'font-medium text-brand-700' : 'text-gray-700'}`}>
                  {name}
                </p>
                <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">{fmtDate(c.lastAt)}</span>
              </div>
              <p className={`text-xs truncate ${unread ? 'font-medium text-gray-700' : 'text-gray-400'}`}>
                {c.lastMessage
                  ? `${c.lastFrom === user.uid ? 'You: ' : ''}${c.lastMessage}`
                  : c.subject || '(no messages yet)'
                }
              </p>
            </div>
            {unread
              ? <span className="w-2.5 h-2.5 bg-brand-500 rounded-full flex-shrink-0" />
              : !isPatient
                ? <MdCheckCircle size={16} className="text-green-400 flex-shrink-0" />
                : null
            }
          </div>
        )
      })}
      {!loading && filtered.length === 0 && (
        <div className="text-center py-14 px-6">
          <MdMessage size={36} className="text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400 mb-1">
            {search ? 'No conversations match your search.' : 'No messages yet.'}
          </p>
          {search ? (
            <button
              onClick={() => setSearch('')}
              className="mt-3 inline-flex items-center text-sm font-medium text-brand-500 hover:text-brand-600">
              Clear search
            </button>
          ) : isPatient && (
            <button
              onClick={() => setShowCompose(true)}
              className="mt-3 btn-primary text-sm inline-flex items-center gap-1.5">
              <MdAdd size={15} /> New Message
            </button>
          )}
        </div>
      )}
    </>
  )

  // ── Compose modal — patient only (admin compose renders inline in right panel) ──
  const composeModal = showCompose && isPatient && (
    <PatientComposeModal
      user={user}
      onClose={() => setShowCompose(false)}
      onCreated={(convId) => { setShowCompose(false); setPendingOpenConvId(convId) }}
    />
  )

  // ──────────────────────────────────────────────────────────────────────
  // Patient layout — narrow centered card with modal overlay
  // ──────────────────────────────────────────────────────────────────────
  if (isPatient) {
    return (
      <Layout breadcrumb="Messages">
        <div className="p-4 sm:p-6 max-w-3xl mx-auto">
          <div className="flex items-start justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center">
                <MdMessage size={22} className="text-brand-500" />
              </div>
              <div>
                <h1 className="page-title">Messages</h1>
                <p className="page-sub">All your conversations in one place.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && <span className="badge badge-blue">{unreadCount} unread</span>}
              {/* Header compose button only renders when conversations
                  exist. On the empty state the inline "+ New Message"
                  card-centre button is the call-to-action, so showing
                  both was reported as redundant by patients during the
                  Tier-2 audit. */}
              {conversations.length > 0 && (
                <button className="btn-primary flex items-center gap-1.5 text-sm" onClick={() => setShowCompose(true)}>
                  <MdMessage size={15} /> New Message
                </button>
              )}
            </div>
          </div>
          <div className="card overflow-hidden">
            {/* Search + counter row — hidden when the user has zero
                conversations. Showing "0 conversations" + a search
                box with nothing to find is just clutter; the empty
                state below already explains what to do next. */}
            {conversations.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50">
                <span className="text-xs text-gray-500 font-medium">
                  {filtered.length} conversation{filtered.length !== 1 ? 's' : ''}
                  {search && filtered.length !== conversations.length && (
                    <span className="text-gray-400 font-normal"> of {conversations.length}</span>
                  )}
                </span>
                <div className="relative ml-auto">
                  <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
                  <input className="input pl-8 py-1.5 text-sm w-52" placeholder="Search messages..."
                    value={search} onChange={e => setSearch(e.target.value)} />
                </div>
              </div>
            )}
            <div className="divide-y divide-gray-50">{convList}</div>
          </div>
          {composeModal}
          {activeIndex !== null && filtered[activeIndex] && (
            <ConversationModal
              conversations={filtered}
              activeIndex={activeIndex}
              user={user}
              onClose={() => setActiveIndex(null)}
              onNavigate={setActiveIndex}
            />
          )}
        </div>
      </Layout>
    )
  }

  // ──────────────────────────────────────────────────────────────────────
  // Admin layout — full-width two-panel split
  // ──────────────────────────────────────────────────────────────────────
  return (
    <Layout breadcrumb="Messages">
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left panel: conversation list ── */}
        <div className="w-80 flex-shrink-0 border-r border-gray-100 flex flex-col overflow-hidden bg-white">

          {/* Header */}
          <div className="px-4 py-3.5 border-b border-gray-100 flex-shrink-0 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Messages</p>
              {unreadCount > 0 && (
                <span className="badge badge-blue text-xs">{unreadCount} unread</span>
              )}
            </div>
            <button className="btn-primary text-xs flex items-center gap-1 px-3 py-1.5"
              onClick={() => setShowCompose(true)}>
              <MdMessage size={13} /> Compose
            </button>
          </div>

          {/* Discard confirmation */}
          {showDiscardConfirm && (
            <div className="bg-amber-50 border-b border-amber-100 px-4 py-2.5 flex items-center gap-2 flex-shrink-0">
              <p className="text-xs text-amber-700 flex-1">Discard your unsaved reply?</p>
              <button className="text-xs text-gray-500 font-medium hover:text-gray-700"
                onClick={() => { setShowDiscardConfirm(false); setPendingConvId(null) }}>
                Keep
              </button>
              <button className="text-xs text-white bg-amber-500 px-2.5 py-1 rounded-lg hover:bg-amber-600"
                onClick={confirmDiscardAndNavigate}>
                Discard
              </button>
            </div>
          )}

          {/* Delete confirmation */}
          {confirmDelete && (
            <div className="bg-red-50 border-b border-red-200 px-4 py-2.5 flex items-center gap-2 flex-shrink-0">
              <p className="text-xs text-red-700 flex-1">
                Delete <strong>{selected.size}</strong> conversation{selected.size !== 1 ? 's' : ''} for all participants?
              </p>
              <button className="text-xs text-gray-500 font-medium hover:text-gray-700"
                onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="text-xs text-white bg-red-500 px-2.5 py-1 rounded-lg hover:bg-red-600"
                onClick={performDelete}>Delete</button>
            </div>
          )}

          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50 flex-shrink-0">
            <input type="checkbox" className="w-4 h-4 accent-brand-500 flex-shrink-0"
              checked={selected.size === filtered.length && filtered.length > 0}
              onChange={selectAll} />
            {selected.size > 0 ? (
              <>
                <button onClick={markSelectedRead}
                  className="flex items-center gap-1 text-xs text-gray-600 border border-gray-200 bg-white px-2 py-1 rounded-lg hover:bg-gray-50 transition-colors">
                  <MdDone size={13} /> Read
                </button>
                <button onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1 text-xs text-red-500 border border-red-200 bg-white px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">
                  <MdDelete size={13} /> Delete
                </button>
                <span className="text-xs text-gray-400">{selected.size} selected</span>
              </>
            ) : (
              <span className="text-xs text-gray-500">
                {filtered.length} conversation{filtered.length !== 1 ? 's' : ''}
                {search && filtered.length !== conversations.length && (
                  <span className="text-gray-400"> of {conversations.length}</span>
                )}
              </span>
            )}
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-gray-100 flex-shrink-0">
            <div className="relative">
              <MdSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
              <input className="input pl-8 py-1.5 text-sm w-full" placeholder="Search conversations..."
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
            {convList}
          </div>
        </div>

        {/* ── Right panel: compose / thread / empty ── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-50/30">
          {showCompose ? (
            <AdminComposeModal
              user={user}
              onClose={() => setShowCompose(false)}
              onCreated={(convId) => { setShowCompose(false); setPendingOpenConvId(convId) }}
            />
          ) : activeConv ? (
            <ConversationThread
              key={activeConv.id}
              conversation={activeConv}
              user={user}
              text={threadText}
              setText={setThreadText}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="w-16 h-16 bg-brand-50 rounded-2xl flex items-center justify-center mb-4">
                <MdMessage size={28} className="text-brand-400" />
              </div>
              <p className="text-sm font-medium text-gray-600 mb-1">No conversation selected</p>
              <p className="text-xs text-gray-400">
                Click a conversation on the left to start reading and replying
              </p>
            </div>
          )}
        </div>
      </div>

      {composeModal}
    </Layout>
  )
}
