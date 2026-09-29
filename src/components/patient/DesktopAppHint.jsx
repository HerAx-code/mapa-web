import { useState } from 'react'
import { MdPhoneIphone, MdClose } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../contexts/AuthContext'
import { ROLES } from '../../utils/constants'

// Desktop-only, dismissible expectation-setter for patients: MAPA's primary
// channel is the phone/app; the web is the zero-install fallback. Shown only on
// wide screens (the mobile-first layout already reads as intended on a phone).
//
// Complements InstallNudge without doubling up: InstallNudge is a strip that
// appears when Chrome has ARMED the install prompt (offers a real Install
// button). This hint fills the gap when no prompt is armed — a gentle note, not
// an install CTA — and self-suppresses whenever the install prompt is available
// so the two never stack. See docs/patient-desktop-layout-plan.md.

const DISMISS_STORAGE_KEY = 'mapa_desktop_hint_dismissed_at'
const DISMISS_DURATION_MS = 30 * 86400 * 1000

const readDismissedRecently = () => {
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY)
    if (!raw) return false
    const ts = Number(raw)
    return Number.isFinite(ts) && Date.now() - ts < DISMISS_DURATION_MS
  } catch { return false }
}

const isStandalone = () => {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches
      || window.navigator?.standalone === true
}

export default function DesktopAppHint() {
  const { t }    = useTranslation()
  const { user } = useAuth()
  const isPatient = user?.role === ROLES.PATIENT

  const [hidden, setHidden] = useState(
    () => isStandalone() || readDismissedRecently() || !!window.__mapaDeferredInstallPrompt
  )

  if (!isPatient || hidden) return null

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now())) } catch {}
    setHidden(true)
  }

  return (
    // hidden on phones/tablets — the mobile-first layout is already right there;
    // this note is only for the wider desktop view.
    <div className="hidden lg:block print:hidden bg-gray-50 border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-6 py-2 flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-white border border-gray-200 flex items-center justify-center flex-shrink-0">
          <MdPhoneIphone size={15} className="text-brand-600" />
        </div>
        <p className="flex-1 min-w-0 text-xs text-gray-600 leading-snug">
          <span className="font-semibold text-gray-700">{t('install.desktopHint.title')}</span>
          {' — '}
          {t('install.desktopHint.desc')}
        </p>
        <button
          onClick={handleDismiss}
          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-200/70 rounded-md flex-shrink-0"
          aria-label={t('install.desktopHint.dismiss')}>
          <MdClose size={16} />
        </button>
      </div>
    </div>
  )
}
