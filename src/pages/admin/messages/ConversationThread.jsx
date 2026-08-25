import { useState, useEffect, useRef, Fragment } from 'react'
import {
  collection, query, orderBy, onSnapshot, doc, updateDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../../firebase'
import { sendMessage } from '../../../utils/messages'
import { MdMessage, MdSend } from 'react-icons/md'
import toast from 'react-hot-toast'
import { MAX_CHARS, fmtFull, fmtDateLabel } from './helpers'

/**
 * Conversation thread (messages list + reply box) used by both the
 * patient ConversationModal (full-screen) and the admin two-panel
 * inline view. Extracted from src/pages/admin/Messages.jsx as part
 * of the Phase 2.2 split. Behavior preserved verbatim including:
 *   - R23 loadError state so transient snapshot errors don't show
 *     the empty-thread empty state
 *   - R27 mark-read updateDoc with explicit catch (was silent)
 *   - R21 send try/catch so a sendMessage throw doesn't strand the
 *     sending flag forever
 *
 * Lifted state into a `text` controlled prop so the parent can
 * preserve draft text across thread switches in the admin pane.
 */
export default function ConversationThread({ conversation, user, text, setText }) {
  const [messages,    setMessages]    = useState([])
  const [loadingMsgs, setLoadingMsgs] = useState(true)
  const [loadError,   setLoadError]   = useState(false)
  const [sending,     setSending]     = useState(false)
  const bottomRef                     = useRef(null)

  const oUid  = conversation?.participants?.find(p => p !== user.uid)
  const oName = conversation?.names?.[oUid] ?? 'Unknown'

  useEffect(() => {
    if (!conversation?.id) return
    setLoadingMsgs(true)
    setLoadError(false)
    const q = query(
      collection(db, 'conversations', conversation.id, 'messages'),
      orderBy('createdAt', 'asc')
    )
    const unsub = onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoadingMsgs(false)
      setLoadError(false)
    }, (err) => {
      setLoadingMsgs(false)
      setLoadError(true)
      console.error('[Messages] thread snapshot error:', err)
    })
    updateDoc(doc(db, 'conversations', conversation.id), {
      [`unread.${user.uid}`]: 0,
      [`seenBy.${user.uid}`]: serverTimestamp(),
    }).catch(err => console.warn('[Messages] mark read failed:', err))
    return unsub
  }, [conversation?.id])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const handleSend = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    try {
      await sendMessage(conversation.id, { from: user.uid, fromName: user.name, text: text.trim(), toUid: oUid })
      setText('')
    } catch (err) {
      console.error('[Messages] send failed:', err)
      toast.error('Could not send your message. Please try again.')
    } finally {
      setSending(false)
    }
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

        {!loadingMsgs && loadError && (
          <div className="flex flex-col items-center py-10 gap-3 text-center">
            <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center">
              <MdMessage size={22} className="text-red-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">Couldn't load this thread</p>
              <p className="text-xs text-gray-500 mt-0.5">Check your connection and try reopening the conversation.</p>
            </div>
          </div>
        )}

        {!loadingMsgs && !loadError && messages.length === 0 && (
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
                {conversation.subject}
              </span>
            )}
          </div>
        )}

        {!loadingMsgs && !loadError && messages.map((m, idx) => {
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
