import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import {
  MdArrowBack, MdDownload, MdCheckCircle,
  MdHome, MdFlashOn, MdWifiOff, MdMailOutline,
  MdVerifiedUser, MdSmartphone, MdContentCopy, MdCheck, MdOpenInBrowser,
} from 'react-icons/md'
import Logo from '../../components/ui/Logo'
import LanguageToggle from '../../components/LanguageToggle'
import { detectInstallPlatform } from '../../utils/installPlatform'

// Install page review (2026-11-25): guidance follows the visitor's BROWSER as
// well as their phone (utils/installPlatform.js) — a Facebook/Messenger in-app
// browser is told to open the page in Chrome/Safari first, every iPhone browser
// gets the Share-menu steps, Android gets Chrome's install dialog when it's
// ready and the steps at once when it isn't (no waiting), and a desktop gets a
// QR code to continue on a phone.

const BROWSER_NAME = { safari: 'Safari', chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox' }
const installUrl = () => `${window.location.origin}/install`

// ── Decorative home-screen mockup (aria-hidden — purely illustrative) ──────
// Shown beside the content on wide screens only; on a phone the reader is
// already holding one, and it pushed the steps below the first screen.
function PhonePreview() {
  return (
    <div aria-hidden="true" className="mx-auto w-[220px] rounded-[2.4rem] bg-gray-900 p-2 shadow-xl">
      <div className="relative overflow-hidden rounded-[1.9rem] bg-gradient-to-b from-brand-50 via-white to-gray-50">
        <div className="flex h-7 items-center justify-center">
          <div className="h-1.5 w-14 rounded-full bg-gray-900/15" />
        </div>
        {/* Fixed 36px icons fit the 180px content width: 4×36 + 3×10 = 174. */}
        <div className="px-3 pb-2 pt-1">
          <div className="grid grid-cols-4 gap-x-2.5 gap-y-4 justify-items-center">
            <div className="flex flex-col items-center gap-1.5">
              <img src="/pwa-192.png" alt=""
                className="h-9 w-9 max-w-none object-contain rounded-[0.6rem] shadow-sm ring-2 ring-brand-400/50" />
              <span className="text-[8px] font-semibold text-gray-700">MAPA</span>
            </div>
            {Array.from({ length: 11 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <div className="h-9 w-9 rounded-[0.6rem] bg-gray-200/70" />
                <span className="h-1.5 w-6 rounded bg-gray-200/60" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-center pb-2.5 pt-2">
          <div className="h-1 w-16 rounded-full bg-gray-900/20" />
        </div>
      </div>
    </div>
  )
}

// ── Copy the install link (desktop QR card + in-app notice) ────────────────
function CopyLinkButton({ t }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(installUrl())
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
      .catch(() => setCopied(false))
  }
  return (
    <button type="button" onClick={copy}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-brand-50 hover:text-brand-600 hover:border-brand-200">
      {copied ? <MdCheck size={16} className="text-brand-500" /> : <MdContentCopy size={16} />}
      {copied ? t('installPage.continueOnPhone.copied') : t('installPage.continueOnPhone.copy')}
    </button>
  )
}

// ── Desktop: a QR code to open this page on a phone ────────────────────────
function ContinueOnPhone({ t }) {
  const [qr, setQr] = useState('')
  const url = installUrl()
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: '#0b3b32', light: '#ffffff' } })
      .then(setQr).catch(() => setQr(''))
  }, [url])
  return (
    <div className="lp-card p-5">
      <div className="flex items-start gap-3">
        <span className="lp-chip h-10 w-10 bg-brand-50 text-brand-600">
          <MdSmartphone size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{t('installPage.continueOnPhone.title')}</p>
          <p className="text-sm text-gray-500 mt-1 leading-relaxed">{t('installPage.continueOnPhone.desc')}</p>
        </div>
      </div>
      {qr && (
        <img src={qr} alt={t('installPage.continueOnPhone.qrAlt')} width="176" height="176"
          className="mx-auto mt-4 h-44 w-44 rounded-xl border border-gray-100" />
      )}
      <p className="mt-4 break-all rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 font-mono text-sm text-gray-800">{url}</p>
      <div className="mt-3"><CopyLinkButton t={t} /></div>
    </div>
  )
}

