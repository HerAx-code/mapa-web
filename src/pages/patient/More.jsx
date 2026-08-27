import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  MdSearch, MdVideoCall, MdMenuBook,
  MdPerson, MdLock, MdShield, MdHelp, MdFlag,
  MdLogout, MdChevronRight, MdLanguage, MdTour, MdSecurity,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import Layout from '../../components/Layout'
import ProfileModals from '../../components/ProfileModals'
import { useAuth } from '../../contexts/AuthContext'
import { resetTourFlag } from '../../utils/tours'
import i18n from '../../i18n'

/**
 * Patient "More" page — replaces the left-sliding drawer that the
 * BottomTabBar's More tab used to open. Three reasons it's a full
 * page instead of an overlay:
 *
 *   1. Three menu items don't justify a 70%-width modal. A page is
 *      a more proportionate surface for a small set of links.
 *   2. The hardware back button now navigates back to whatever tab
 *      the patient was on, instead of closing a drawer. Matches
 *      every other in-app navigation.
 *   3. Room to grow. Profile actions, language, and logout all
 *      consolidate here so secondary nav lives in one canonical
 *      surface instead of being split between a drawer and a
 *      separate profile dropdown.
 */
export default function PatientMore() {
  const navigate           = useNavigate()
  const { t, i18n: i18nHook } = useTranslation()
  const { user, logout }   = useAuth()
  const [activeModal, setActiveModal] = useState(null)

  const toggleLang = () => {
    const next = i18nHook.language === 'fil' ? 'en' : 'fil'
    i18n.changeLanguage(next)
  }

  // R25: await Firebase signOut before navigating. The old fire-and-forget
  // version raced the navigate against the auth-state clear; PrivateRoute
  // self-corrected in practice, but a fast back/forward could briefly
  // surface authenticated content. Awaiting closes the race.
  const handleLogout = async () => {
    try {
      await logout()
    } catch (err) {
      console.error('[PatientMore] logout failed:', err)
    }
    navigate('/login')
    toast.success(t('shell.toast.loggedOut'))
  }

  // Clears the patient-dashboard tour-seen flag, then routes home so
  // the dashboard mounts fresh and <Tour> auto-fires again. Quicker
  // than walking the user through DevTools for re-watching.
  const handleReplayTour = () => {
    resetTourFlag('patient-dashboard', user?.uid)
    toast.success(t('patient.more.tourReset'))
    navigate('/patient/dashboard')
  }

  // Section model — each section gets a header + a list of rows.
  // Rows that open a modal pass `modal`, rows that navigate pass `to`,
  // rows that fire an action pass `action`.
  const sections = [
    {
      heading: t('patient.more.navigation'),
      items: [
        { icon: MdSearch,    label: t('patient.nav.findPrograms'), to: '/patient/programs' },
        { icon: MdVideoCall, label: t('patient.nav.interviews'),   to: '/patient/interviews' },
        { icon: MdMenuBook,  label: t('patient.nav.userGuide'),    to: '/patient/guide'      },
      ],
    },
    {
      heading: t('patient.more.account'),
      items: [
        { icon: MdPerson,   label: t('shell.profile.accountSettings'),       modal: 'account'  },
        { icon: MdLock,     label: t('shell.profile.changePassword'),        modal: 'password' },
        // R37: citizen-visible audit trail (RA 10173 §16c). Route lives at
        // /patient/access-log -- handled by item.to in handleRowClick.
        { icon: MdSecurity, label: 'Who has accessed your record',           to: '/patient/access-log' },
      ],
    },
    {
      heading: t('patient.more.settings'),
      items: [
        {
          icon:  MdLanguage,
          label: t('patient.more.language'),
          trailing: i18nHook.language === 'fil' ? 'Filipino' : 'English',
          action: toggleLang,
        },
        { icon: MdShield, label: t('shell.profile.privacyNotice'), modal: 'settings' },
        { icon: MdHelp,   label: t('shell.profile.helpSupport'),   modal: 'help'     },
        { icon: MdTour,   label: t('patient.more.showTour'),       action: handleReplayTour },
        { icon: MdFlag,   label: t('shell.profile.reportProblem'), modal: 'report'   },
      ],
    },
  ]

  const handleRowClick = (item) => {
    if (item.to)     navigate(item.to)
    if (item.modal)  setActiveModal(item.modal)
    if (item.action) item.action()
  }

  return (
    <Layout breadcrumb={t('patient.more.title')}>
      <ProfileModals
        activeModal={activeModal}
        onClose={() => setActiveModal(null)}
        onSetModal={setActiveModal}
      />

      <div className="px-3 py-4 sm:p-6 mx-auto w-full max-w-[100vw] sm:max-w-3xl overflow-x-clip">

        {/* Header */}
        <div className="mb-5">
          <p className="eyebrow">{t('patient.more.eyebrow')}</p>
          <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">{t('patient.more.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('patient.more.subtitle')}</p>
        </div>

        {/* Profile card — name + role, tap to open account settings */}
        {user && (
          <button
            onClick={() => setActiveModal('account')}
            className="w-full card p-4 mb-4 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors">
            <div className="w-12 h-12 rounded-full bg-brand-50 text-brand-600 border-2 border-brand-400 flex items-center justify-center text-base font-bold flex-shrink-0">
              {user.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() ?? 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold text-gray-900 truncate">{user.name}</p>
              <p className="text-xs text-gray-400 truncate">{user.email}</p>
            </div>
            <MdChevronRight size={20} className="text-gray-300 flex-shrink-0" />
          </button>
        )}

        {/* Sections */}
        {sections.map(section => (
          <div key={section.heading} className="mb-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest px-1 mb-2">
              {section.heading}
            </p>
            <div className="card overflow-hidden divide-y divide-gray-50">
              {section.items.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => handleRowClick(item)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left">
                  <div className="w-9 h-9 bg-brand-50 rounded-xl flex items-center justify-center flex-shrink-0">
                    <item.icon size={18} className="text-brand-500" />
                  </div>
                  <span className="flex-1 text-sm font-medium text-gray-800">{item.label}</span>
                  {item.trailing && (
                    <span className="text-xs text-gray-400">{item.trailing}</span>
                  )}
                  <MdChevronRight size={18} className="text-gray-300 flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Logout — destructive action, separated visually */}
        <button
          onClick={handleLogout}
          className="w-full card p-3.5 flex items-center justify-center gap-2 text-red-500 hover:bg-red-50 transition-colors font-medium text-sm">
          <MdLogout size={18} />
          {t('shell.profile.logout')}
        </button>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-5">
          {t('shell.profile.footer')}
        </p>
      </div>
    </Layout>
  )
}
