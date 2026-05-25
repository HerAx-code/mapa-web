import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  MdArrowBack, MdAdd, MdCheckCircle, MdIosShare,
  MdHome, MdFlashOn, MdWifiOff, MdNotifications,
  MdAndroid, MdPhoneIphone, MdLaptop,
} from 'react-icons/md'
import Logo from '../../components/ui/Logo'
import LanguageToggle from '../../components/LanguageToggle'

/**
 * Public /install page.
 *
 * The Landing "Download App" button routes here so unauthenticated
 * visitors can install the PWA before signing up. The page is
 * platform-aware: Android Chrome gets a one-tap install button via
 * beforeinstallprompt; iOS Safari gets explicit Share-sheet steps
 * because Apple doesn't expose an install API; desktop gets a "this is
 * the mobile app — open this page on your phone" hint.
 *
 * Already-installed detection: if the visitor opens this page from
 * within the installed PWA itself, we hide the install CTA and show a
 * "you're already running the app" confirmation instead — avoids the
 * confusing dead-end where someone taps Install but nothing happens
 * because Chrome already considers the app installed.
 */
export default function InstallApp() {
  const { t } = useTranslation()
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [platform,       setPlatform]       = useState('unknown')
  const [installed,      setInstalled]      = useState(false)

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

    // Detect "already running the installed app" — if so, this whole
    // page is essentially a no-op and we should say so clearly.
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    setInstalled(standalone)

    // Capture the install event for Android/Chromium.
    const onBeforeInstall = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    const onInstalled = () => {
      setDeferredPrompt(null)
      setInstalled(true)
    }
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Topbar — matches Landing's */}
      <header className="border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <Logo size={32} withWordmark />
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <Link to="/" className="text-sm text-gray-500 hover:text-brand-600 font-medium flex items-center gap-1">
            <MdArrowBack size={14} /> {t('installPage.backHome')}
          </Link>
        </div>
      </header>

      <main className="flex-1 px-4 py-10 sm:py-16">
        <div className="max-w-xl mx-auto">

          {/* Hero */}
          <div className="text-center mb-8">
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

          {/* Primary CTA — varies by platform + install state */}
          <div className="card p-5 mb-6">
            {installed ? (
              <div className="flex items-start gap-3">
                <MdCheckCircle size={24} className="text-green-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">{t('installPage.alreadyInstalled.title')}</p>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">{t('installPage.alreadyInstalled.desc')}</p>
                </div>
              </div>
            ) : platform === 'android' && deferredPrompt ? (
              <>
                <button onClick={handleInstall}
                  className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-base">
                  <MdAdd size={20} /> {t('installPage.cta.install')}
                </button>
                <p className="text-xs text-gray-400 text-center mt-3">{t('installPage.cta.androidHint')}</p>
              </>
            ) : platform === 'android' ? (
              // Android but no event yet — give them manual steps as fallback.
              <div className="space-y-3">
                <p className="text-sm text-gray-700 leading-relaxed">
                  {t('installPage.cta.androidManual')}
                </p>
                <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside leading-relaxed">
                  <li>{t('installPage.cta.androidStep1')}</li>
                  <li>{t('installPage.cta.androidStep2')}</li>
                  <li>{t('installPage.cta.androidStep3')}</li>
                </ol>
              </div>
            ) : platform === 'ios' ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-700 leading-relaxed flex items-start gap-2">
                  <MdIosShare size={18} className="text-brand-500 flex-shrink-0 mt-0.5" />
                  <span>{t('installPage.cta.iosIntro')}</span>
                </p>
                <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside leading-relaxed">
                  <li>{t('installPage.cta.iosStep1')}</li>
                  <li>{t('installPage.cta.iosStep2')}</li>
                  <li>{t('installPage.cta.iosStep3')}</li>
                </ol>
              </div>
            ) : (
              // Desktop
              <div className="flex items-start gap-3">
                <MdLaptop size={20} className="text-gray-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">{t('installPage.cta.desktopTitle')}</p>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">{t('installPage.cta.desktopDesc')}</p>
                </div>
              </div>
            )}
          </div>

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

          {/* Trust footer */}
          <p className="text-center text-xs text-gray-400">
            {t('installPage.footer')}
          </p>

        </div>
      </main>
    </div>
  )
}