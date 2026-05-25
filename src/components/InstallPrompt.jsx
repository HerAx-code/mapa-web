import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MdAdd, MdClose, MdIosShare } from 'react-icons/md'

const SESSION_DISMISS_KEY = 'mapa_install_prompt_dismissed'

/**
 * Patient-facing install prompt.
 *
 * Two distinct UX paths because the browser APIs are different:
 *
 *   Android / Chromium: the `beforeinstallprompt` event fires when the
 *   browser determines the app is installable. We capture the event,
 *   show our own banner with an Install button, and call event.prompt()
 *   when the patient taps. The native browser prompt then appears.
 *
 *   iOS Safari: no beforeinstallprompt event exists. Apple deliberately
 *   keeps the "Add to Home Screen" flow hidden in the Share sheet. The
 *   best we can do is detect iOS Safari + show a one-time hint pointing
 *   the patient to Share → Add to Home Screen.
 *
 * Dismissal: sessionStorage so it doesn't nag the same patient across
 * navigations, but reappears on a fresh visit. We don't want to lose
 * the install opportunity by remembering "they said no once" forever.
 */
export default function InstallPrompt() {
  const { t } = useTranslation()
  // Read the early-captured event from the inline script in index.html
  // so we don't miss the case where Chrome fires beforeinstallprompt
  // before React mounts.
  const [deferredPrompt, setDeferredPrompt] = useState(
    () => (typeof window !== 'undefined' ? window.__mapaDeferredInstallPrompt ?? null : null)
  )
  const [showIos,        setShowIos]         = useState(false)
  const [dismissed,      setDismissed]       = useState(
    typeof window !== 'undefined' && sessionStorage.getItem(SESSION_DISMISS_KEY) === '1'
  )

  useEffect(() => {
    // Don't run any of this if already running standalone (i.e., already installed).
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    if (isStandalone) return

    // The inline script in index.html captures beforeinstallprompt and
    // stashes it on window.__mapaDeferredInstallPrompt. It then dispatches
    // a custom event so any already-mounted React component can pick it up.
    const onAvailable = () => setDeferredPrompt(window.__mapaDeferredInstallPrompt)
    window.addEventListener('mapa-install-available', onAvailable)

    // iOS Safari path — detect once on mount.
    const ua = window.navigator.userAgent
    const isIos    = /iPad|iPhone|iPod/.test(ua) && !window.MSStream
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
    if (isIos && isSafari) setShowIos(true)

    // If the patient completes the install via the native prompt,
    // hide our banner immediately rather than waiting for navigation.
    const onInstalled = () => {
      setDeferredPrompt(null)
      setShowIos(false)
    }
    window.addEventListener('mapa-install-completed', onInstalled)

    return () => {
      window.removeEventListener('mapa-install-available', onAvailable)
      window.removeEventListener('mapa-install-completed', onInstalled)
    }
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    // Whether they accepted or dismissed the native prompt, the
    // captured event is one-shot — discard it.
    setDeferredPrompt(null)
    window.__mapaDeferredInstallPrompt = null
    if (outcome === 'dismissed') handleDismiss()
  }

  const handleDismiss = () => {
    sessionStorage.setItem(SESSION_DISMISS_KEY, '1')
    setDismissed(true)
  }

  if (dismissed) return null

  // Android / Chromium banner
  if (deferredPrompt) {
    return (
      <div className="card border border-brand-200 bg-brand-50 p-4 flex items-start gap-3">
        <div className="w-9 h-9 bg-brand-500 rounded-xl flex items-center justify-center flex-shrink-0">
          <MdAdd size={20} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-brand-800">{t('pwa.installPrompt.title')}</p>
          <p className="text-xs text-brand-700 mt-0.5 leading-relaxed">{t('pwa.installPrompt.desc')}</p>
          <div className="flex gap-2 mt-2.5">
            <button onClick={handleInstall}
              className="text-xs bg-brand-500 hover:bg-brand-600 text-white font-medium px-3 py-1.5 rounded-lg transition-colors">
              {t('pwa.installPrompt.install')}
            </button>
            <button onClick={handleDismiss}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium px-3 py-1.5 rounded-lg">
              {t('pwa.installPrompt.notNow')}
            </button>
          </div>
        </div>
        <button onClick={handleDismiss}
          aria-label={t('pwa.installPrompt.notNow')}
          className="text-brand-400 hover:text-brand-600 flex-shrink-0 p-1 -mr-1 -mt-1">
          <MdClose size={16} />
        </button>
      </div>
    )
  }

  // iOS Safari hint — no native prompt API, so we explain the manual steps.
  if (showIos) {
    return (
      <div className="card border border-brand-200 bg-brand-50 p-4 flex items-start gap-3">
        <div className="w-9 h-9 bg-brand-500 rounded-xl flex items-center justify-center flex-shrink-0">
          <MdIosShare size={18} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-brand-800">{t('pwa.installPrompt.title')}</p>
          <p className="text-xs text-brand-700 mt-0.5 leading-relaxed">{t('pwa.installPrompt.iosHint')}</p>
        </div>
        <button onClick={handleDismiss}
          aria-label={t('pwa.installPrompt.notNow')}
          className="text-brand-400 hover:text-brand-600 flex-shrink-0 p-1 -mr-1 -mt-1">
          <MdClose size={16} />
        </button>
      </div>
    )
  }

  return null
}