// ── In-app browser (Facebook, Messenger…): open the page in a real browser ──
function InAppNotice({ t, mobileOs }) {
  const browser = mobileOs === 'ios' ? 'Safari' : 'Chrome'
  const steps = mobileOs === 'ios'
    ? ['inApp.iosStep1', 'inApp.iosStep2', 'inApp.step3']
    : ['inApp.androidStep1', 'inApp.androidStep2', 'inApp.step3']
  return (
    <div className="lp-card p-5 border-amber-200 bg-amber-50/60 space-y-4" role="region" aria-labelledby="inapp-title">
      <div className="flex items-start gap-3">
        <span className="lp-chip h-10 w-10 bg-white text-amber-600 shadow-sm"><MdOpenInBrowser size={20} /></span>
        <div className="min-w-0">
          <h2 id="inapp-title" className="text-base font-bold text-gray-900">{t('installPage.inApp.title', { browser })}</h2>
          <p className="text-sm text-gray-600 mt-1 leading-relaxed">{t('installPage.inApp.desc')}</p>
        </div>
      </div>
      <ol className="space-y-2.5 pl-1">
        {steps.map((k, i) => (
          <li key={k} className="flex gap-3 text-sm text-gray-800">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-amber-700 border border-amber-200">{i + 1}</span>
            <span className="leading-relaxed pt-0.5">{t(`installPage.${k}`)}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <CopyLinkButton t={t} />
        <span className="text-xs text-gray-500">{t('installPage.inApp.copyHint', { browser })}</span>
      </div>
    </div>
  )
}

// ── Tabbed manual steps — pick Android or iPhone regardless of device ──────
function StepsSection({ t, platform, iosBrowser, stepsRef }) {
  const [active, setActive] = useState(platform === 'ios' ? 'ios' : 'android')
  useEffect(() => { setActive(platform === 'ios' ? 'ios' : 'android') }, [platform])

  // Where the Share button is depends on the iPhone browser.
  const iosFirst = iosBrowser === 'chrome' ? 'iosChromeStep1'
    : (iosBrowser === 'edge' || iosBrowser === 'firefox') ? 'iosOtherStep1'
    : 'iosStep1'
  const stepKeys = active === 'ios'
    ? [iosFirst, 'iosStep2', 'iosStep3']
    : ['androidStep1', 'androidStep2', 'androidStep3']
  const using = active === 'ios'
    ? t('installPage.steps.usingIos', { browser: BROWSER_NAME[iosBrowser] ?? 'Safari' })
    : t('installPage.steps.usingAndroid')

  return (
    <section ref={stepsRef} aria-labelledby="install-steps-heading" className="space-y-4 scroll-mt-20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="install-steps-heading" className="font-display text-xl font-bold tracking-tight text-brand-900">
          {t('installPage.steps.title')}
        </h2>
        <div role="tablist" aria-label={t('installPage.steps.choosePhone')}
          className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          {[['android', t('installPage.steps.androidTab')], ['ios', t('installPage.steps.iosTab')]].map(([id, label]) => (
            <button key={id} role="tab" type="button" aria-selected={active === id}
              onClick={() => setActive(id)}
              className={`min-h-[44px] rounded-md px-4 text-sm font-semibold transition-colors ${
                active === id ? 'bg-brand-500 text-white' : 'text-gray-500 hover:text-gray-800'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-gray-500">{using}</p>
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
    </section>
  )
}

/**
 * Public /install page — reached from the landing page (header icon, hero
 * link, footer). What it offers depends on the visitor's browser:
 *   - installed (standalone)  → "already installed"
 *   - in-app browser          → open in Chrome / Safari first (+ copy link)
 *   - iPhone (any browser)    → the Share-menu steps, straight away
 *   - Android                 → Chrome's install dialog if it's ready; if not,
 *                               the steps at once (the button switches to the
 *                               dialog if Chrome offers it later)
 *   - desktop                 → a QR code to continue on a phone
 */
export default function InstallApp() {
  const { t } = useTranslation()
  const [deferredPrompt, setDeferredPrompt] = useState(() => window.__mapaDeferredInstallPrompt ?? null)
  const [env, setEnv] = useState({ platform: 'unknown', iosBrowser: null, mobileOs: null })
  const [installed, setInstalled] = useState(false)
  // 'idle' | 'prompting' (Chrome's dialog is open) | 'cancelled' | 'steps'
  // (no dialog available: the steps are the way, and the hint says so).
  const [buttonState, setButtonState] = useState('idle')
  const stepsRef = useRef(null)

  useEffect(() => {
    setEnv(detectInstallPlatform(window.navigator.userAgent, {
      platform: window.navigator.platform, maxTouchPoints: window.navigator.maxTouchPoints,
    }))
    setInstalled(window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true)

    // The inline script in index.html stashes an early prompt; these catch
    // a late one and a completed install.
    const onAvailable = () => setDeferredPrompt(window.__mapaDeferredInstallPrompt)
    const onInstalled = () => { setDeferredPrompt(null); setInstalled(true) }
    window.addEventListener('mapa-install-available', onAvailable)
    window.addEventListener('mapa-install-completed', onInstalled)
    return () => {
      window.removeEventListener('mapa-install-available', onAvailable)
      window.removeEventListener('mapa-install-completed', onInstalled)
    }
  }, [])

  // Chrome offered its prompt after we fell back to the steps: the button
  // becomes a real install again.
  useEffect(() => {
    if (deferredPrompt && (buttonState === 'cancelled' || buttonState === 'steps')) setButtonState('idle')
  }, [deferredPrompt, buttonState])

  const showSteps = () => {
    setButtonState('steps')
    stepsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleInstallClick = async () => {
    const armed = deferredPrompt ?? window.__mapaDeferredInstallPrompt
    // No install dialog right now: show the steps at once — no waiting.
    if (!armed) { showSteps(); return }
    setButtonState('prompting')
    try {
      armed.prompt()
      const { outcome } = await armed.userChoice
      setButtonState(outcome === 'accepted' ? 'idle' : 'cancelled')
    } catch (err) {
      console.warn('[InstallApp] prompt() failed:', err)
      setButtonState('idle')
      showSteps()
    } finally {
      setDeferredPrompt(null)
      window.__mapaDeferredInstallPrompt = null
    }
  }

  const { platform, iosBrowser, mobileOs } = env

  // What goes under the title: depends on the visitor's browser.
  let primary = null
  if (installed) {
    primary = (
      <div className="lp-card p-4 flex items-start gap-3 border-green-200 bg-green-50">
        <MdCheckCircle size={24} className="text-green-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-green-800">{t('installPage.alreadyInstalled.title')}</p>
          <p className="text-xs text-green-700 mt-1 leading-relaxed">{t('installPage.alreadyInstalled.desc')}</p>
        </div>
      </div>
    )
  } else if (platform === 'inapp') {
    primary = <InAppNotice t={t} mobileOs={mobileOs} />
  } else if (platform === 'desktop') {
    primary = <ContinueOnPhone t={t} />
  } else if (platform === 'ios') {
    primary = <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm font-medium text-brand-800">{t('installPage.cta.iosHint')}</p>
  } else if (platform === 'android') {
    primary = (
      <div>
        <button type="button" onClick={handleInstallClick} disabled={buttonState === 'prompting'}
          className="w-full sm:w-auto sm:min-w-[260px] min-h-[52px] bg-brand-500 hover:bg-brand-600 active:bg-brand-700 disabled:bg-brand-400 text-white font-semibold px-6 rounded-2xl inline-flex items-center justify-center gap-2.5 text-base shadow-lg shadow-brand-900/15 transition-colors">
          <MdDownload size={22} />
          {buttonState === 'cancelled' ? t('installPage.cta.tryAgain') : t('installPage.cta.installButton')}
        </button>
        <p className="text-xs text-gray-500 mt-2.5" role="status">
          {buttonState === 'cancelled' ? t('installPage.cta.cancelledHint')
            : buttonState === 'steps' ? t('installPage.cta.androidUnsupportedHint')
            : deferredPrompt ? t('installPage.cta.androidHintReady')
            : t('installPage.cta.androidHintNotReady')}
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-canvas text-gray-800 flex flex-col">
      {/* Topbar — no "Back to home" in the installed app (Landing redirects
          away in standalone mode, so the link would round-trip). */}
      <header className="sticky top-0 z-30 border-b border-brand-900/5 bg-canvas/85 backdrop-blur px-5 sm:px-6 py-3 flex items-center justify-between">
        <Logo size={32} withWordmark />
        <div className="flex items-center gap-2">
          <LanguageToggle />
          {!installed && (
            <Link to="/" className="inline-flex min-h-[44px] items-center gap-1 px-1 text-sm text-gray-500 hover:text-brand-600 font-medium">
              <MdArrowBack size={14} /> {t('installPage.backHome')}
            </Link>
          )}
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-14">
          <div className="min-w-0 space-y-10">
            {/* Hero */}
            <section className="space-y-5">
              <p className="text-sm font-semibold text-brand-600">{t('installPage.org')}</p>
              <h1 className="font-display text-3xl sm:text-[40px] font-bold tracking-tight text-brand-900 leading-[1.08] max-w-xl">
                {t('installPage.hero.title')}
              </h1>
              <p className="text-base text-gray-500 leading-relaxed max-w-xl">
                {t('installPage.hero.desc')}
              </p>
              {primary}
              {!installed && platform !== 'inapp' && platform !== 'desktop' && (
                <p className="flex items-center gap-2 text-sm text-gray-500">
                  <MdVerifiedUser size={16} className="text-brand-500 flex-shrink-0" />
                  {t('installPage.trustLine')}
                </p>
              )}
            </section>

            {/* The steps — right after the hero on a phone (in-app visitors
                get theirs in the notice above). */}
            {!installed && platform !== 'inapp' && (
              <StepsSection t={t} platform={platform} iosBrowser={iosBrowser} stepsRef={stepsRef} />
            )}

            <hr className="border-brand-900/10" />

            {/* Why install — only what's true today */}
            <section className="space-y-5">
              <div>
                <h2 className="font-display text-xl font-bold tracking-tight text-brand-900">
                  {t('installPage.benefits.title')}
                </h2>
                <div className="mt-3 h-1 w-12 rounded-full bg-amber-400" />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  { Icon: MdHome,        textKey: 'benefits.homescreen' },
                  { Icon: MdFlashOn,     textKey: 'benefits.faster'     },
                  { Icon: MdWifiOff,     textKey: 'benefits.offline'    },
                  { Icon: MdMailOutline, textKey: 'benefits.notifs'     },
                ].map(({ Icon, textKey }) => (
                  <div key={textKey} className="lp-card p-4 flex items-start gap-3">
                    <span className="lp-chip h-10 w-10 bg-brand-50 text-brand-600">
                      <Icon size={20} />
                    </span>
                    <p className="text-sm text-gray-700 leading-relaxed pt-1">
                      {t(`installPage.${textKey}`)}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <p className="text-xs text-gray-500">{t('installPage.footer')}</p>
          </div>

          {/* Wide screens: the phone mockup beside the content. */}
          <aside className="hidden lg:block">
            <div className="sticky top-8 space-y-5">
              <PhonePreview />
              <p className="text-center text-xs text-gray-500">{t('installPage.phonePreviewCaption')}</p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}
