// Which install guidance a visitor needs on /install (review 2026-11-25).
// Pure, so it can be tested with real user-agent strings.
//
//   'inapp'   — a social app's built-in browser (Facebook, Messenger,
//               Instagram, …). These can't install a web app; the visitor must
//               open the page in Chrome / Safari first. In the Philippines this
//               is where most shared links open.
//   'ios'     — any browser on an iPhone or iPad. Since iOS 16.4 Add to Home
//               Screen works from Safari, Chrome, Edge and Firefox (Share menu).
//               iPadOS reports itself as a Mac, so touch support tells them apart.
//   'android' — Android (Chrome's install prompt or its menu).
//   'desktop' — everything else: offer the QR code to continue on a phone.
//
// `iosBrowser` names the iPhone browser so the steps say where Share is.
const IN_APP_RE = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|MessengerLite|Line\/|MicroMessenger|TikTok|musical_ly|Snapchat/i

export function detectInstallPlatform(ua = '', { platform = '', maxTouchPoints = 0 } = {}) {
  const s = String(ua)
  const isIpadAsMac = platform === 'MacIntel' && maxTouchPoints > 1
  const isIos = /iPad|iPhone|iPod/.test(s) || isIpadAsMac
  const isAndroid = /Android/.test(s)
  const iosBrowser = /CriOS/.test(s) ? 'chrome'
    : /EdgiOS/.test(s) ? 'edge'
    : /FxiOS/.test(s) ? 'firefox'
    : 'safari'
  if (IN_APP_RE.test(s)) return { platform: 'inapp', iosBrowser: isIos ? iosBrowser : null, mobileOs: isIos ? 'ios' : isAndroid ? 'android' : null }
  if (isIos) return { platform: 'ios', iosBrowser, mobileOs: 'ios' }
  if (isAndroid) return { platform: 'android', iosBrowser: null, mobileOs: 'android' }
  return { platform: 'desktop', iosBrowser: null, mobileOs: null }
}
