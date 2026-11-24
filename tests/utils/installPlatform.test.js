import { describe, it, expect } from 'vitest'
import { detectInstallPlatform } from '../../src/utils/installPlatform.js'

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  messengerAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-A045F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/455.0.0.44.116;]',
  facebookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/460.0.0.36.103;FBBV/1;FBDV/iPhone14,5]',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1',
  iphoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/124.0 Mobile/15E148 Safari/605.1.15',
  ipadAsMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}

describe('detectInstallPlatform', () => {
  it('Android Chrome gets the Android path', () => {
    expect(detectInstallPlatform(UA.androidChrome).platform).toBe('android')
  })
  it("Messenger and Facebook's built-in browsers are in-app, on Android and iPhone", () => {
    expect(detectInstallPlatform(UA.messengerAndroid)).toMatchObject({ platform: 'inapp', mobileOs: 'android' })
    expect(detectInstallPlatform(UA.facebookIos)).toMatchObject({ platform: 'inapp', mobileOs: 'ios' })
  })
  it('every iPhone browser is iOS, and names the browser', () => {
    expect(detectInstallPlatform(UA.iphoneSafari)).toMatchObject({ platform: 'ios', iosBrowser: 'safari' })
    expect(detectInstallPlatform(UA.iphoneChrome)).toMatchObject({ platform: 'ios', iosBrowser: 'chrome' })
    expect(detectInstallPlatform(UA.iphoneEdge)).toMatchObject({ platform: 'ios', iosBrowser: 'edge' })
  })
  it('an iPad that reports itself as a Mac is iOS (touch), a real Mac is desktop', () => {
    expect(detectInstallPlatform(UA.ipadAsMac, { platform: 'MacIntel', maxTouchPoints: 5 }).platform).toBe('ios')
    expect(detectInstallPlatform(UA.ipadAsMac, { platform: 'MacIntel', maxTouchPoints: 0 }).platform).toBe('desktop')
  })
  it('a desktop browser is desktop', () => {
    expect(detectInstallPlatform(UA.windowsChrome).platform).toBe('desktop')
  })
})
