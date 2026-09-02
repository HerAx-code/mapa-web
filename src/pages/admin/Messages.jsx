import { useState, useEffect, Fragment } from 'react'
import Layout from '../../components/Layout'
import {
  collection, query, where, orderBy, onSnapshot,
  doc, updateDoc, deleteDoc, serverTimestamp, getDocs, writeBatch,
} from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  MdSearch, MdCheckCircle, MdDelete, MdDone,
  MdMessage, MdAdd,
} from 'react-icons/md'

// Phase 2.2 split: 4 inlined components + date helpers moved to
// ./messages/. The page now focuses on the inbox list + selection state
// + the two-pane orchestration. ~900 lines removed.
import { fmtDate } from './messages/helpers'
import ConversationThread    from './messages/ConversationThread'
import PatientComposeModal   from './messages/PatientComposeModal'
import AdminComposeModal     from './messages/AdminComposeModal'

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
        <div className="text-center py-10 px-6">
          {/* Larger, brand-tinted icon makes the empty state feel
              intentional rather than missing. */}
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-brand-50 flex items-center justify-center">
            <MdMessage size={36} className="text-brand-400" />
          </div>
          {search ? (
            <>
              <p className="text-sm font-medium text-gray-600 mb-3">
                No conversations match your search.
              </p>
              <button
                onClick={() => setSearch('')}
                className="text-sm font-medium text-brand-500 hover:text-brand-600">
                Clear search
              </button>
            </>
          ) : isPatient ? (
            <>
              <p className="text-base font-semibold text-gray-800 mb-2">
                No messages yet
              </p>
              <p className="text-sm text-gray-500 leading-relaxed mb-3 max-w-xs mx-auto">
                Have a question about your assistance request? Reach out to
                CRMC or any agency that&apos;s reviewing your application.
              </p>
              <p className="text-xs text-gray-400 leading-relaxed mb-5 max-w-xs mx-auto">
                You can message <strong className="text-gray-600">CRMC anytime</strong>.
                Agencies become reachable once CRMC endorses your request to them.
              </p>
              <button
                onClick={() => setShowCompose(true)}
                className="btn-primary text-sm inline-flex items-center gap-1.5">
                <MdAdd size={15} /> Start a Conversation
              </button>
            </>
          ) : (
            <>
              <p className="text-base font-semibold text-gray-800 mb-2">
                No messages yet
              </p>
              <p className="text-sm text-gray-500 leading-relaxed max-w-xs mx-auto">
                When a patient or another team member reaches out, the
                conversation will appear here.
              </p>
            </>
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
    // R29: patient layout is now responsive. On md+ it renders the same
    // two-panel split admin/agency get (left list, inline thread on the
    // right) so desktop screens don't waste 60% of their width and the
    // thread doesn't pop in a modal. On <md it falls back to the
    // centered card + modal pattern that works well on phones.
    //
    // The conversation index (activeIndex) drives both branches so a
    // patient who picked a conversation on mobile keeps the same one
    // selected if they rotate to landscape / resize the window.
    const activeConv = activeIndex !== null ? filtered[activeIndex] : null
    return (
      <Layout breadcrumb="Messages">
        {/* ── Mobile (<md) — centered card + modal ── */}
        <div className="w-full max-w-3xl mx-auto p-4 sm:p-6 overflow-x-clip md:hidden">
          <div className="flex items-start justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center">
                <MdMessage size={22} className="text-brand-500" />
              </div>
              <div>
                <p className="eyebrow">Inbox</p>
                <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">Messages</h1>
                <p className="text-sm text-gray-500 mt-1">All your conversations in one place.</p>
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
        </div>

        {/* The compose flow is the same on both layouts -- the modal
            renders itself when showCompose is true. */}
        {composeModal}

        {/* Mobile-only full-screen thread. fixed inset-0 fills the phone
            screen at a STABLE height (no content-based resizing — the old
            centered modal grew/shrank with message count), with a back
            arrow — the standard mobile chat pattern, not a floating dialog.
            Reuses the same ConversationThread the desktop split uses. */}
        {activeConv && (
          <div className="md:hidden fixed inset-0 z-[200] bg-white flex flex-col">
            <ConversationThread
              key={activeConv.id}
              conversation={activeConv}
              user={user}
              text={threadText}
              setText={setThreadText}
              onBack={() => { setActiveIndex(null); setThreadText('') }}
            />
          </div>
        )}

        {/* ── Desktop (md+) — two-panel split ── */}
        <div className="hidden md:flex flex-1 min-h-0 overflow-hidden">
          {/* Left panel: header + search + list */}
          <div className="w-80 flex-shrink-0 border-r border-gray-100 flex flex-col overflow-hidden bg-white">
            <div className="px-4 py-3.5 border-b border-gray-100 flex-shrink-0 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">Messages</p>
                {unreadCount > 0 && <span className="badge badge-blue text-xs">{unreadCount} unread</span>}
              </div>
              <button className="btn-primary text-xs flex items-center gap-1 px-3 py-1.5"
                onClick={() => setShowCompose(true)}>
                <MdMessage size={13} /> New Message
              </button>
            </div>
            {conversations.length > 0 && (
              <div className="px-3 py-2 border-b border-gray-100 flex-shrink-0 bg-gray-50">
                <div className="relative">
                  <MdSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                  <input className="input pl-8 py-1.5 text-sm w-full" placeholder="Search conversations..."
                    value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {filtered.length} conversation{filtered.length !== 1 ? 's' : ''}
                  {search && filtered.length !== conversations.length && (
                    <span className="text-gray-400 font-normal"> of {conversations.length}</span>
                  )}
                </p>
              </div>
            )}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">{convList}</div>
          </div>

          {/* Right panel: inline thread or empty state */}
          <div className="flex-1 flex flex-col overflow-hidden bg-gray-50/30">
            {activeConv ? (
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
                <p className="text-sm font-medium text-gray-600 mb-1">
                  {conversations.length === 0 ? 'No conversations yet' : 'No conversation selected'}
                </p>
                <p className="text-xs text-gray-400 max-w-xs">
                  {conversations.length === 0
                    ? 'Start a new conversation with CRMC or your assigned agency using the New Message button.'
                    : 'Pick a conversation on the left to read and reply.'}
                </p>
              </div>
            )}
          </div>
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
