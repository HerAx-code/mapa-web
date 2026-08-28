import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  MdArrowBack, MdDownload, MdCheckCircle,
  MdHome, MdFlashOn, MdWifiOff, MdNotifications,
  MdLaptop, MdVerifiedUser, MdSmartphone, MdContentCopy, MdCheck,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import Logo from '../../components/ui/Logo'
import LanguageToggle from '../../components/LanguageToggle'

// ── Decorative home-screen mockup (aria-hidden — purely illustrative) ──────
function PhonePreview() {
  return (
    <div aria-hidden="true"
      className="mx-auto w-[200px] rounded-[2rem] border-4 border-gray-200 bg-white shadow-lg p-3">
      <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-gray-200" />
      <div className="rounded-2xl bg-gradient-to-b from-brand-50 to-gray-50 p-3.5">
        <div className="grid grid-cols-4 gap-x-3 gap-y-3.5">
          {/* MAPA icon highlighted first, then muted placeholder apps */}
          <div className="flex flex-col items-center gap-1">
            <img src="/pwa-192.png" alt="" className="h-11 w-11 rounded-xl shadow-sm" />
            <span className="text-[8px] font-semibold text-gray-600">MAPA</span>
          </div>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="h-11 w-11 rounded-xl bg-gray-200/70" />
              <span className="h-1.5 w-6 rounded bg-gray-200/60" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── "Continue on your phone" — copy the install URL (desktop visitors) ─────
function ContinueOnPhone({ t }) {
  const [copied, setCopied] = useState(false)
  const url = 'mapa-web-six.vercel.app/install'
  const copy = () => {
    navigator.clipboard?.writeText(`https://${url}`)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
      .catch(() => setCopied(false))
  }
  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
          <MdSmartphone size={16} className="text-brand-500" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{t('installPage.continueOnPhone.title')}</p>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{t('installPage.continueOnPhone.desc')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="truncate rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-700">{url}</code>
            <button type="button" onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:bg-brand-50 hover:text-brand-600 hover:border-brand-200">
              {copied ? <MdCheck size={14} className="text-brand-500" /> : <MdContentCopy size={14} />}
              {copied ? t('installPage.continueOnPhone.copied') : t('installPage.continueOnPhone.copy')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Tabbed manual steps — pick Android or iPhone regardless of device ──────
function StepsSection({ t, platform, stepsRef }) {
  const [active, setActive] = useState(platform === 'ios' ? 'ios' : 'android')
  // Re-sync to the detected platform if it resolves after mount.
  useEffect(() => { setActive(platform === 'ios' ? 'ios' : 'android') }, [platform])

  const stepKeys = active === 'ios'
    ? ['iosStep1', 'iosStep2', 'iosStep3']
    : ['androidStep1', 'androidStep2', 'androidStep3']
  const using = active === 'ios'
    ? t('installPage.steps.usingIos')
    : t('installPage.steps.usingAndroid')

  return (
    <section ref={stepsRef} aria-labelledby="install-steps-heading" className="space-y-4 scroll-mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="install-steps-heading" className="text-lg font-bold tracking-tight text-gray-900">
          {t('installPage.steps.title')}
        </h2>
        <div role="tablist" aria-label={t('installPage.steps.choosePhone')}
          className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          {[['android', t('installPage.steps.androidTab')], ['ios', t('installPage.steps.iosTab')]].map(([id, label]) => (
            <button key={id} role="tab" type="button" aria-selected={active === id}
              onClick={() => setActive(id)}
              className={`rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                active === id ? 'bg-brand-500 text-white' : 'text-gray-500 hover:text-gray-800'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-gray-400">{using}</p>
      <ol className="relative space-y-5 border-l border-gray-200 pl-6">
        {stepKeys.map((k, i) => (
          <li key={k} className="relative">
            <span aria-hidden="true"
              className="absolute -left-[37px] flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-xs font-bold text-brand-600">
              {i + 1}
            </span>
            <p className="text-sm text-gray-700 leading-relaxed">{t(`installPage.cta.${k}`)}</p>
          </li>
        ))}
      </ol>
      {platform === 'desktop' && (
        <p className="text-xs text-gray-500 flex items-start gap-2">
          <MdLaptop size={16} className="text-gray-400 mt-0.5 flex-shrink-0" />
          {t('installPage.cta.desktopDesc')}
        </p>
      )}
    </section>
  )
}

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

  // Shared: the smart install button + its dynamic hint (logic unchanged).
  const installCta = installed ? (
    <div className="card p-4 flex items-start gap-3 border-green-200 bg-green-50">
      <MdCheckCircle size={24} className="text-green-500 flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-green-800">{t('installPage.alreadyInstalled.title')}</p>
        <p className="text-xs text-green-700 mt-1 leading-relaxed">{t('installPage.alreadyInstalled.desc')}</p>
      </div>
    </div>
  ) : (
    <div>
      <button onClick={handleInstallClick}
        disabled={buttonState === 'preparing'}
        className="w-full sm:w-auto sm:min-w-[260px] bg-brand-500 hover:bg-brand-600 active:bg-brand-700 disabled:bg-brand-400 text-white font-semibold px-6 py-4 rounded-2xl inline-flex items-center justify-center gap-2.5 text-base shadow-sm transition-colors">
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
      <p className="text-xs text-gray-400 mt-2.5">
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
  )

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Topbar — hide 'Back to home' when the app is already
          installed; the Landing page redirects away in standalone
          mode so the link would just round-trip the user. */}
      <header className="border-b border-gray-100 px-5 sm:px-6 py-3 flex items-center justify-between">
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

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-14">

          {/* ── Left column ── */}
          <div className="min-w-0 space-y-10">

            {/* Hero */}
            <section className="space-y-5">
              <p className="eyebrow">{t('installPage.org')}</p>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900 leading-[1.1] max-w-xl">
                {t('installPage.hero.title')}
              </h1>
              <p className="text-base text-gray-500 leading-relaxed max-w-xl">
                {t('installPage.hero.desc')}
              </p>

              {installCta}

              {!installed && (
                <p className="flex items-center gap-2 text-sm text-gray-500">
                  <MdVerifiedUser size={16} className="text-brand-500 flex-shrink-0" />
                  {t('installPage.trustLine')}
                </p>
              )}
            </section>

            {/* Phone preview — inline on mobile, in the aside on desktop */}
            <div className="lg:hidden flex justify-center">
              <PhonePreview />
            </div>

            {/* Tabbed manual steps */}
            {!installed && (
              <StepsSection t={t} platform={platform} stepsRef={manualStepsRef} />
            )}

            <hr className="border-gray-100" />

            {/* Why install — benefits */}
            <section className="space-y-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                {t('installPage.benefits.title')}
              </p>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
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
            </section>

            {/* Trust footer */}
            <p className="text-xs text-gray-400">
              {t('installPage.footer')}
            </p>
          </div>

          {/* ── Right aside (desktop) — sticky phone preview + copy link ── */}
          <aside className="hidden lg:block">
            <div className="sticky top-8 space-y-5">
              <PhonePreview />
              <p className="text-center text-xs text-gray-400">{t('installPage.phonePreviewCaption')}</p>
              {!installed && <ContinueOnPhone t={t} />}
            </div>
          </aside>
        </div>

        {/* Continue-on-phone also below the fold on smaller screens, but only
            for desktop visitors (on a phone you're already where you install). */}
        {!installed && platform === 'desktop' && (
          <div className="mt-10 lg:hidden">
            <ContinueOnPhone t={t} />
          </div>
        )}
      </main>
    </div>
  )
}