import { MdClose } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import { TYPE_CONFIG } from '../utils/announcements'

// Single source of truth for how a system announcement renders.
//
// Used by:
//   - components/Layout.jsx for the live banner shown to every user
//   - pages/admin/Announcements.jsx (BannerPreview) for the form's
//     live preview pane
//
// Previously these were two separate JSX blocks with two separate
// config maps (TYPE_CONFIG in Announcements, BANNER_CONFIG in
// Layout). Same colors today but a real drift risk -- editing one
// wouldn't update the other, and operators would see a preview
// that no longer matched what patients saw. Consolidated here.
//
// Props:
//   type:           'maintenance' | 'warning' | 'info' (falls back to info)
//   title:          string
//   message:        string
//   countdownLabel: optional string already formatted/translated by caller
//                   (e.g., "Ends in 2h 14m"). Component renders it as a
//                   pill in the type's color; doesn't compute it itself.
//   onDismiss:      optional fn() — when provided, an X button appears
//                   on the right.
//   placeholder:    boolean — if true, empty title/message render as
//                   italic gray "Enter a title…" / "Enter a message…"
//                   prompts (form preview mode).
export default function AnnouncementBanner({
  type,
  title,
  message,
  countdownLabel,
  onDismiss,
  placeholder = false,
  dismissAriaLabel = 'Dismiss',
}) {
  const { t } = useTranslation()
  const cfg  = TYPE_CONFIG[type] ?? TYPE_CONFIG.info
  const Icon = cfg.icon

  const titleNode = title
    ? <span className="text-sm font-semibold text-gray-900 mr-2">{title}</span>
    : placeholder
      ? <span className="text-sm font-semibold text-gray-400 italic mr-2">{t('shell.announcement.enterTitle')}</span>
      : null

  const messageNode = message
    ? <span className="text-sm text-gray-600">{message}</span>
    : placeholder
      ? <span className="text-sm text-gray-400 italic">{t('shell.announcement.enterMessage')}</span>
      : null

  return (
    <div className={`flex items-center gap-3 px-5 py-2.5 border ${cfg.bg} ${cfg.border}`}>
      <Icon size={17} className={`${cfg.iconColor} flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        {titleNode}
        {messageNode}
      </div>
      {countdownLabel && (
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${cfg.badge}`}>
          {countdownLabel}
        </span>
      )}
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label={dismissAriaLabel}
          className={`${cfg.iconColor} opacity-50 hover:opacity-100 flex-shrink-0 transition-opacity`}>
          <MdClose size={16} />
        </button>
      )}
    </div>
  )
}