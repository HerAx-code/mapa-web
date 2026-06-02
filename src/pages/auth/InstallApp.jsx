import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  MdArrowBack, MdDownload, MdCheckCircle, MdIosShare,
  MdHome, MdFlashOn, MdWifiOff, MdNotifications,
  MdLaptop,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import Logo from '../../components/ui/Logo'
import LanguageToggle from '../../components/LanguageToggle'

/**
 * Public /install page.
 *
 * Reached by the Landing "Download App" button — primary install path
 * for visitors who haven't signed up yet.
 *
 * The page always shows a big primary Install button. Tap behavior is
 * "smart":
 *   - If we captured beforeinstallprompt (stashed on window by the inline
 *     script in index.html), tap fires the native Chrome install dialog.
 *   - If we haven't yet (Chrome's engagement heuristic hasn't tripped),
 *     tap scrolls to the manual install steps + toasts a one-line
 *     explanation. The patient never sees a "no button" dead-end.
 *   - On iOS Safari, tap scrolls to the Share-sheet steps (no install
 *     API on iOS).
 *   - On desktop, tap toasts a "open this on your phone" hint.
 *
 * Already-installed detection (display-mode standalone) replaces the
 * install button with a green "MAPA is already installed" card.
 */
export default function InstallApp() {
  const { t } = useTranslation()
  const [deferredPrompt, setDeferredPrompt] = useState(() => window.__mapaDeferredInstallPrompt ?? null)
  const [platform,       setPlatform]       = useState('unknown')
  const [installed,      setInstalled]      = useState(false)
  // Drives the button's visible state without changing its rendered shape:
  //   - 'idle'        the default "Install MAPA" copy
  //   - 'preparing'   "Preparing install…" while we poll for the Chrome
  //                   prompt to arm (tap itself is engagement; this often
  //                   tips Chrome over the threshold within a few seconds)
  //   - 'cancelled'   user cancelled the Chrome dialog; reset to a "Try
  //                   again" prompt that re-arms on next tap
  //   - 'unsupported' the user is on a browser/platform without the
  //                   beforeinstallprompt API; iOS Safari, Firefox, etc.
  //                   Button click reveals the platform-specific manual
  //                   steps inline so there's still a clear path.
  const [buttonState,    setButtonState]    = useState('idle')
  const manualStepsRef = useRef(null)

  useEffect(() => {
    // Detect platform once on mount.
    const ua       = window.navigator.userAgent
    const isIos    = /iPad|iPhone|iPod/.test(ua) && !window.MSStream
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
    const isAndroid = /Android/.test(ua)
    const isMobile  = isIos || isAndroid

    if (isIos && isSafari)     setPlatform('ios')
    else if (isAndroid)        setPlatform('android')
    else if (!isMobile)        setPlatform('desktop')
    else                       setPlatform('android')   // safe default

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    setInstalled(standalone)

    // Capture the event if it fires AFTER React mounts. The inline
    // script in index.html catches the early-firing case; this listener
    // catches the late-firing case. Belt-and-braces.
    const onAvailable = () => setDeferredPrompt(window.__mapaDeferredInstallPrompt)
    const onInstalled = () => {
      setDeferredPrompt(null)
      setInstalled(true)
    }
    window.addEventListener('mapa-install-available', onAvailable)
    window.addEventListener('mapa-install-completed', onInstalled)

    return () => {
      window.removeEventListener('mapa-install-available', onAvailable)
      window.removeEventListener('mapa-install-completed', onInstalled)
    }
  }, [])

  // Install handler. The patient taps once and the button either installs
  // immediately or polls for Chrome to arm the prompt while showing a
  // "Preparing install…" state. The tap itself is engagement (Chrome's
  // beforeinstallprompt heuristic counts user gestures), so during the
  // poll window Chrome usually arms the prompt and the install proceeds
  // without the patient needing to do anything else.
  //
  // For iOS / desktop / other-browser cases where there is no native
  // install API at all, the button click reveals the platform-specific
  // manual flow inline and the button state flips to 'unsupported' so
  // the user sees clear instructions instead of a useless spinner.
  const tryNativePrompt = async (promptObj) => {
    try {
      promptObj.prompt()
      const { outcome } = await promptObj.userChoice
      if (outcome === 'accepted') {
        // appinstalled fires separately and flips `installed` state.
        setButtonState('idle')
      } else {
        setButtonState('cancelled')
      }
      setDeferredPrompt(null)
      window.__mapaDeferredInstallPrompt = null
      return outcome
    } catch (err) {
      console.warn('[InstallApp] prompt() failed:', err)
      setButtonState('idle')
      return 'failed'
    }
  }

  const handleInstallClick = async () => {
    // iOS Safari has no install API at all -- the only path is the Share
    // sheet. Reveal the manual steps inline and stop pretending the
    // button can install.
    if (platform === 'ios') {
      setButtonState('unsupported')
      manualStepsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    // Desktop visitors should install on their phone. Same shape -- show
    // the desktop guidance inline rather than toasting it.
    if (platform === 'desktop') {
      setButtonState('unsupported')
      return
    }

    // Android Chrome path.
    // Already armed? install immediately.
    const armed = deferredPrompt ?? window.__mapaDeferredInstallPrompt
    if (armed) {
      setButtonState('preparing')
      await tryNativePrompt(armed)
      return
    }

    // Not armed yet. Poll for up to 8 seconds while the patient's tap
    // accumulates as engagement for Chrome. Most cold-visit users see
    // the prompt arm within this window.
    setButtonState('preparing')
    for (let i = 0; i < 32; i++) {
      await new Promise(r => setTimeout(r, 250))
      const p = window.__mapaDeferredInstallPrompt
      if (p) {
        await tryNativePrompt(p)
        return
      }
    }

    // 8 seconds and Chrome still hasn't armed it. Surface the manual
    // steps inline so the patient has a clear next action; do NOT toast
    // a fallback that fades away.
    setButtonState('unsupported')
    manualStepsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Reset to idle whenever Chrome arms the prompt while we're in a
  // 'cancelled' or 'unsupported' state, so the next tap goes straight to
  // a real install.
  useEffect(() => {
    if (deferredPrompt && (buttonState === 'cancelled' || buttonState === 'unsupported')) {
      setButtonState('idle')
    }
  }, [deferredPrompt, buttonState])

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Topbar — hide 'Back to home' when the app is already
          installed; the Landing page redirects away in standalone
          mode so the link would just round-trip the user. */}
      <header className="border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <Logo size={32} withWordmark />
        <div className="flex items-center gap-2">
          <LanguageToggle />
          {!installed && (
            <Link to="/" className="text-sm text-gray-500 hover:text-brand-600 font-medium flex items-center gap-1">
              <MdArrowBack size={14} /> {t('installPage.backHome')}
            </Link>
          )}
        </div>
      </header>

      <main className="flex-1 px-4 py-8 sm:py-12">
        <div className="max-w-xl mx-auto">

          {/* Hero */}
          <div className="text-center mb-6">
            <div className="w-24 h-24 mx-auto mb-5 rounded-3xl bg-white border border-gray-100 shadow-sm flex items-center justify-center p-2">
              <img src="/pwa-512.png" alt="MAPA" className="w-full h-full object-contain rounded-2xl" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
              {t('installPage.hero.title')}
            </h1>
            <p className="text-sm text-gray-500 leading-relaxed max-w-md mx-auto">
              {t('installPage.hero.desc')}
            </p>
          </div>

          {/* PRIMARY INSTALL BUTTON — always visible (unless already installed) */}
          {installed ? (
            <div className="card p-5 mb-6 flex items-start gap-3 border-green-200 bg-green-50">
              <MdCheckCircle size={24} className="text-green-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-green-800">{t('installPage.alreadyInstalled.title')}</p>
                <p className="text-xs text-green-700 mt-1 leading-relaxed">{t('installPage.alreadyInstalled.desc')}</p>
              </div>
            </div>
          ) : (
            <div className="mb-6">
              <button onClick={handleInstallClick}
                disabled={buttonState === 'preparing'}
                className="w-full bg-brand-500 hover:bg-brand-600 active:bg-brand-700 disabled:bg-brand-400 text-white font-semibold py-4 rounded-2xl flex items-center justify-center gap-2.5 text-base shadow-sm transition-colors">
                {buttonState === 'preparing' ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    {t('installPage.cta.preparing')}
                  </>
                ) : buttonState === 'cancelled' ? (
                  <>
                    <MdDownload size={22} />
                    {t('installPage.cta.tryAgain')}
                  </>
                ) : (
                  <>
                    <MdDownload size={22} />
                    {t('installPage.cta.installButton')}
                  </>
                )}
              </button>
              <p className="text-xs text-gray-400 text-center mt-2.5">
                {buttonState === 'preparing' ? t('installPage.cta.preparingHint')
                 : buttonState === 'cancelled' ? t('installPage.cta.cancelledHint')
                 : buttonState === 'unsupported' && platform === 'ios' ? t('installPage.cta.iosHint')
                 : buttonState === 'unsupported' && platform === 'desktop' ? t('installPage.cta.desktopHint')
                 : buttonState === 'unsupported' ? t('installPage.cta.androidUnsupportedHint')
                 : platform === 'ios'     ? t('installPage.cta.iosHint')
                 : platform === 'desktop' ? t('installPage.cta.desktopHint')
                 : deferredPrompt          ? t('installPage.cta.androidHintReady')
                 :                           t('installPage.cta.androidHintNotReady')}
              </p>
            </div>
          )}

          {/* Why install — benefits */}
          <div className="card p-5 mb-6">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">
              {t('installPage.benefits.title')}
            </p>
            <div className="space-y-3">
              {[
                { Icon: MdHome,          textKey: 'benefits.homescreen' },
                { Icon: MdFlashOn,       textKey: 'benefits.faster'     },
                { Icon: MdWifiOff,       textKey: 'benefits.offline'    },
                { Icon: MdNotifications, textKey: 'benefits.notifs'     },
              ].map(({ Icon, textKey }) => (
                <div key={textKey} className="flex items-start gap-3">
                  <div className="w-9 h-9 bg-brand-50 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Icon size={18} className="text-brand-500" />
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed pt-1.5">
                    {t(`installPage.${textKey}`)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Platform-specific manual steps (always rendered so the smart
              button can scroll to them). Header changes by platform. */}
          {!installed && (
            <div ref={manualStepsRef} className="card p-5 mb-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
                {platform === 'ios' ? t('installPage.manual.iosTitle')
                 : platform === 'desktop' ? t('installPage.manual.desktopTitle')
                 : t('installPage.manual.androidTitle')}
              </p>
              {platform === 'ios' ? (
                <div className="space-y-2">
                  <p className="text-sm text-gray-700 leading-relaxed flex items-start gap-2">
                    <MdIosShare size={18} className="text-brand-500 flex-shrink-0 mt-0.5" />
                    <span>{t('installPage.cta.iosIntro')}</span>
                  </p>
                  <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside leading-relaxed pl-1">
                    <li>{t('installPage.cta.iosStep1')}</li>
                    <li>{t('installPage.cta.iosStep2')}</li>
                    <li>{t('installPage.cta.iosStep3')}</li>
                  </ol>
                </div>
              ) : platform === 'desktop' ? (
                <div className="flex items-start gap-3">
                  <MdLaptop size={20} className="text-gray-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {t('installPage.cta.desktopDesc')}
                  </p>
                </div>
              ) : (
                <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside leading-relaxed pl-1">
                  <li>{t('installPage.cta.androidStep1')}</li>
                  <li>{t('installPage.cta.androidStep2')}</li>
                  <li>{t('installPage.cta.androidStep3')}</li>
                </ol>
              )}
            </div>
          )}

          {/* Trust footer */}
          <p className="text-center text-xs text-gray-400">
            {t('installPage.footer')}
          </p>

        </div>
      </main>
    </div>
  )
}