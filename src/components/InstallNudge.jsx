import { useEffect, useState } from 'react'
import { MdDownload, MdClose } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { ROLES } from '../utils/constants'

// Patient-only install banner that surfaces when Chrome has fired the
// beforeinstallprompt event (the engagement heuristic has tripped).
// Placed inside Layout so it shows on whichever logged-in page the
// patient is currently viewing -- by the time they've reached a
// patient surface and clicked around, Chrome has almost always
// armed the deferred prompt, which is the moment to ask.
//
// Hidden when:
//   - role != 'patient' (agencies / admins don't install on phones)
//   - no deferred prompt is armed (Chrome won't show the install dialog)
//   - app is already running in standalone mode (installed)
//   - the patient dismissed it within the last DISMISS_DURATION_MS
//
// Dismiss is persisted to localStorage so it doesn't nag across
// navigations or app restarts. After 30 days the banner re-appears
// (Chrome may by then have a fresher prompt cycle, and the patient's
// situation may have changed).

const DISMISS_STORAGE_KEY = 'mapa_install_nudge_dismissed_at'
const DISMISS_DURATION_MS = 30 * 86400 * 1000

const readDismissedRecently = () => {
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY)
    if (!raw) return false
    const ts = Number(raw)
    if (!Number.isFinite(ts)) return false
    return Date.now() - ts < DISMISS_DURATION_MS
  } catch { return false }
}

const writeDismissed = () => {
  try { localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now())) } catch {}
}

const isStandalone = () => {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches
      || window.navigator?.standalone === true
}

export default function InstallNudge() {
  const { t }    = useTranslation()
  const { user } = useAuth()
  const isPatient = user?.role === ROLES.PATIENT

  const [deferredPrompt, setDeferredPrompt] = useState(() => window.__mapaDeferredInstallPrompt ?? null)
  const [hidden,         setHidden]         = useState(() => isStandalone() || readDismissedRecently())

  useEffect(() => {
    const onAvailable = () => setDeferredPrompt(window.__mapaDeferredInstallPrompt)
    const onInstalled = () => { setDeferredPrompt(null); setHidden(true) }
    window.addEventListener('mapa-install-available', onAvailable)
    window.addEventListener('mapa-install-completed', onInstalled)
    return () => {
      window.removeEventListener('mapa-install-available', onAvailable)
      window.removeEventListener('mapa-install-completed', onInstalled)
    }
  }, [])

  if (!isPatient || hidden || !deferredPrompt) return null

  const handleInstall = async () => {
    try {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        // appinstalled fires separately and hides via onInstalled above,
        // but flip local state immediately so the banner doesn't linger
        // between accept and the SW event.
        setHidden(true)
      } else {
        // User dismissed the Chrome install dialog. Treat as a soft
        // dismiss too -- don't keep showing the banner on every render
        // until they explicitly act again.
        writeDismissed()
        setHidden(true)
      }
      window.__mapaDeferredInstallPrompt = null
      setDeferredPrompt(null)
    } catch (err) {
      console.warn('[InstallNudge] prompt failed:', err)
    }
  }

  const handleDismiss = () => {
    writeDismissed()
    setHidden(true)
  }

  return (
    <div className="bg-brand-50 border-b border-brand-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-white border border-brand-100 flex items-center justify-center flex-shrink-0">
          <MdDownload size={16} className="text-brand-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-brand-800 leading-tight">
            {t('install.nudge.title')}
          </p>
          <p className="text-xs text-brand-700/80 leading-snug hidden sm:block">
            {t('install.nudge.desc')}
          </p>
        </div>
        <button
          onClick={handleInstall}
          className="px-3 py-1.5 text-xs font-semibold bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white rounded-lg whitespace-nowrap transition-colors flex-shrink-0">
          {t('install.nudge.cta')}
        </button>
        <button
          onClick={handleDismiss}
          className="w-7 h-7 flex items-center justify-center text-brand-500 hover:text-brand-700 hover:bg-brand-100 rounded-md flex-shrink-0"
          aria-label={t('install.nudge.dismiss')}>
          <MdClose size={16} />
        </button>
      </div>
    </div>
  )
}
