import { useState } from 'react'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { notify } from '../utils/notifications'
import { logAudit } from '../utils/auditLog'
import { MdClose } from 'react-icons/md'
import toast from 'react-hot-toast'

export const OUTCOME_BADGE = {
  completed:   'badge-green',
  no_show:     'badge-red',
  rescheduled: 'badge-amber',
}
export const OUTCOME_LABEL = {
  completed:   'Completed',
  no_show:     'No-Show',
  rescheduled: 'Rescheduled',
}

const TITLES = {
  completed:   'Mark Interview as Completed',
  no_show:     'Mark as No-Show',
  rescheduled: 'Reschedule Interview',
}

const formatInterviewDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export default function OutcomeModal({ app, outcome, currentUser, onClose, onSaved }) {
  const [notes, setNotes]     = useState('')
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('')
  const [saving, setSaving]   = useState(false)

  const handleSave = async () => {
    if (outcome === 'rescheduled' && (!newDate || !newTime)) {
      toast.error('Please choose the new date and time.')
      return
    }
    setSaving(true)
    try {
      const baseStamp = {
        outcome,
        outcomeNotes:      notes.trim() || null,
        outcomeRecordedAt: serverTimestamp(),
        outcomeRecordedBy: currentUser.name,
      }
      if (outcome === 'rescheduled') {
        await updateDoc(doc(db, 'applications', app.id), {
          ...baseStamp,
          interviewDate: newDate,
          interviewTime: newTime,
          updatedAt:     serverTimestamp(),
        })
        await notify(app.patientId, {
          type:  'interview_sched',
          title: 'Interview rescheduled',
          body:  `Your interview with ${app.agencyName} has been rescheduled to ${formatInterviewDate(newDate)} at ${newTime}.`,
        })
      } else {
        await updateDoc(doc(db, 'applications', app.id), {
          ...baseStamp,
          updatedAt: serverTimestamp(),
        })
        if (outcome === 'no_show') {
          await notify(app.patientId, {
            type:  'app_advanced',
            title: 'Missed interview recorded',
            body:  `You missed your scheduled interview with ${app.agencyName}. Please contact the agency to reschedule.`,
          })
        }
      }
      logAudit(currentUser, {
        action: 'interview_outcome',
        targetType: 'application',
        targetId: app.id,
        targetName: app.patientName,
        details: `Outcome: ${OUTCOME_LABEL[outcome]}${notes.trim() ? ` — ${notes.trim()}` : ''}`,
      })
      toast.success(`Recorded as ${OUTCOME_LABEL[outcome]}.`)
      onSaved?.()
      onClose()
    } catch (err) {
      console.error(err)
      toast.error('Failed to save outcome.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[300] flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{TITLES[outcome]}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{app.patientName} · {app.appId || app.id?.slice(0, 10)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><MdClose size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {outcome === 'rescheduled' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">New Date</label>
                <input type="date" className="input" value={newDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={e => setNewDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">New Time</label>
                <input type="time" className="input" value={newTime}
                  onChange={e => setNewTime(e.target.value)} />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Notes <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea className="input resize-none" rows={3}
              placeholder={
                outcome === 'completed'   ? 'Interview observations, follow-up actions...'
                : outcome === 'no_show'    ? 'Did the patient give any reason or contact you?'
                                            : 'Reason for rescheduling...'
              }
              maxLength={500}
              value={notes} onChange={e => setNotes(e.target.value)} />
            <p className="text-xs text-gray-400 mt-0.5 text-right">{notes.length} / 500</p>
          </div>

          {outcome === 'completed' && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
              After marking complete, return to the <strong>Inbox</strong> to approve or reject based on the interview outcome.
            </div>
          )}
        </div>

        <div className="px-5 pb-4 flex gap-2 justify-end border-t border-gray-50">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Outcome'}
          </button>
        </div>
      </div>
    </div>
  )
}
