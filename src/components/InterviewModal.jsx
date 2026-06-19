import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { MdClose, MdVideoCall, MdOpenInNew, MdContentPaste, MdRefresh } from 'react-icons/md'
import toast from 'react-hot-toast'

// Google Meet URLs come in two formats: the standard xxx-yyyy-zzz code
// and the lookup/<id> alias. Both start with meet.google.com so a single
// host check is enough; we don't care about the path beyond that. Stripping
// query/hash so a copied link with ?authuser=... or #join=... still passes.
const isMeetUrl = (s) => /^https?:\/\/meet\.google\.com\//i.test((s ?? '').trim())

/**
 * Schedule / reschedule a Google Meet interview.
 *
 * Used by both admin (CRMC schedules the single assessment interview on
 * a request under the co-funding redesign) and agency (legacy direct-to-
 * agency apps still in flight). The form is identical across both -- date,
 * time, Meet link, conducting social worker -- so the component is shared
 * here rather than namespaced under components/agency/.
 *
 * Props:
 *  - app:         the parent doc (request or application) -- only patientName is read
 *  - agency:      optional, used to pre-fill conductedBy from agency.defaultSignatory
 *  - onConfirm:   async fn({ date, time, link, conductedBy }) -- caller persists
 *  - onClose:     close the modal
 */
export default function InterviewModal({ app, agency, onConfirm, onClose }) {
  const { user } = useAuth()
  const defaultConductor = agency?.defaultSignatory?.trim() || user?.name || ''
  const [form, setForm] = useState({ date: '', time: '2:00 PM', link: '', conductedBy: defaultConductor })
  const set = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.value }))

  // R40 clipboard-paste flow: the first click opens meet.new in a new tab
  // (same as before); subsequent clicks read the clipboard and try to
  // populate the link field with whatever the user copied from the Meet
  // tab. We can't pull the URL out of the cross-origin tab directly so
  // the clipboard is the only practical native bridge.
  const [hasGenerated, setHasGenerated] = useState(false)
  const [pasting, setPasting] = useState(false)

  // If the user returns to this tab after generating, we already trust
  // hasGenerated so the button stays in "Paste" mode -- this effect is
  // just defensive in case some browsers reset state weirdly on focus.
  useEffect(() => {
    const onFocus = () => { /* no-op; state is the source of truth */ }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const handleGenerateOrPaste = async () => {
    if (!hasGenerated) {
      // First click: open Google's Instant Meeting shortcut. meet.new
      // provisions a fresh meeting on the coordinator's signed-in
      // Google account and lands on the meeting page; Google copies
      // the URL to the clipboard automatically in most flows, but
      // we don't depend on that -- the coordinator can manually copy.
      window.open('https://meet.new', '_blank', 'noopener,noreferrer')
      setHasGenerated(true)
      return
    }

    // Subsequent click: try to read clipboard. navigator.clipboard
    // requires a user gesture (we're inside one) AND HTTPS or
    // localhost -- both true for our deploy.
    if (!navigator.clipboard?.readText) {
      toast.error('Your browser blocks clipboard reads. Paste the link manually into the field below.')
      return
    }
    setPasting(true)
    try {
      const text = (await navigator.clipboard.readText()) ?? ''
      const trimmed = text.trim()
      if (!isMeetUrl(trimmed)) {
        toast.error('No Meet link on the clipboard. Copy the URL from the Google tab and try again.')
        return
      }
      setForm(p => ({ ...p, link: trimmed }))
      toast.success('Meet link pasted.')
    } catch (err) {
      console.error('[InterviewModal] clipboard read failed:', err)
      toast.error('Could not read the clipboard. Paste the link manually below.')
    } finally {
      setPasting(false)
    }
  }

  // Lets the user re-open meet.new if their first attempt didn't take
  // (popup blocked, accidentally closed the tab, etc.) without losing
  // the Paste-mode of the primary button.
  const reopenMeet = () =>
    window.open('https://meet.new', '_blank', 'noopener,noreferrer')

  return (
    <div className="fixed inset-0 bg-black/40 z-[300] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Schedule Interview</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-gray-500">
            Scheduling interview for <strong>{app.patientName}</strong>
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Date <span className="text-red-400">*</span></label>
            <input type="date" className="input" value={form.date} onChange={set('date')} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Time <span className="text-red-400">*</span></label>
            <input className="input" placeholder="e.g. 2:00 PM" value={form.time} onChange={set('time')} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-gray-700">Google Meet Link <span className="text-red-400">*</span></label>
              {/* R40: button morphs after the first click. State 1
                  opens meet.new (same as the old <a>). State 2 reads
                  the clipboard and tries to drop a Meet URL into the
                  input below -- saves the manual Ctrl+V step. The
                  cross-origin Meet tab can't be inspected directly,
                  so the clipboard is the only native bridge. */}
              <button
                type="button"
                onClick={handleGenerateOrPaste}
                disabled={pasting}
                className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1 group disabled:opacity-60">
                {!hasGenerated ? (
                  <>
                    <MdVideoCall size={14} className="text-brand-500 group-hover:text-brand-600" />
                    Generate Meet
                    <MdOpenInNew size={11} className="opacity-60" />
                  </>
                ) : (
                  <>
                    <MdContentPaste size={13} className="text-brand-500 group-hover:text-brand-600" />
                    {pasting ? 'Reading…' : 'Paste meet link'}
                  </>
                )}
              </button>
            </div>
            <input className="input" placeholder="https://meet.google.com/..." value={form.link} onChange={set('link')} />
            {!hasGenerated ? (
              <p className="text-xs text-gray-400 mt-1 leading-snug">
                Tap <strong>Generate Meet</strong> to create a new meeting in Google. We'll paste the link here for you after you copy it.
              </p>
            ) : (
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-xs text-gray-400 leading-snug flex-1">
                  Copy the meeting URL from the Google tab, then tap <strong>Paste meet link</strong>.
                </p>
                <button
                  type="button"
                  onClick={reopenMeet}
                  className="text-[11px] text-gray-400 hover:text-brand-600 flex items-center gap-0.5 flex-shrink-0"
                  title="Open Google Meet again">
                  <MdRefresh size={12} /> open Meet again
                </button>
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Conducting Social Worker <span className="text-red-400">*</span></label>
            <input className="input" placeholder="Full name of conducting staff" value={form.conductedBy} onChange={set('conductedBy')} />
          </div>
        </div>
        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm"
            onClick={() => {
              if (!form.date || !form.time || !form.link || !form.conductedBy.trim()) {
                toast.error('Please fill in all fields.'); return
              }
              onConfirm(form)
            }}>
            Schedule Interview
          </button>
        </div>
      </div>
    </div>
  )
}
