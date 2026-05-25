import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  MdDashboard, MdTimeline, MdFolder, MdMessage, MdMenu,
} from 'react-icons/md'

/**
 * Bottom tab bar for the installed PWA / mobile view.
 *
 * Shown only on mobile widths (<lg) and only for patient role. Agency
 * and admin users keep the sidebar + hamburger pattern because their
 * surfaces are web-only per CLAUDE.md.
 *
 * The 5 tabs are: Dashboard, My Application, Documents, Messages, More.
 * "More" opens the existing sidebar drawer so we don't have to duplicate
 * a second nav surface — patients tapping More see the full nav including
 * Find Programs, Interviews, Guide.
 *
 * Why these 5: Dashboard is home. My Application is the highest-frequency
 * destination for active patients. Documents is high-frequency during the
 * doc-verification phase. Messages is the primary support channel.
 * Everything else is lower frequency and moves into the More drawer.
 */
export default function BottomTabBar({ unreadMessages = 0, onMoreClick }) {
  const { t } = useTranslation()

  // Short single-word labels — the full labels ("My Application",
  // "My Documents") wrap to two lines on 360px-wide phones and make
  // the tab bar feel cramped. iOS native apps follow the same one-word
  // convention ("Mail", "Photos", "Settings").
  const tabs = [
    { to: '/patient/dashboard', Icon: MdDashboard, labelKey: 'patient.tab.dashboard' },
    { to: '/patient/status',    Icon: MdTimeline,  labelKey: 'patient.tab.apply'     },
    { to: '/patient/documents', Icon: MdFolder,    labelKey: 'patient.tab.docs'      },
    {
      to:        '/patient/messages',
      Icon:      MdMessage,
      labelKey:  'patient.tab.messages',
      badge:     unreadMessages,
    },
  ]

  return (
    <nav
      // Fixed-bottom bar on mobile only. Safe-area padding handles the
      // iOS home-indicator gap so the bar sits just above it instead of
      // being half-eaten by the device UI.
      className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-100 flex print:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary navigation"
    >
      {tabs.map(tab => {
        const Icon = tab.Icon
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-0.5 py-2 px-1 min-h-[56px] relative transition-colors ${
                isActive ? 'text-brand-500' : 'text-gray-500 hover:text-brand-500'
              }`
            }
          >
            <div className="relative">
              <Icon size={22} />
              {tab.badge > 0 && (
                <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {tab.badge > 9 ? '9+' : tab.badge}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium leading-tight">{t(tab.labelKey)}</span>
          </NavLink>
        )
      })}
      {/* More tab — opens the existing sidebar drawer so patients can reach
          Find Programs, Interviews, Guide, and the profile dropdown
          without us having to maintain a second nav surface. */}
      <button
        type="button"
        onClick={onMoreClick}
        className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 px-1 min-h-[56px] text-gray-500 hover:text-brand-500 transition-colors"
        aria-label={t('shell.more')}
      >
        <MdMenu size={22} />
        <span className="text-[10px] font-medium leading-tight">{t('shell.more')}</span>
      </button>
    </nav>
  )
}