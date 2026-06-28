import { useState, useEffect } from 'react'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../../../firebase'
import { sendMessage, getOrCreateConversation } from '../../../utils/messages'
import { MdClose, MdSend, MdCheckCircle } from 'react-icons/md'
import toast from 'react-hot-toast'
import { MAX_CHARS } from './helpers'

/**
 * Patient-side compose modal — pick a CRMC contact or an agency the
 * patient has a slice with, then send the first message of a new
 * conversation. Extracted from src/pages/admin/Messages.jsx as part
 * of the Phase 2.2 split.
 *
 * Behavior preserved verbatim including:
 *   - Recipients query has its own loading / 'denied' / 'ready' state
 *     so a rules failure doesn't render an empty recipient list
 *   - Agency filter: only agencies that hold a slice for this patient
 *     appear (looked up via /applications)
 *   - Defensive name resolution (name -> displayName -> roleLabel) so
 *     legacy CRMC docs with only displayName still render properly
 *   - getOrCreateConversation returns a STRING id; field-reported bug
 *     where this site previously did `conv.id` is documented inline
 *   - Detailed error code -> human message mapping on send failure
 */
export default function PatientComposeModal({ user, onClose, onCreated }) {
  const [recipients,       setRecipients]       = useState([])
  const [recipientsState,  setRecipientsState]  = useState('loading')
  const [patientAgencyIds, setPatientAgencyIds] = useState(new Set())
  const [toUid,            setToUid]            = useState('')
  const [subject,          setSubject]          = useState('')
  const [text,             setText]             = useState('')
  const [sending,          setSending]          = useState(false)
  const [confirmClose,     setConfirmClose]     = useState(false)
  const [showSubject,      setShowSubject]      = useState(false)

  const hasUnsaved = !!text.trim() || !!subject.trim()
  const charsLeft  = MAX_CHARS - text.length
  const handleClose = () => hasUnsaved ? setConfirmClose(true) : onClose()

  useEffect(() => {
    if (!user?.uid) return
    getDocs(query(collection(db, 'applications'), where('patientId', '==', user.uid)))
      .then(snap => {
        setPatientAgencyIds(new Set(snap.docs.map(d => d.data().agencyId).filter(Boolean)))
      })
      .catch((err) => console.warn('[PatientCompose] applications query failed:', err))
  }, [user?.uid])

  useEffect(() => {
    getDocs(query(collection(db, 'users'), where('role', 'in', ['super_admin', 'staff_admin', 'agency'])))
      .then(snap => {
        setRecipients(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setRecipientsState('ready')
      })
      .catch((err) => {
        console.warn('[PatientCompose] recipients query failed:', err)
        setRecipientsState('denied')
      })
  }, [])

  const isCRMC = (r) => r.role === 'super_admin' || r.role === 'staff_admin'
  const roleLabel = (r) => {
    if (r.role === 'super_admin') return 'CRMC Administrator'
    if (r.role === 'staff_admin')  return 'CRMC Staff'
    if (r.role === 'agency_admin') return 'Agency Administrator'
    if (r.role === 'agency')       return 'Agency Coordinator'
    return 'CRMC'
  }
  const displayName = (r) => r.name || r.displayName || roleLabel(r)
  const initials    = (r) => {
    const tokens = displayName(r).split(/\s+/).map(s => s[0]).filter(Boolean)
    return tokens.join('').slice(0, 2).toUpperCase() || 'U'
  }
  const visibleRecipients = recipients.filter(r =>
    isCRMC(r) ||
    ((r.role === 'agency' || r.role === 'agency_admin') && patientAgencyIds.has(r.agencyId))
  )
  const crmcGroup   = visibleRecipients.filter(isCRMC)
  const agencyGroup = visibleRecipients.filter(r => !isCRMC(r))

  const selectedRecipient = recipients.find(r => r.id === toUid)

  const handleSend = async () => {
    if (!toUid || !text.trim()) return
    setSending(true)
    try {
      const to = recipients.find(r => r.id === toUid)
      // getOrCreateConversation returns the conversation ID as a STRING.
      // Earlier this site mistakenly did `conv.id` which yielded undefined
      // and caused every patient send to write to conversations/undefined/
      // messages (rules denial surfaced as a generic toast). Bug reported
      // 2026-06-02; documented so the convId-as-string contract stays
      // explicit if anyone refactors getOrCreateConversation in the future.
      const convId = await getOrCreateConversation(user.uid, toUid, {
        subject: subject.trim() || 'General Inquiry',
        names: {
          [user.uid]: user.name ?? user.displayName ?? 'Patient',
          [toUid]:    displayName(to ?? {}),
        },
      })
      await sendMessage(convId, {
        from:     user.uid,
        fromName: user.name ?? user.displayName ?? 'Patient',
        text:     text.trim(),
        toUid,
      })
      onCreated(convId)
    } catch (err) {
      console.error('[PatientCompose] send failed:', err)
      const code = err?.code ?? ''
      const reason =
        code === 'permission-denied' ? 'Permission denied. The CRMC contact you picked may not be configured for messaging yet.'
        : code === 'unavailable'      ? 'Network problem. Check your connection and try again.'
        : code === 'failed-precondition' ? 'The message could not be delivered (server check failed).'
        : (err?.message ?? 'Unknown error.')
      toast.error(`Couldn’t send: ${reason}`, { duration: 7000 })
    } finally { setSending(false) }
  }

  const RecipientRow = ({ r, sub }) => {
    const selected = r.id === toUid
    return (
      <button
        type="button"
        onClick={() => setToUid(r.id)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors text-left ${
          selected
            ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-200'
            : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
        }`}>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
          isCRMC(r) ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'
        }`}>
          {initials(r)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{displayName(r)}</p>
          <p className="text-xs text-gray-500 truncate">{sub}</p>
        </div>
        {selected && <MdCheckCircle size={20} className="text-brand-500 flex-shrink-0" />}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center sm:p-4"
      onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="bg-white shadow-2xl w-full sm:max-w-md sm:rounded-2xl overflow-hidden relative h-full sm:h-auto sm:max-h-[90vh] flex flex-col">
        {confirmClose && (
          <div className="absolute inset-0 bg-white/95 z-10 flex items-center justify-center p-6">
            <div className="text-center space-y-3 max-w-xs">
              <p className="text-sm font-semibold text-gray-800">Discard your message?</p>
              <p className="text-xs text-gray-500">Your message will be lost if you close now.</p>
              <div className="flex gap-2 justify-center pt-1">
                <button className="btn-secondary text-sm" onClick={() => setConfirmClose(false)}>Keep writing</button>
                <button className="btn-danger text-sm" onClick={onClose}>Discard</button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">New Message</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 -m-2 p-2">
            <MdClose size={20} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {recipientsState === 'denied' ? (
            <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-3">
              <p className="text-xs font-semibold text-red-700 mb-1">Can&apos;t load recipients</p>
              <p className="text-xs text-red-700/80 leading-relaxed">
                The CRMC contact list couldn&apos;t be fetched. This usually
                means the latest security rules haven&apos;t been deployed.
                Please try again in a few minutes, or contact your
                administrator.
              </p>
            </div>
          ) : recipientsState === 'loading' ? (
            <div className="flex items-center gap-2 px-3 py-4 text-gray-400">
              <span className="w-4 h-4 border-2 border-gray-300 border-t-brand-500 rounded-full animate-spin" />
              <p className="text-sm">Loading recipients…</p>
            </div>
          ) : (
            <>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
                  CRMC — always available
                </p>
                <div className="space-y-1.5">
                  {crmcGroup.length > 0 ? (
                    crmcGroup.map(r => (
                      <RecipientRow key={r.id} r={r} sub="Medical Social Services" />
                    ))
                  ) : (
                    <p className="text-xs text-gray-400 italic px-3 py-2">
                      No CRMC contacts found.
                    </p>
                  )}
                </div>
              </div>

              {agencyGroup.length > 0 ? (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
                    Your Agencies
                  </p>
                  <div className="space-y-1.5">
                    {agencyGroup.map(r => (
                      <RecipientRow key={r.id} r={r} sub="Reviewing your application" />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                  <p className="text-xs text-amber-700 leading-relaxed">
                    <strong>Agencies aren&apos;t reachable yet.</strong> Once CRMC
                    endorses your request to an agency, they&apos;ll appear here
                    so you can message them directly.
                  </p>
                </div>
              )}
            </>
          )}

          {showSubject ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Subject <span className="text-xs font-normal text-gray-400">(optional)</span>
              </label>
              <input className="input text-sm" placeholder="What is this about?"
                autoFocus value={subject} onChange={e => setSubject(e.target.value)} />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowSubject(true)}
              className="text-xs text-brand-500 hover:text-brand-600 font-medium">
              + Add subject (optional)
            </button>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Message <span className="text-red-400">*</span>
            </label>
            <textarea
              className="input text-sm resize-none"
              rows={5}
              placeholder={selectedRecipient
                ? `Write your message to ${selectedRecipient.name?.split(' ')[0] ?? 'them'}…`
                : 'Write your message…'}
              value={text}
              onChange={e => setText(e.target.value)}
              maxLength={MAX_CHARS} />
            {text.length > MAX_CHARS * 0.8 && (
              <p className={`text-xs mt-1 text-right ${charsLeft < 50 ? 'text-red-500' : 'text-gray-400'}`}>
                {charsLeft} characters remaining
              </p>
            )}
          </div>
        </div>

        <div className="px-5 py-3 flex gap-2 border-t border-gray-100 bg-gray-50 flex-shrink-0">
          <button className="btn-secondary text-sm flex-1 sm:flex-none" onClick={handleClose}>Cancel</button>
          <button className="btn-primary text-sm flex-1 flex items-center justify-center gap-1.5"
            onClick={handleSend} disabled={sending || !toUid || !text.trim()}>
            <MdSend size={14} /> {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
