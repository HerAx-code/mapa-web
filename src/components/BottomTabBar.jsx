import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  MdDashboard, MdTimeline, MdFavorite, MdMessage, MdMenu,
} from 'react-icons/md'

/**
 * Bottom tab bar for the installed PWA / mobile view.
 *
 * Shown only on mobile widths (<lg) and only for patient role. Agency
 * and admin users keep the sidebar + hamburger pattern because their
 * surfaces are web-only per CLAUDE.md.
 *
 * The 5 tabs are: Dashboard, My Application, Documents, Messages, More.
 * "More" now NAVIGATES to /patient/more (a dedicated page) instead of
 * opening a left-side drawer. The drawer pattern was disproportionate
 * for the 3-item overflow group, and a real page lets hardware back
 * behave naturally and gives room for account/settings actions.
 */
export default function BottomTabBar({ unreadMessages = 0 }) {
  const { t } = useTranslation()

  // Short single-word labels — the full labels ("My Application",
  // "My Documents") wrap to two lines on 360px-wide phones and make
  // the tab bar feel cramped. iOS native apps follow the same one-word
  // convention ("Mail", "Photos", "Settings").
  const tabs = [
    { to: '/patient/dashboard', Icon: MdDashboard, labelKey: 'patient.tab.dashboard' },
    { to: '/patient/status',    Icon: MdTimeline,  labelKey: 'patient.tab.apply'     },
    { to: '/patient/request',   Icon: MdFavorite,  labelKey: 'patient.tab.request'   },
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
              `flex-1 flex flex-col items-center justify-center gap-1 py-2 px-1 min-h-[60px] relative transition-colors active:bg-gray-50 ${
                isActive ? 'text-brand-500' : 'text-gray-500 hover:text-brand-500'
              }`
            }
          >
            <div className="relative">
              <Icon size={24} />
              {tab.badge > 0 && (
                <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {tab.badge > 9 ? '9+' : tab.badge}
                </span>
              )}
            </div>
            <span className="text-[11px] font-medium leading-tight">{t(tab.labelKey)}</span>
          </NavLink>
        )
      })}
      {/* More tab — navigates to /patient/more (a dedicated page)
          rather than opening a slide-in drawer. The page hosts the
          secondary nav (Find Programs, Interviews, Guide) plus the
          account/settings actions that used to live in the avatar
          dropdown. */}
      <NavLink
        to="/patient/more"
        className={({ isActive }) =>
          `flex-1 flex flex-col items-center justify-center gap-1 py-2 px-1 min-h-[60px] transition-colors active:bg-gray-50 ${
            isActive ? 'text-brand-500' : 'text-gray-500 hover:text-brand-500'
          }`
        }
      >
        <MdMenu size={24} />
        <span className="text-[11px] font-medium leading-tight">{t('shell.more')}</span>
      </NavLink>
    </nav>
  )
}