import { MdAssignment, MdCheckCircle, MdCancel, MdEvent, MdReceipt, MdEdit,
         MdHourglassEmpty, MdInfo, MdPerson, MdUndo, MdAutorenew } from 'react-icons/md'
import { tsToDate } from '../utils/dates'

/**
 * CaseTimeline — chronological cross-agency event feed for a single
 * co-funding request, rendered on agency/ApplicationDetail above the
 * existing "Co-funding picture" panel.
 *
 * Pattern source: Salesforce Public Sector "Activity Timeline" +
 * NHS England Integrated Care Systems shared care record event view.
 * Each agency sees the case from the network's perspective in time
 * order — what Bardach (1998) calls "frame reflection."
 *
 * Data source: auditLog entries with denormalized `requestId` matching
 * the current request. The Firestore rule (R33) permits any co-funding
 * agency to read those entries.
 *
 * Visual: vertical feed with an action-typed icon + colour, a one-line
 * summary, and a relative timestamp. Most recent first.
 */

// Per-action icon + accent colour. Add new entries as new action types
// get plumbed through logAudit().
const ACTION_VISUAL = {
  request_endorsed:   { Icon: MdAssignment,      cls: 'bg-purple-50 text-purple-600 border-purple-200',
                        label: 'CRMC Endorsed' },
  patient_proceeded:  { Icon: MdPerson,          cls: 'bg-brand-50 text-brand-600 border-brand-200',
                        label: 'Patient Proceeded' },
  slice_advanced:     { Icon: MdAutorenew,       cls: 'bg-blue-50 text-blue-600 border-blue-200',
                        label: 'Slice Updated' },
  app_approved:       { Icon: MdCheckCircle,     cls: 'bg-green-50 text-green-600 border-green-200',
                        label: 'Slice Approved' },
  approval_reversed:  { Icon: MdUndo,            cls: 'bg-red-50 text-red-600 border-red-200',
                        label: 'Approval Reversed' },
  doc_verified:       { Icon: MdCheckCircle,     cls: 'bg-green-50 text-green-600 border-green-200',
                        label: 'Document Verified' },
  doc_rejected:       { Icon: MdCancel,          cls: 'bg-red-50 text-red-600 border-red-200',
                        label: 'Document Rejected' },
  doc_rereview:       { Icon: MdEdit,            cls: 'bg-amber-50 text-amber-600 border-amber-200',
                        label: 'Document Re-review' },
  interview_scheduled:{ Icon: MdEvent,           cls: 'bg-blue-50 text-blue-600 border-blue-200',
                        label: 'Interview Scheduled' },
  interview_completed:{ Icon: MdCheckCircle,     cls: 'bg-green-50 text-green-600 border-green-200',
                        label: 'Interview Completed' },
  intake_completed:   { Icon: MdCheckCircle,     cls: 'bg-teal-50 text-teal-600 border-teal-200',
                        label: 'Intake Completed' },
  gl_redeemed:        { Icon: MdReceipt,         cls: 'bg-green-50 text-green-600 border-green-200',
                        label: 'GL Redeemed' },
  gl_unmark_redeemed: { Icon: MdUndo,            cls: 'bg-amber-50 text-amber-600 border-amber-200',
                        label: 'GL Redemption Reversed' },
  gl_expired:         { Icon: MdHourglassEmpty,  cls: 'bg-orange-50 text-orange-600 border-orange-200',
                        label: 'GL Expired' },
  gl_auto_expired:    { Icon: MdHourglassEmpty,  cls: 'bg-orange-50 text-orange-600 border-orange-200',
                        label: 'GL Auto-Expired' },
}

const fallbackVisual = { Icon: MdInfo, cls: 'bg-gray-50 text-gray-500 border-gray-200', label: 'Activity' }

// "Mar 8 14:30" — short, sortable, no year unless prior year.
function formatStamp(ts) {
  const d = tsToDate(ts)
  if (!d) return '—'
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleString([], sameYear
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function CaseTimeline({ events = [], loading = false }) {
  // Most recent first (events arrive ascending from the snapshot query).
  const ordered = [...events].reverse()

  return (
    <div className="card p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
        <MdEvent size={13} /> Case Timeline
      </p>

      {loading && (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex gap-3">
              <div className="w-8 h-8 bg-gray-100 rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-gray-100 rounded w-3/4" />
                <div className="h-2 bg-gray-100 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && ordered.length === 0 && (
        <p className="text-sm text-gray-400 py-4">
          No timeline events recorded yet for this request.
        </p>
      )}

      {!loading && ordered.length > 0 && (
        <div className="space-y-3">
          {ordered.map((e, i) => {
            const visual = ACTION_VISUAL[e.action] ?? fallbackVisual
            const Icon = visual.Icon
            const isLast = i === ordered.length - 1
            return (
              <div key={e.id} className="flex gap-3 relative">
                {/* Vertical connector line behind the icon column */}
                {!isLast && (
                  <span className="absolute left-4 top-9 bottom-0 w-px bg-gray-100" aria-hidden="true" />
                )}
                <div className={`relative w-8 h-8 rounded-full border flex items-center justify-center flex-shrink-0 ${visual.cls}`}>
                  <Icon size={15} />
                </div>
                <div className="flex-1 min-w-0 pb-1">
                  <p className="text-xs text-gray-400">{formatStamp(e.createdAt)} · {e.actorName ?? 'System'}</p>
                  <p className="text-sm text-gray-800">
                    <span className="font-medium">{visual.label}</span>
                    {e.details && <span className="text-gray-600"> — {e.details}</span>}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}