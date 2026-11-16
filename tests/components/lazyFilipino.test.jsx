/**
 * Filipino is loaded on demand (perf, 2026-11-16): it is not part of the
 * startup bundle, and setLanguage() loads it before switching.
 */
import { describe, it, expect } from 'vitest'
import i18n, { setLanguage, ensureLanguage } from '../../src/i18n'

describe('lazy Filipino', () => {
  it('starts with English only, and setLanguage loads Filipino first', async () => {
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true)
    expect(i18n.hasResourceBundle('fil', 'translation')).toBe(false)
    await setLanguage('fil')
    expect(i18n.hasResourceBundle('fil', 'translation')).toBe(true)
    expect(i18n.language).toBe('fil')
    expect(i18n.t('register.step1.sex_female')).toBe('Babae')
    await setLanguage('en')
    expect(i18n.t('register.step1.sex_female')).toBe('Female')
  })

  it('English needs no download', async () => {
    expect(await ensureLanguage('en')).toBe(true)
  })
})
