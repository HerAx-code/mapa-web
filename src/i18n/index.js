// i18next configuration for MAPA.
// English (en) and Filipino (fil) translations for patient-facing strings.
// Per CLAUDE.md: patient-facing UI must be bilingual.

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import fil from './locales/fil.json'

const STORAGE_KEY = 'mapa.lang'

const savedLang = (typeof window !== 'undefined' && window.localStorage)
  ? window.localStorage.getItem(STORAGE_KEY)
  : null

i18n
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, fil: { translation: fil } },
    lng:           savedLang ?? 'en',
    fallbackLng:  'en',
    interpolation: { escapeValue: false },  // React already escapes
  })

i18n.on('languageChanged', (lng) => {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, lng)
  }
})

export default i18n
