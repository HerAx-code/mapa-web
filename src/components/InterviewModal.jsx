import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { MdClose, MdVideoCall, MdOpenInNew } from 'react-icons/md'
import toast from 'react-hot-toast'

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
              {/* meet.new is Google's official shortcut: opening it
                  instantly provisions a new Meet using the coordinator's
                  signed-in Google account and lands on the meeting URL,
                  which they can then copy from the address bar and
                  paste back here. Saves 30 sec / interview vs hunting
                  for meet.google.com manually. */}
              <a
                href="https://meet.new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1 group">
                <MdVideoCall size={14} className="text-brand-500 group-hover:text-brand-600" />
                Generate Meet
                <MdOpenInNew size={11} className="opacity-60" />
              </a>
            </div>
            <input className="input" placeholder="https://meet.google.com/..." value={form.link} onChange={set('link')} />
            <p className="text-xs text-gray-400 mt-1 leading-snug">
              Tap <strong>Generate Meet</strong> to create a new meeting in Google. Copy the URL from the new tab and paste it here.
            </p>
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
