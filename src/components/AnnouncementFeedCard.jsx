import { useState } from 'react'
import { MdClose, MdCampaign, MdExpandMore, MdExpandLess } from 'react-icons/md'
import { TYPE_CONFIG, dismissAnnouncement } from '../utils/announcements'
import { useAuth } from '../contexts/AuthContext'

/**
 * AnnouncementFeedCard — R38 dashboard "What's new" surface.
 *
 * Renders the items returned by useFeedAnnouncements as a stacked card
 * on each dashboard. Up to 3 items show by default; the rest collapse
 * behind a "Show N more" toggle.
 *
 * Visual language matches AnnouncementBanner (TYPE_CONFIG colors),
 * but the layout is card-style with bigger title + message so longer
 * promo copy reads well.
 *
 * - warning items cannot be dismissed (urgent stays put)
 * - dismissal is localStorage-only, scoped to the current uid
 * - empty items array -> renders null (no empty state on dashboards)
 */

const formatEndsIn = (endAt) => {
  const end = endAt?.toDate?.()?.getTime()
  if (!end) return null
  const diff = end - Date.now()
  if (diff <= 0) return null
  const days = Math.floor(diff / 86400000)
  const hrs  = Math.floor((diff % 86400000) / 3600000)
  if (days >= 1) return `Ends in ${days}d`
  if (hrs >= 1)  return `Ends in ${hrs}h`
  const mins = Math.max(1, Math.floor(diff / 60000))
  return `Ends in ${mins}m`
}

const VISIBLE_LIMIT = 3

export default function AnnouncementFeedCard({ items }) {
  const { user } = useAuth()
  const [expanded, setExpanded] = useState(false)
  const [hiddenIds, setHiddenIds] = useState(new Set())

  if (!items || items.length === 0) return null

  // Apply local dismissal (optimistic) so the card responds instantly
  // before the hook re-fires from the localStorage write.
  const visible = items.filter(a => !hiddenIds.has(a.id))
  if (visible.length === 0) return null

  const shownCount = expanded ? visible.length : Math.min(VISIBLE_LIMIT, visible.length)
  const shown = visible.slice(0, shownCount)
  const overflow = visible.length - VISIBLE_LIMIT

  const handleDismiss = (id) => {
    dismissAnnouncement(user?.uid, id)
    setHiddenIds(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  return (
    <div className="card p-4 sm:p-5" role="region" aria-label="What's new">
      <div className="flex items-center gap-2 mb-3">
        <MdCampaign className="text-brand-500" size={18} />
        <h2 className="text-sm font-semibold text-gray-900">What&apos;s new</h2>
        <span className="text-xs text-gray-400">({visible.length})</span>
      </div>

      <ul className="space-y-2.5">
        {shown.map(ann => {
          const cfg = TYPE_CONFIG[ann.type] ?? TYPE_CONFIG.info
          const Icon = cfg.icon
          const endsIn = formatEndsIn(ann.endAt)
          const isWarning = ann.type === 'warning'
          return (
            <li
              key={ann.id}
              className={`flex gap-3 rounded-lg border p-3 ${cfg.bg} ${cfg.border}`}
            >
              <div className="flex-shrink-0 pt-0.5">
                <Icon size={18} className={cfg.iconColor} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <p className="text-sm font-semibold text-gray-900">{ann.title}</p>
                  {ann.source === 'agency' && ann.agencyName && (
                    <span className="text-xs text-gray-500">from {ann.agencyName}</span>
                  )}
                </div>
                <p className="text-xs text-gray-700 mt-0.5 leading-relaxed whitespace-pre-line">
                  {ann.message}
                </p>
                {endsIn && (
                  <span className={`inline-block mt-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>
                    {endsIn}
                  </span>
                )}
              </div>
              {!isWarning && (
                <button
                  onClick={() => handleDismiss(ann.id)}
                  aria-label={`Dismiss announcement: ${ann.title}`}
                  className={`${cfg.iconColor} opacity-40 hover:opacity-100 flex-shrink-0 transition-opacity`}
                >
                  <MdClose size={16} />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {overflow > 0 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-3 w-full flex items-center justify-center gap-1 py-1.5 text-xs font-medium text-gray-500 hover:text-brand-600 transition-colors"
        >
          {expanded ? (
            <>Show less <MdExpandLess size={16} /></>
          ) : (
            <>Show {overflow} more <MdExpandMore size={16} /></>
          )}
        </button>
      )}
    </div>
  )
}
