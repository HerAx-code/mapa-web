/**
 * Vitest global setup. Loaded before every test file via the
 * `setupFiles` config in vitest.config.js.
 *
 * - Pulls in @testing-library/jest-dom matchers so component tests
 *   can use `expect(el).toBeInTheDocument()` etc.
 * - Stubs a few browser globals that component code expects but jsdom
 *   doesn't provide (matchMedia, scrollIntoView).
 * - Cleans up after each test so DOM state doesn't leak between files.
 */

import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => { cleanup() })

// jsdom doesn't implement matchMedia. Several components call
// `window.matchMedia(...)` during render (Layout reads PWA install
// state; AnnouncementFeedCard / theme bits read prefers-color-scheme).
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener:    () => {},
    removeListener: () => {},
    addEventListener:    () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

// jsdom's HTMLElement.scrollIntoView is undefined. Several components
// call it after rendering messages / scrolling to errors. Stub it as
// a no-op so the tests don't throw.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {}
}
